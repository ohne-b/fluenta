import { VocabularyContext } from "../components/annotated-text";
import { MissionFinish } from "./work";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "../components/icon";
import {
  mdiArrowLeft,
  mdiArrowRight,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiClockOutline,
  mdiClose,
  mdiHeadphones,
  mdiHelp,
  mdiKeyboardOutline,
  mdiLightbulbOutline,
  mdiLoading,
  mdiMessageTextOutline,
  mdiMicrophoneOutline,
  mdiRestore,
  mdiStop,
} from "@mdi/js";
import type {
  ActiveStep,
  ActivityView,
  Answer,
  Feedback,
  MutationContext,
  SessionSnapshot,
} from "@fluenta/contracts";
import { call, nonce, request, useOperation } from "../lib/ipc";
import { useAppActions } from "../lib/context";
import { useI18n } from "../lib/i18n";
import {
  Brand,
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  Modal,
} from "../components/ui";
import { MaterialView, Spans } from "../components/material";
import { GrammarHelp } from "./grammar";

const wordCount = (value: string) =>
  value.trim().split(/\s+/u).filter(Boolean).length;
function explanationHeading(activity: ActivityView) {
  const first = activity.visible_materials[0]?.blocks[0];
  return activity.task.kind === "explanation" && first?.kind === "heading"
    ? first.spans
    : undefined;
}
const initialAnswer = (step: ActiveStep): Answer =>
  step.draft ??
  (step.activity.task.kind === "explanation"
    ? { kind: "acknowledged" }
    : step.activity.task.kind === "choice"
      ? { kind: "choice", selected_ids: [] }
      : step.activity.task.kind === "order"
        ? { kind: "order", ordered_ids: [] }
        : step.activity.task.kind === "writing"
          ? { kind: "writing", text: "" }
          : { kind: "typed", text: "" });

export function SessionPage() {
  const { id } = useParams(),
    cache = useQueryClient(),
    navigate = useNavigate(),
    { t } = useI18n();
  const query = useQuery({
    queryKey: ["session", id],
    queryFn: () =>
      call(
        { command: "resume_session", payload: { session_id: id! } },
        "session",
      ),
    staleTime: 0,
  });
  const session = query.data;
  const [leave, setLeave] = useState(false),
    [grammarOpen, setGrammarOpen] = useState(false),
    [error, setError] = useState<unknown>(null),
    [closing, setClosing] = useState(false),
    [time, setTime] = useState(Date.now());
  const flush = useRef<(() => Promise<void>) | null>(null);
  const sync = (value: SessionSnapshot) => {
    cache.setQueryData(["session", id], value);
    void cache.invalidateQueries({ queryKey: ["overview"] });
    void cache.invalidateQueries({ queryKey: ["connected"] });
  };
  useEffect(() => {
    if (!session?.deadline_ms || session.session.state !== "active") return;
    const timer = setInterval(() => {
      setTime(Date.now());
      if (Date.now() >= session.deadline_ms!) void query.refetch();
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.deadline_ms, session?.session.state]);
  useEffect(() => {
    let disposed = false,
      unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flush.current?.();
          await getCurrentWindow().destroy();
        } catch (error) {
          setError(error);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const exit = async (end = false) => {
    setClosing(true);
    setError(null);
    try {
      await flush.current?.();
      if (end)
        await request({
          command: "abandon_session",
          payload: { session_id: id! },
        });
      await cache.invalidateQueries({ queryKey: ["overview"] });
      navigate("/today");
    } catch (error) {
      setError(error);
    } finally {
      setClosing(false);
    }
  };
  if (!session)
    return (
      <div className="session-shell">
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        {!query.error && <Loading />}
        <Button variant="ghost" onClick={() => navigate("/today")}>
          <Icon path={mdiArrowLeft} aria-hidden="true" size="18px" />
          {t("Back")}
        </Button>
      </div>
    );
  if (session.session.state !== "active") return <Recap session={session} />;
  const step = session.session.step,
    remaining = Math.max(
      0,
      Math.ceil(((session.deadline_ms ?? time) - time) / 1000),
    );
  return (
    <VocabularyContext
      value={{
        context: {
          session_id: session.session_id,
          step_id: step.step_id,
          expected_step_version: step.version,
        },
        allowed: session.policy.hints_allowed,
      }}
    >
      <div className="session-shell">
        <header className="session-header">
          <IconButton label={t("Close")} onClick={() => setLeave(true)}>
            <Icon path={mdiClose} aria-hidden="true" size="23px" />
          </IconButton>
          <div
            className="session-progress"
            role="progressbar"
            aria-label={t("Your course")}
            aria-valuemin={0}
            aria-valuemax={session.step_count}
            aria-valuenow={step.index}
          >
            <span
              style={{ width: `${(step.index / session.step_count) * 100}%` }}
            />
          </div>
          <span className="session-counter">
            {step.index + 1}
            <span> / {session.step_count}</span>
          </span>
          {session.deadline_ms && (
            <span
              className={`timer ${remaining < 60 ? "urgent" : ""}`}
              aria-label={`${remaining} seconds`}
            >
              <Icon path={mdiClockOutline} aria-hidden="true" size="16px" />
              {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </span>
          )}
          <IconButton
            label={t("Grammar help")}
            disabled={!session.policy.hints_allowed}
            onClick={() => setGrammarOpen(true)}
          >
            <Icon path={mdiHelp} size="23px" aria-hidden="true" />
          </IconButton>
          <Brand compact />
        </header>
        <ErrorNotice error={error} />
        <StepEditor
          key={step.step_id}
          step={step}
          session={session}
          onSync={sync}
          flushRef={flush}
          onReload={() => void query.refetch()}
        />
        <Modal
          open={grammarOpen}
          onClose={() => setGrammarOpen(false)}
          title={t("Grammar help")}
          wide
        >
          {grammarOpen && (
            <GrammarHelp
              context={{
                session_id: session.session_id,
                step_id: step.step_id,
                expected_step_version: step.version,
              }}
            />
          )}
        </Modal>
        <Modal
          open={leave}
          onClose={() => setLeave(false)}
          title={t("Leave this session?")}
          description={t(
            session.mode === "test"
              ? "The timer will keep running."
              : "Your answer and place will be saved. Come back whenever you’re ready.",
          )}
        >
          <ErrorNotice error={error} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setLeave(false)}>
              {t("Keep learning")}
            </Button>
            <Button disabled={closing} onClick={() => void exit()}>
              {t("Save and leave")}
            </Button>
          </div>
          {session.mode === "test" && (
            <button
              className="text-button danger-text"
              disabled={closing}
              onClick={() => void exit(true)}
            >
              {t("End checkpoint")}
            </button>
          )}
        </Modal>
      </div>
    </VocabularyContext>
  );
}

function StepEditor({
  step,
  session,
  onSync,
  flushRef,
  onReload,
}: {
  step: ActiveStep;
  session: SessionSnapshot;
  onSync: (value: SessionSnapshot) => void;
  flushRef: RefObject<(() => Promise<void>) | null>;
  onReload: () => void;
}) {
  const { t } = useI18n(),
    navigate = useNavigate();
  const [answer, setAnswer] = useState<Answer>(() => initialAnswer(step));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [recording, setRecording] = useState(false),
    [hintOpen, setHintOpen] = useState(false);
  const value = useRef(answer),
    sequence = useRef(step.draft_sequence),
    dirty = useRef(false),
    pending = useRef<Promise<void>>(Promise.resolve()),
    input = useRef<HTMLTextAreaElement>(null);
  const context: MutationContext = {
    session_id: session.session_id,
    step_id: step.step_id,
    expected_step_version: step.version,
  };
  const currentContext = useRef(context);
  currentContext.current = context;
  const checking = step.phase === "feedback",
    task = step.activity.task;
  const previousKind = useRef(task.kind);
  const submission = useRef<string | null>(null);
  useEffect(() => {
    if (previousKind.current !== task.kind) {
      previousKind.current = task.kind;
      const next = initialAnswer(step);
      value.current = next;
      setAnswer(next);
      sequence.current = step.draft_sequence;
      dirty.current = false;
    }
  }, [task.kind]);
  useEffect(() => {
    // A resumed query can first render its cached snapshot. Accept a newer
    // persisted draft only while there are no local edits to overwrite.
    if (!dirty.current && step.draft_sequence > sequence.current) {
      const restored = initialAnswer(step);
      value.current = restored;
      setAnswer(restored);
      sequence.current = step.draft_sequence;
    }
  }, [step.draft_sequence, step.draft]);
  const mutate = (next: Answer) => {
    submission.current = null;
    value.current = next;
    sequence.current++;
    dirty.current = true;
    setAnswer(next);
    setError(null);
  };
  const flush = async () => {
    await pending.current;
    if (!dirty.current || checking) return;
    const sent = sequence.current,
      sentValue = value.current,
      sentContext = currentContext.current;
    const save = call(
      {
        command: "save_draft",
        payload: { context: sentContext, sequence: sent, answer: sentValue },
      },
      "draft_saved",
    ).then(() => {
      if (sequence.current === sent) dirty.current = false;
    });
    pending.current = save.catch(() => {});
    await save;
  };
  flushRef.current = flush;
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      void flush().catch(setError);
    }, 400);
    return () => clearTimeout(timer);
  }, [answer, step.version]);
  const speech = useOperation((event) => {
    if (event.event.event === "recognition_ready") {
      setRecording(false);
      mutate({
        kind: "voice",
        recognition_id: event.event.payload.recognition_id,
        confirmed_text: event.event.payload.transcript,
      });
      setTimeout(() => input.current?.focus(), 0);
    }
    if (event.event.event === "recording_ready") {
      setRecording(false);
      mutate({
        kind: "recording",
        recording_id: event.event.payload.recording_id,
      });
    }
    if (["failed", "cancelled", "finished"].includes(event.event.event))
      setRecording(false);
  });
  const playback = useOperation();
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await flush();
      await action();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    perform(async () => {
      if (checking)
        onSync(
          await call(
            {
              command: "advance_session",
              payload: { context, mutation_id: nonce() },
            },
            "session",
          ),
        );
      else {
        submission.current ??= nonce();
        const next = await call(
          {
            command: "submit_answer",
            payload: {
              context,
              submission_id: submission.current,
              answer: value.current,
            },
          },
          "session",
        );
        dirty.current = false;
        submission.current = null;
        if (task.kind === "explanation" && next.session.state === "active") {
          onSync(
            await call(
              {
                command: "advance_session",
                payload: {
                  context: {
                    session_id: next.session_id,
                    step_id: next.session.step.step_id,
                    expected_step_version: next.session.step.version,
                  },
                  mutation_id: nonce(),
                },
              },
              "session",
            ),
          );
        } else onSync(next);
      }
    });
  const hint = () =>
    perform(async () => {
      const result = await call(
        { command: "reveal_hint", payload: { context, mutation_id: nonce() } },
        "hint",
      );
      onSync(result.session);
      setHintOpen(false);
    });
  const valid =
    answer.kind === "acknowledged" ||
    (answer.kind === "choice" && answer.selected_ids.length > 0) ||
    (answer.kind === "order" &&
      task.kind === "order" &&
      answer.ordered_ids.length === task.items.length) ||
    (answer.kind === "typed" && answer.text.trim().length > 0) ||
    (answer.kind === "voice" && answer.confirmed_text.trim().length > 0) ||
    (answer.kind === "writing" &&
      task.kind === "writing" &&
      wordCount(answer.text) >= task.min_words &&
      wordCount(answer.text) <= task.max_words) ||
    answer.kind === "recording";
  const startRecording = async () => {
    await perform(async () => {
      setRecording(true);
      await speech.begin({ command: "start_recording", payload: { context } });
    });
  };
  const stopRecording = async () => {
    if (!speech.id) return;
    setRecording(false);
    await request({
      command: "stop_recording",
      payload: { operation_id: speech.id },
    }).catch(setError);
  };
  const accent = (character: string) => {
    const area = input.current;
    if (!area) return;
    const before = area.selectionStart,
      after = area.selectionEnd,
      text = area.value.slice(0, before) + character + area.value.slice(after);
    if (answer.kind === "voice") mutate({ ...answer, confirmed_text: text });
    else if (answer.kind === "writing") mutate({ ...answer, text });
    else mutate({ kind: "typed", text });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(
        before + character.length,
        before + character.length,
      );
    });
  };
  return (
    <>
      <main className="exercise">
        {session.mode === "test" && (
          <div className="exercise-label">
            <span className="pill">{t("Check your skills")}</span>
          </div>
        )}
        <h1>
          <Spans
            spans={
              explanationHeading(step.activity) ?? [step.activity.instruction]
            }
          />
        </h1>
        {step.activity.visible_materials.map((material, index) => (
          <MaterialView
            key={material.content.id}
            material={
              index === 0 && explanationHeading(step.activity)
                ? { ...material, blocks: material.blocks.slice(1) }
                : material
            }
            context={context}
          />
        ))}
        {task.kind === "choice" && (
          <fieldset className="choice-list" disabled={checking || busy}>
            <legend className="sr-only">
              {t(task.multiple ? "Choose all that apply" : "Choose one answer")}
            </legend>
            {task.options.map((option, i) => {
              const selected =
                answer.kind === "choice" &&
                answer.selected_ids.includes(option.id);
              return (
                <label
                  key={option.id}
                  className={`choice-option ${selected ? "selected" : ""}`}
                >
                  <input
                    type={task.multiple ? "checkbox" : "radio"}
                    name={step.step_id}
                    checked={selected}
                    onChange={() => {
                      const ids =
                        answer.kind === "choice" ? answer.selected_ids : [];
                      mutate({
                        kind: "choice",
                        selected_ids: task.multiple
                          ? selected
                            ? ids.filter((id) => id !== option.id)
                            : [...ids, option.id]
                          : [option.id],
                      });
                    }}
                  />
                  <span className="choice-index">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span lang={option.label.language}>{option.label.text}</span>
                  <span className="choice-check">
                    {selected && (
                      <Icon path={mdiCheck} aria-hidden="true" size="17px" />
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {task.kind === "order" && answer.kind === "order" && (
          <div className="word-exercise">
            <p className="muted small">
              {t(
                "Tap words to build your sentence. Tap again to return a word.",
              )}
            </p>
            <div className="word-answer" aria-label={t("Selected words")}>
              {answer.ordered_ids.map((id, i) => {
                const item = task.items.find((item) => item.id === id)!;
                return (
                  <button
                    type="button"
                    className="word-chip"
                    key={id}
                    disabled={checking || busy}
                    lang={item.label.language}
                    onClick={() =>
                      mutate({
                        kind: "order",
                        ordered_ids: answer.ordered_ids.filter(
                          (_, index) => index !== i,
                        ),
                      })
                    }
                  >
                    {item.label.text}
                  </button>
                );
              })}
              {!answer.ordered_ids.length && (
                <span className="word-placeholder">
                  {t("Arrange the words")}
                </span>
              )}
            </div>
            <div className="word-bank" aria-label={t("Available words")}>
              {task.items.map((item) => (
                <button
                  type="button"
                  className="word-chip"
                  key={item.id}
                  lang={item.label.language}
                  disabled={
                    checking || busy || answer.ordered_ids.includes(item.id)
                  }
                  onClick={() =>
                    mutate({
                      kind: "order",
                      ordered_ids: [...answer.ordered_ids, item.id],
                    })
                  }
                >
                  {item.label.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {(task.kind === "short_answer" || task.kind === "writing") && (
          <div className="text-answer">
            <label htmlFor="spanish-answer" className="sr-only">
              {t("Your answer")}
            </label>
            <textarea
              id="spanish-answer"
              ref={input}
              lang="es"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              disabled={checking || busy}
              maxLength={task.kind === "writing" ? 12000 : 4000}
              rows={task.kind === "writing" ? 7 : 3}
              placeholder={t(
                task.kind === "writing"
                  ? "Write in Spanish…"
                  : "Type your answer in Spanish",
              )}
              value={
                answer.kind === "voice"
                  ? answer.confirmed_text
                  : answer.kind === "typed" || answer.kind === "writing"
                    ? answer.text
                    : ""
              }
              onChange={(event) =>
                mutate(
                  answer.kind === "voice"
                    ? { ...answer, confirmed_text: event.target.value }
                    : task.kind === "writing"
                      ? { kind: "writing", text: event.target.value }
                      : { kind: "typed", text: event.target.value },
                )
              }
            />
            {!checking && (
              <div className="answer-tools">
                <div className="accent-bar" aria-label="Spanish characters">
                  {["á", "é", "í", "ó", "ú", "ü", "ñ", "¿", "¡"].map((char) => (
                    <button
                      type="button"
                      key={char}
                      onClick={() => accent(char)}
                      aria-label={char}
                    >
                      {char}
                    </button>
                  ))}
                </div>
                {task.kind === "writing" && (
                  <span className="word-count">
                    {wordCount(answer.kind === "writing" ? answer.text : "")} /{" "}
                    {task.min_words}–{task.max_words} {t("words")}
                  </span>
                )}
              </div>
            )}
            {answer.kind === "voice" && (
              <p className="transcript-note">
                <Icon
                  path={mdiMicrophoneOutline}
                  aria-hidden="true"
                  size="16px"
                />
                {t("Check what we heard before submitting. You can edit it.")}
              </p>
            )}
          </div>
        )}
        {!checking &&
          ((task.kind === "short_answer" &&
            task.inputs.includes("microphone")) ||
            task.kind === "speaking") && (
            <div
              className={`voice-answer ${recording && speech.busy ? "is-recording" : ""}`}
            >
              {task.kind === "speaking" && (
                <div className="voice-orb">
                  <Icon
                    path={mdiMicrophoneOutline}
                    aria-hidden="true"
                    size="36px"
                  />
                </div>
              )}
              <Button
                variant="secondary"
                disabled={busy || (speech.busy && !recording)}
                onClick={() =>
                  void (speech.busy && recording
                    ? stopRecording()
                    : startRecording())
                }
              >
                {speech.busy ? (
                  recording ? (
                    <>
                      <Icon path={mdiStop} aria-hidden="true" size="17px" />
                      {t("Stop recording")}
                    </>
                  ) : (
                    <>
                      <Icon
                        path={mdiLoading}
                        aria-hidden="true"
                        className="spin"
                        size="17px"
                      />
                      <span className="sr-only">{t("Transcribing…")}</span>
                    </>
                  )
                ) : (
                  <>
                    <Icon
                      path={mdiMicrophoneOutline}
                      aria-hidden="true"
                      size="18px"
                    />
                    {t(
                      answer.kind === "voice" || answer.kind === "recording"
                        ? "Record again"
                        : task.kind === "speaking"
                          ? "Record your response"
                          : "Speak your answer",
                    )}
                  </>
                )}
              </Button>
              {recording && speech.busy && (
                <span role="status" className="recording-indicator">
                  {t("Listening…")}
                </span>
              )}
              {task.kind === "speaking" && (
                <>
                  <button
                    className="text-button"
                    disabled={speech.busy || busy}
                    onClick={() =>
                      void perform(async () =>
                        onSync(
                          await call(
                            {
                              command: "keyboard_alternative",
                              payload: { context },
                            },
                            "session",
                          ),
                        ),
                      )
                    }
                  >
                    <Icon
                      path={mdiKeyboardOutline}
                      aria-hidden="true"
                      size="17px"
                    />
                    {t("Type instead")}
                  </button>
                </>
              )}
            </div>
          )}
        {answer.kind === "recording" && (
          <div className="recording-result">
            <Icon path={mdiCheckCircleOutline} aria-hidden="true" size="20px" />
            <span>{t("Recording saved")}</span>
            <Button
              variant="ghost"
              disabled={playback.busy}
              onClick={() =>
                void playback.begin({
                  command: "play_recording",
                  payload: { recording_id: answer.recording_id },
                })
              }
            >
              <Icon path={mdiHeadphones} aria-hidden="true" size="17px" />
              {t("Play my recording")}
            </Button>
          </div>
        )}
        <ErrorNotice
          error={error}
          retry={
            error instanceof Error && error.message === "state.conflict"
              ? onReload
              : undefined
          }
        />
        <ErrorNotice error={speech.error} />
        <ErrorNotice error={playback.error} />
        {checking && step.feedback && (
          <FeedbackPanel feedback={step.feedback} />
        )}
        {!checking && task.kind !== "explanation" && (
          <div className="exercise-support">
            <span className="small muted">
              {error && dirty.current
                ? t("Your changes still need saving.")
                : null}
            </span>
            {session.policy.hints_allowed &&
              step.activity.hints_remaining > 0 && (
                <button
                  className="text-button"
                  disabled={busy || speech.busy}
                  onClick={() => setHintOpen(true)}
                >
                  <Icon
                    path={mdiLightbulbOutline}
                    aria-hidden="true"
                    size="17px"
                  />
                  {t("Need a hint?")}
                </button>
              )}
          </div>
        )}
      </main>
      <footer className={`exercise-footer ${checking ? "has-feedback" : ""}`}>
        <div>
          {checking && step.feedback ? (
            <span className="footer-status">
              <Icon
                path={mdiCheckCircleOutline}
                aria-hidden="true"
                size="20px"
              />
              {t(
                step.feedback.outcome === "correct"
                  ? "Correct"
                  : "Answer saved",
              )}
            </span>
          ) : null}
        </div>
        <Button
          disabled={busy || speech.busy || (!checking && !valid)}
          onClick={() => void submit()}
        >
          {busy && (
            <Icon
              path={mdiLoading}
              aria-hidden="true"
              size="17px"
              className="spin"
            />
          )}
          {t(
            checking || task.kind === "explanation"
              ? "Continue"
              : task.kind === "writing" ||
                  task.kind === "speaking" ||
                  session.mode === "test"
                ? "Save answer"
                : "Check answer",
          )}
          <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
        </Button>
      </footer>
      <Modal
        open={hintOpen}
        onClose={() => setHintOpen(false)}
        title={t("Need a hint?")}
        description={t("A hint counts as supported practice.")}
      >
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setHintOpen(false)}>
            {t("Cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void hint()}>
            {t("Show hint")}
          </Button>
        </div>
      </Modal>
      {checking && session.policy.tutor_allowed && (
        <button
          className="lesson-tutor-link text-button"
          onClick={() => navigate(`/tutor?session=${session.session_id}`)}
        >
          <Icon path={mdiMessageTextOutline} aria-hidden="true" size="15px" />
          {t("Explain something")}
        </button>
      )}
    </>
  );
}

function FeedbackPanel({ feedback }: { feedback: Feedback }) {
  const { t } = useI18n(),
    actions = useAppActions();
  const title =
    feedback.outcome === "correct"
      ? "Correct"
      : feedback.outcome === "incorrect"
        ? "Check the explanation"
        : feedback.outcome === "needs_self_review"
          ? "Review your answer"
          : "Answer saved";
  return (
    <section
      className={`feedback-panel ${feedback.outcome}`}
      aria-live="polite"
    >
      <h2>
        {feedback.outcome === "incorrect" ? (
          <Icon path={mdiRestore} aria-hidden="true" size="23px" />
        ) : (
          <Icon path={mdiCheckCircleOutline} aria-hidden="true" size="23px" />
        )}
        {t(title)}
      </h2>
      {feedback.evidence === "assisted_recall" && (
        <p className="small muted">{t("You used support for this answer.")}</p>
      )}
      {feedback.evidence === "recognized_content" && (
        <p className="small muted">
          {t("Recognised content, not a pronunciation score.")}
        </p>
      )}
      {feedback.evidence === "edited_transcript" && (
        <p className="small muted">{t("Edited transcript")}</p>
      )}
      {feedback.explanation && <MaterialView material={feedback.explanation} />}
      {feedback.rubric && (
        <>
          <p className="muted">
            {t(
              "Use the guidance below to check your work. Longer answers are not automatically graded.",
            )}
          </p>
          <div className="rubric">
            {feedback.rubric.criteria.map((criterion) => (
              <div className="rubric-item" key={criterion.id}>
                <Icon path={mdiCheck} aria-hidden="true" size="17px" />
                <div>
                  <strong lang={criterion.label.language}>
                    {criterion.label.text}
                  </strong>
                  <p lang={criterion.guidance.language}>
                    {criterion.guidance.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {feedback.rubric.model_answers.map((model) => (
            <button
              className="text-button"
              key={model.id}
              onClick={() => actions.reference(model)}
            >
              {t("Model response")}
              <Icon path={mdiArrowRight} aria-hidden="true" size="16px" />
            </button>
          ))}
        </>
      )}
    </section>
  );
}
function AnswerText({ answer }: { answer?: Answer | null }) {
  const { t } = useI18n();
  if (!answer) return <span className="muted">{t("No answer submitted")}</span>;
  if (answer.kind === "typed" || answer.kind === "writing")
    return <span lang="es">{answer.text}</span>;
  if (answer.kind === "voice")
    return <span lang="es">{answer.confirmed_text}</span>;
  if (answer.kind === "recording") return <span>{t("Recording saved")}</span>;
  return null;
}
function Recap({ session }: { session: SessionSnapshot }) {
  const { t } = useI18n(),
    navigate = useNavigate(),
    [expanded, setExpanded] = useState(false);
  const { data, error } = useQuery({
    queryKey: ["recap", session.session_id],
    queryFn: () =>
      call(
        {
          command: "get_session_review",
          payload: { session_id: session.session_id },
        },
        "session_review",
      ),
  });
  const summary =
    session.session.state === "completed" ? session.session.summary : null;
  return (
    <main className="recap-page">
      <Brand />
      <div className="recap-celebration" aria-hidden="true">
        <Icon path={mdiCheckCircleOutline} aria-hidden="true" size="58px" />
      </div>
      <h1>{t("Lesson complete")}</h1>
      {summary && (
        <div className="recap-stats">
          <div>
            <strong>{summary.objectively_marked}</strong>
            <span>{t("Answers checked")}</span>
          </div>
          <div>
            <strong>{summary.correct_unaided}</strong>
            <span>{t("Correct without hints")}</span>
          </div>
          <div>
            <strong>{summary.needs_review.length}</strong>
            <span>{t("To revisit")}</span>
          </div>
        </div>
      )}
      <div className="recap-actions">
        <Button onClick={() => navigate("/today")}>
          {t("Back to learning")}
          <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
        </Button>
        <Button variant="secondary" onClick={() => setExpanded(!expanded)}>
          {t("See your answers")}
        </Button>
      </div>
      <ErrorNotice error={error} />
      {session.session.state === "completed" && (
        <MissionFinish sessionId={session.session_id} />
      )}
      {expanded && data && (
        <div className="recap-answers">
          {data.steps.map((step, i) => (
            <details key={`${step.activity.content.id}:${i}`}>
              <summary>
                <span className="recap-index">{i + 1}</span>
                <span>
                  <Spans
                    spans={
                      explanationHeading(step.activity) ?? [
                        step.activity.instruction,
                      ]
                    }
                  />
                </span>
                {step.feedback?.outcome === "correct" && (
                  <Icon
                    path={mdiCheck}
                    aria-hidden="true"
                    className="success-text"
                    size="18px"
                  />
                )}
              </summary>
              <div className="recap-answer">
                <p>
                  <AnswerText answer={step.answer} />
                  {step.answer?.kind === "choice" &&
                    step.activity.task.kind === "choice" &&
                    step.activity.task.options
                      .filter(
                        (o) =>
                          step.answer?.kind === "choice" &&
                          step.answer.selected_ids.includes(o.id),
                      )
                      .map((o) => o.label.text)
                      .join(", ")}
                  {step.answer?.kind === "order" &&
                    step.activity.task.kind === "order" &&
                    step.answer.ordered_ids
                      .map((id) =>
                        step.activity.task.kind === "order"
                          ? step.activity.task.items.find((i) => i.id === id)
                              ?.label.text
                          : "",
                      )
                      .join(" ")}
                </p>
                {step.feedback && <FeedbackPanel feedback={step.feedback} />}
              </div>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
