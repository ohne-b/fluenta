import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Command,
  Event,
  Failure,
  Response,
  Success,
} from "@fluenta/contracts";

export class AppError extends Error {
  constructor(public failure: Failure) {
    super(failure.message_key);
  }
}
export const desktopAvailable = isTauri();
export const nonce = () => crypto.randomUUID();

export async function request(
  command: Command,
  requestId = nonce(),
): Promise<Success> {
  if (!desktopAvailable) throw new Error("app.desktop_required");
  const response = await invoke<Response>("dispatch", {
    request: { protocol_version: 1, request_id: requestId, command },
  });
  if (response.request_id !== requestId || response.protocol_version !== 1)
    throw new Error("app.update_required");
  if (response.result.status === "error")
    throw new AppError(response.result.payload);
  return response.result.payload;
}
type Data<K extends Success["kind"]> =
  Extract<Success, { kind: K }> extends { data: infer D } ? D : never;
export async function call<K extends Success["kind"]>(
  command: Command,
  expected: K,
): Promise<Data<K>> {
  const response = await request(command);
  if (response.kind !== expected || !("data" in response))
    throw new Error("app.unexpected_error");
  return response.data as Data<K>;
}

export function useOperation(
  onEvent?: (event: Event) => void,
  cancelOnUnmount = true,
) {
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const liveId = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const listener = useRef(onEvent);
  listener.current = onEvent;
  const cancelOnExit = useRef(cancelOnUnmount);
  cancelOnExit.current = cancelOnUnmount;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (liveId.current && cancelOnExit.current)
        void request({
          command: "cancel_operation",
          payload: { operation_id: liveId.current },
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!id) return;
    let disposed = false,
      sequence = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const data = await call(
          {
            command: "read_operation",
            payload: { operation_id: id, after_sequence: sequence },
          },
          "operation_events",
        );
        if (disposed) return;
        sequence = data.last_sequence;
        for (const event of data.items) {
          if (event.event.event === "progress") {
            const { completed_bytes, total_bytes } = event.event.payload;
            setProgress(
              total_bytes
                ? Number(completed_bytes) / Number(total_bytes)
                : null,
            );
          }
          if (event.event.event === "failed")
            setError(new AppError(event.event.payload));
          listener.current?.(event);
        }
        if (data.terminal) {
          liveId.current = null;
          setBusy(false);
          setId(null);
        } else timer = setTimeout(poll, 250);
      } catch (error) {
        if (!disposed) {
          setError(error);
          timer = setTimeout(poll, 1500);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id]);
  const attach = useCallback((operationId: string) => {
    liveId.current = operationId;
    setId(operationId);
    setBusy(true);
    setError(null);
    setProgress(null);
  }, []);
  const begin = async (command: Command) => {
    if (liveId.current) return;
    cancelRequested.current = false;
    setBusy(true);
    setError(null);
    try {
      const result = await request(command);
      if (result.kind === "operation_started") {
        if (!mounted.current && cancelOnExit.current)
          await request({
            command: "cancel_operation",
            payload: { operation_id: result.data.operation_id },
          });
        else {
          attach(result.data.operation_id);
          if (cancelRequested.current)
            await request({
              command: "cancel_operation",
              payload: { operation_id: result.data.operation_id },
            }).catch(setError);
        }
      } else setBusy(false);
    } catch (error) {
      setError(error);
      setBusy(false);
    }
  };
  const cancel = async () => {
    cancelRequested.current = true;
    if (liveId.current)
      await request({
        command: "cancel_operation",
        payload: { operation_id: liveId.current },
      });
  };
  return {
    id,
    busy,
    progress,
    error,
    begin,
    attach,
    cancel,
    clearError: () => setError(null),
  };
}
