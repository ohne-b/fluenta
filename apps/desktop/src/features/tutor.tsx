import { PageHeading } from "../components/page-heading";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "../components/icon";
import {
  mdiArrowRight,
  mdiBookOpenPageVariantOutline,
  mdiClose,
  mdiMessageOutline,
  mdiMessageTextOutline,
  mdiMicrophoneOutline,
  mdiPlus,
  mdiSend,
  mdiStop,
  mdiTrashCanOutline,
  mdiVolumeHigh,
  mdiLoading,
} from "@mdi/js";
import type { TutorMode, TutorTurn } from "@fluenta/contracts";
import { call, request, useOperation } from "../lib/ipc";
import { useAppActions, useSettings } from "../lib/context";
import { useI18n } from "../lib/i18n";
import {
  Brand,
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  Modal,
} from "../components/ui";
import { ModelDownload } from "./settings";

export function TutorPage() {
  const { t } = useI18n(),
    { data: settings } = useSettings(),
    cache = useQueryClient(),
    actions = useAppActions();
  const [params, setParams] = useSearchParams(),
    threadId = params.get("thread"),
    sessionId = params.get("session");
  const [message, setMessage] = useState(""),
    [mode, setMode] = useState<TutorMode>("conversation"),
    [pending, setPending] = useState(""),
    [error, setError] = useState<unknown>(null),
    [remove, setRemove] = useState(false),
    [recording, setRecording] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const downloads = useQuery({
    queryKey: ["downloads"],
    queryFn: () => call({ command: "get_downloads" }, "downloads"),
  });
  const installed = downloads.data?.items.some(
    (item) => !item.required && item.installed,
  );
  const threads = useQuery({
    queryKey: ["tutor-threads"],
    queryFn: () => call({ command: "list_tutor_threads" }, "tutor_threads"),
    enabled: Boolean(installed),
  });
  const detail = useQuery({
    queryKey: ["tutor-thread", threadId],
    queryFn: () =>
      call(
        { command: "get_tutor_thread", payload: { thread_id: threadId! } },
        "tutor_thread",
      ),
    enabled: Boolean(threadId && installed),
    staleTime: 0,
  });
  const operation = useOperation((event) => {
    if (event.event.event === "tutor_ready") {
      const { thread_id } = event.event.payload;
      setPending("");
      setMessage("");
      setParams(
        (previous) => {
          previous.set("thread", thread_id);
          return previous;
        },
        { replace: true },
      );
      void cache.invalidateQueries({ queryKey: ["tutor-threads"] });
      void cache.invalidateQueries({ queryKey: ["tutor-thread"] });
    }
    if (["failed", "cancelled"].includes(event.event.event)) setPending("");
  });
  const speech = useOperation((event) => {
    if (event.event.event === "transcript_ready") {
      setMessage(event.event.payload.transcript);
      setRecording(false);
      composer.current?.focus();
    }
    if (["failed", "finished", "cancelled"].includes(event.event.event))
      setRecording(false);
  });
  const playback = useOperation();
  useEffect(() => {
    if (operation.error && !operation.busy) setPending("");
  }, [operation.error, operation.busy]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "end",
    });
  }, [detail.data?.turns.length, pending, operation.busy]);
  const send = async () => {
    if (!message.trim() || operation.busy || speech.busy) return;
    setError(null);
    setPending(message.trim());
    await operation.begin({
      command: "start_tutor_turn",
      payload: {
        thread_id: threadId,
        mode,
        message: message.trim(),
        session_id: sessionId,
      },
    });
  };
  const startNew = () => {
    setParams((previous) => {
      previous.delete("thread");
      return previous;
    });
    setMessage("");
    setPending("");
  };
  const deleteThread = async () => {
    if (!threadId) return;
    try {
      await request({
        command: "delete_tutor_thread",
        payload: { thread_id: threadId },
      });
      await cache.invalidateQueries({ queryKey: ["tutor-threads"] });
      startNew();
      setRemove(false);
    } catch (error) {
      setError(error);
    }
  };
  const openThread = (id: string) => {
    setParams((previous) => {
      previous.set("thread", id);
      return previous;
    });
    setPending("");
  };
  const turns: TutorTurn[] = detail.data?.turns ?? [];
  if (downloads.isPending || !settings) return <Loading />;
  if (downloads.error)
    return (
      <ErrorNotice
        error={downloads.error}
        retry={() => void downloads.refetch()}
      />
    );
  return (
    <div className="page tutor-page">
      <PageHeading>
        <h1>{t("Tutor")}</h1>
      </PageHeading>
      {!installed ? (
        <section className="tutor-install">
          <div className="tutor-emblem">
            <Icon path={mdiMessageTextOutline} aria-hidden="true" size="39px" />
          </div>
          <h2>{t("Download tutor")}</h2>
          <ModelDownload condensed />
        </section>
      ) : (
        <div className="tutor-workspace">
          <aside className="thread-sidebar">
            <Button
              variant="secondary"
              disabled={operation.busy || speech.busy}
              onClick={startNew}
            >
              <Icon path={mdiPlus} aria-hidden="true" size="17px" />
              {t("New conversation")}
            </Button>
            <h2 className="section-label">{t("Recent conversations")}</h2>
            <div className="thread-list">
              {threads.data
                ?.filter(
                  (thread) =>
                    thread.source_language === settings?.source_language,
                )
                .map((thread) => (
                  <button
                    className={thread.id === threadId ? "active" : ""}
                    key={thread.id}
                    disabled={operation.busy || speech.busy}
                    onClick={() => openThread(thread.id)}
                  >
                    <Icon
                      path={mdiMessageOutline}
                      aria-hidden="true"
                      size="16px"
                    />
                    <span>{thread.title}</span>
                  </button>
                ))}
            </div>
            <ErrorNotice error={threads.error} />
          </aside>
          <section className="chat">
            <div className="chat-toolbar">
              <span>{detail.data?.thread.title ?? t("New conversation")}</span>
              {threadId && (
                <IconButton
                  label={t("Delete conversation")}
                  disabled={operation.busy}
                  onClick={() => setRemove(true)}
                >
                  <Icon
                    path={mdiTrashCanOutline}
                    aria-hidden="true"
                    size="16px"
                  />
                </IconButton>
              )}
            </div>
            {sessionId && (
              <div className="context-banner">
                <Icon
                  path={mdiBookOpenPageVariantOutline}
                  aria-hidden="true"
                  size="15px"
                />
                <span>{t("Using your current lesson as context")}</span>
                <IconButton
                  label={t("Remove lesson context")}
                  disabled={operation.busy}
                  onClick={() =>
                    setParams((previous) => {
                      previous.delete("session");
                      return previous;
                    })
                  }
                >
                  <Icon path={mdiClose} aria-hidden="true" size="15px" />
                </IconButton>
              </div>
            )}
            <div className="chat-messages" aria-label={t("Conversation")}>
              {!turns.length && !pending && (
                <div className="chat-welcome">
                  <Brand compact />
                  <h3>¡Hola! ¿Qué practicamos?</h3>
                  <div className="conversation-starters">
                    {(
                      [
                        [
                          "Practise talking about school",
                          "Quiero practicar una conversación sobre mi instituto. Hazme una pregunta y adapta tu español a mi nivel.",
                          "conversation",
                        ],
                        [
                          "Explain the past tenses",
                          t(
                            "Explain the difference between indefinido and imperfecto using a school example.",
                          ),
                          "explain",
                        ],
                        [
                          "Help me structure an argument",
                          t(
                            "Help me plan a short argument in Spanish about phones in class: a position, a reason and an example.",
                          ),
                          "explain",
                        ],
                      ] as const
                    ).map(([label, prompt, presetMode]) => (
                      <button
                        key={label}
                        onClick={() => {
                          setMessage(prompt);
                          setMode(presetMode);
                          composer.current?.focus();
                        }}
                      >
                        {t(label)}
                        <Icon
                          path={mdiArrowRight}
                          aria-hidden="true"
                          size="15px"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((turn, index) => (
                <article
                  className={`chat-turn ${turn.role}`}
                  key={`${threadId}:${index}`}
                >
                  <div className="turn-avatar">
                    {turn.role === "assistant" ? (
                      <Icon
                        path={mdiMessageTextOutline}
                        aria-hidden="true"
                        size="15px"
                      />
                    ) : (
                      <span>tú</span>
                    )}
                  </div>
                  <div className="turn-body">
                    <p lang={turn.role === "assistant" ? "es" : undefined}>
                      {turn.text}
                    </p>
                    {turn.explanation && (
                      <div
                        className="native-explanation"
                        lang={detail.data?.thread.source_language}
                      >
                        {turn.explanation}
                      </div>
                    )}
                    {turn.references.length > 0 && (
                      <div className="turn-references">
                        <span>{t("Course references")}</span>
                        {turn.references.map((reference, i) => (
                          <button
                            key={reference.id}
                            onClick={() => actions.reference(reference)}
                          >
                            <Icon
                              path={mdiBookOpenPageVariantOutline}
                              aria-hidden="true"
                              size="12px"
                            />
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    {turn.role === "assistant" && (
                      <button
                        className="text-button small"
                        disabled={playback.busy || speech.busy}
                        onClick={() =>
                          threadId &&
                          void playback.begin({
                            command: "speak_tutor",
                            payload: {
                              thread_id: threadId,
                              turn_index: index,
                              slow: false,
                            },
                          })
                        }
                      >
                        <Icon
                          path={mdiVolumeHigh}
                          aria-hidden="true"
                          size="15px"
                        />
                        {t("Listen")}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {pending && (
                <article className="chat-turn user">
                  <div className="turn-avatar">tú</div>
                  <div className="turn-body">
                    <p>{pending}</p>
                  </div>
                </article>
              )}
              {operation.busy && (
                <div className="thinking" role="status">
                  <Icon
                    path={mdiLoading}
                    className="spin"
                    size="20px"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t("Generating reply…")}</span>
                </div>
              )}
              <div ref={messagesEnd} />
            </div>
            <ErrorNotice
              error={
                error ??
                operation.error ??
                detail.error ??
                speech.error ??
                playback.error
              }
            />
            <form
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <div className="composer-mode">
                <select
                  aria-label={t("Tutor")}
                  value={mode}
                  disabled={operation.busy}
                  onChange={(event) => setMode(event.target.value as TutorMode)}
                >
                  <option value="conversation">{t("Conversation")}</option>
                  <option value="explain">{t("Explain something")}</option>
                  <option value="writing_feedback">
                    {t("Writing feedback")}
                  </option>
                </select>
                <span className="small muted">{message.length}/1500</span>
              </div>
              <textarea
                ref={composer}
                aria-label={t("Message your tutor…")}
                placeholder={t("Message your tutor…")}
                value={message}
                maxLength={1500}
                rows={3}
                disabled={operation.busy || speech.busy}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-actions">
                <IconButton
                  label={t(recording ? "Stop recording" : "Speak your answer")}
                  disabled={
                    operation.busy ||
                    (speech.busy && !recording) ||
                    playback.busy
                  }
                  onClick={() => {
                    if (recording && speech.id) {
                      setRecording(false);
                      void request({
                        command: "stop_recording",
                        payload: { operation_id: speech.id },
                      }).catch(setError);
                    } else {
                      setRecording(true);
                      void speech.begin({ command: "start_tutor_recording" });
                    }
                  }}
                >
                  {recording && speech.busy ? (
                    <Icon path={mdiStop} aria-hidden="true" size="18px" />
                  ) : (
                    <Icon
                      path={mdiMicrophoneOutline}
                      aria-hidden="true"
                      size="20px"
                    />
                  )}
                </IconButton>
                {speech.busy && (
                  <span className="small muted" role="status">
                    {recording ? (
                      t("Listening…")
                    ) : (
                      <>
                        <Icon
                          path={mdiLoading}
                          className="spin"
                          size="18px"
                          aria-hidden="true"
                        />
                        <span className="sr-only">{t("Transcribing…")}</span>
                      </>
                    )}
                  </span>
                )}
                {operation.busy ? (
                  <Button
                    variant="secondary"
                    onClick={() => void operation.cancel()}
                  >
                    <Icon path={mdiStop} aria-hidden="true" size="14px" />
                    {t("Stop response")}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={!message.trim() || speech.busy}
                    aria-label={t("Send message")}
                  >
                    <Icon path={mdiSend} aria-hidden="true" size="17px" />
                  </Button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        title={t("Delete conversation")}
        description={detail.data?.thread.title}
      >
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setRemove(false)}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" onClick={() => void deleteThread()}>
            {t("Delete conversation")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
