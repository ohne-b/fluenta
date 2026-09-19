import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ConnectedCommand, ConnectedResponse } from "@fluenta/contracts";
import { call } from "./ipc";
import { useSettings } from "./context";
import { useI18n } from "./i18n";

type Data<K extends ConnectedResponse["kind"]> =
  Extract<ConnectedResponse, { kind: K }> extends { data: infer D } ? D : never;
export async function connected<K extends ConnectedResponse["kind"]>(
  payload: ConnectedCommand,
  kind: K,
): Promise<Data<K>> {
  const result = await call({ command: "connected", payload }, "connected");
  if (result.kind !== kind || !("data" in result))
    throw new Error("app.unexpected_error");
  return result.data as Data<K>;
}
export function useConnected<K extends ConnectedResponse["kind"]>(
  payload: ConnectedCommand,
  kind: K,
) {
  const { data: settings } = useSettings();
  return useQuery({
    queryKey: ["connected", settings?.source_language, payload],
    queryFn: () => connected(payload, kind),
  });
}
export function useConnectedAction() {
  const cache = useQueryClient(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const run = async (payload: ConnectedCommand) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call({ command: "connected", payload }, "connected");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["connected"] }),
        cache.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      if (result.kind === "session") {
        cache.setQueryData(["session", result.data.session_id], result.data);
        navigate(`/session/${result.data.session_id}`);
      }
      return result;
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}
export function useCopy() {
  const { language } = useI18n();
  return (en: string, de: string) => (language === "de" ? de : en);
}
