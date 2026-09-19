import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  Answer,
  ContentRef,
  NotebookEntry,
  ProductionRecord,
  SelfReview,
} from "@fluenta/contracts";
import Icon from "../components/icon";
import {
  mdiVolumeHigh,
  mdiStop,
  mdiPencilOutline,
  mdiNotebookOutline,
  mdiDeleteOutline,
  mdiMicrophoneOutline,
} from "@mdi/js";
import { Button, ErrorNotice } from "../components/ui";
import { useConnected, useConnectedAction, useCopy } from "../lib/connected";
import { useAppActions } from "../lib/context";
import { request, useOperation } from "../lib/ipc";
import { WordCard } from "../components/word-card";

export function AnswerDisplay({ answer }: { answer: Answer }) {
  const c = useCopy(),
    audio = useOperation();
  if (answer.kind === "recording")
    return (
      <>
        <Button
          variant="secondary"
          onClick={() =>
            audio.busy
              ? void audio.cancel()
              : void audio.begin({
                  command: "play_recording",
                  payload: { recording_id: answer.recording_id },
                })
          }
        >
          <Icon path={audio.busy ? mdiStop : mdiVolumeHigh} size="18px" />
          {c("Listen to your recording", "Eigene Aufnahme anhören")}
        </Button>
        <ErrorNotice error={audio.error} />
      </>
    );
  const text =
    answer.kind === "writing" || answer.kind === "typed"
      ? answer.text
      : answer.kind === "voice"
        ? answer.confirmed_text
        : "";
  return (
    <p className="preserved-answer" lang="es">
      {text}
    </p>
  );
}
export function ProductionEditor({ record }: { record: ProductionRecord }) {
  const c = useCopy(),
    action = useConnectedAction(),
    app = useAppActions();
  const last = record.revisions.at(-1),
    base = last?.answer ?? record.original;
  const [revision, setRevision] = useState(
      base.kind === "writing" || base.kind === "typed" ? base.text : "",
    ),
    [criteria, setCriteria] = useState<Record<string, SelfReview>>(
      last?.criteria ?? {},
    ),
    [saved, setSaved] = useState(false);
  const [recorded, setRecorded] = useState<Answer>();
  const recorder = useOperation((event) => {
    if (event.event.event === "recording_ready")
      setRecorded({
        kind: "recording",
        recording_id: event.event.payload.recording_id,
      });
  });
  const rubric = record.feedback.rubric;
  return (
    <details className="production-record">
      <summary>
        <span>{new Date(record.created_ms).toLocaleDateString()}</span>
        <span>{record.activity.instruction.text}</span>
      </summary>
      <div className="production-body">
        <div className="revision-comparison">
          <section>
            <h3>{c("First attempt", "Erster Versuch")}</h3>
            <p className="small muted">
              {record.assisted
                ? c(
                    "Assistance used · self-review",
                    "Mit Hilfe · Selbstprüfung",
                  )
                : c(
                    "Independent attempt · self-review",
                    "Selbstständiger Versuch · Selbstprüfung",
                  )}
            </p>
            <AnswerDisplay answer={record.original} />
          </section>
          <section>
            <h3>{c("Your revision", "Deine Überarbeitung")}</h3>
            <textarea
              aria-label={c("Revised response", "Überarbeitete Antwort")}
              rows={8}
              maxLength={40000}
              value={revision}
              onChange={(e) => {
                setRevision(e.target.value);
                setSaved(false);
              }}
            />
            <small className="muted">
              {revision.trim().split(/\s+/u).filter(Boolean).length}{" "}
              {c("words", "Wörter")}
            </small>
          </section>
        </div>
        {record.activity.task.kind === "speaking" && (
          <div className="connected-actions">
            <Button
              variant="secondary"
              onClick={() =>
                recorder.busy && recorder.id
                  ? void request({
                      command: "stop_recording",
                      payload: { operation_id: recorder.id },
                    })
                  : void recorder.begin({
                      command: "start_recording",
                      payload: { context: record.context },
                    })
              }
            >
              <Icon
                path={recorder.busy ? mdiStop : mdiMicrophoneOutline}
                size="18px"
              />
              {recorder.busy
                ? c("Stop recording", "Aufnahme stoppen")
                : c("Record a new version", "Neue Fassung aufnehmen")}
            </Button>
            {recorded && (
              <>
                <AnswerDisplay answer={recorded} />
                <Button
                  disabled={action.busy || recorder.busy}
                  onClick={() =>
                    void action.run({
                      action: "revise",
                      step_id: record.step_id,
                      answer: recorded,
                      criteria,
                    })
                  }
                >
                  {c(
                    "Save recorded revision",
                    "Aufgenommene ?berarbeitung speichern",
                  )}
                </Button>
              </>
            )}
            <ErrorNotice error={recorder.error} />
          </div>
        )}
        <div className="self-review-grid">
          {rubric?.criteria.map((criterion) => (
            <label key={criterion.id}>
              <strong>{criterion.label.text}</strong>
              <span>{criterion.guidance.text}</span>
              <select
                value={criteria[criterion.id] ?? "not_assessed"}
                onChange={(e) =>
                  setCriteria({
                    ...criteria,
                    [criterion.id]: e.target.value as SelfReview,
                  })
                }
              >
                <option value="not_assessed">
                  {c("Not assessed", "Nicht beurteilt")}
                </option>
                <option value="developing">
                  {c("Needs another look", "Noch überarbeiten")}
                </option>
                <option value="met">
                  {c(
                    "Meets this criterion · my assessment",
                    "Erfüllt · meine Einschätzung",
                  )}
                </option>
              </select>
            </label>
          ))}
        </div>
        <div className="connected-actions">
          <Button
            disabled={action.busy || !revision.trim()}
            onClick={async () => {
              const result = await action.run({
                action: "revise",
                step_id: record.step_id,
                answer: { kind: "writing", text: revision },
                criteria,
              });
              if (result) setSaved(true);
            }}
          >
            <Icon path={mdiPencilOutline} size="18px" />
            {saved
              ? c("Revision saved", "Überarbeitung gespeichert")
              : c("Save revision", "Überarbeitung speichern")}
          </Button>
          {rubric?.model_answers.map((r) => (
            <button
              className="text-button"
              key={r.id}
              onClick={() => app.reference(r)}
            >
              {c("Compare a model response", "Mit einem Beispiel vergleichen")}
            </button>
          ))}
          <Link
            className="text-button"
            to={`/tutor?session=${record.session_id}`}
          >
            {c("Ask the optional tutor", "Optionalen Tutor fragen")}
          </Link>
        </div>
        <ErrorNotice error={action.error} />
        {record.revisions.length > 0 && (
          <details>
            <summary>
              {record.revisions.length}{" "}
              {c("saved revisions", "gespeicherte Überarbeitungen")}
            </summary>
            {record.revisions.map((r) => (
              <div className="saved-revision" key={r.id}>
                <small>{new Date(r.created_ms).toLocaleString()}</small>
                <AnswerDisplay answer={r.answer} />
              </div>
            ))}
          </details>
        )}
      </div>
    </details>
  );
}
export function WorkHistory() {
  const c = useCopy(),
    query = useConnected({ action: "productions" }, "productions");
  return (
    <section className="work-history">
      <h2>{c("Your writing & speaking", "Deine Texte und Aufnahmen")}</h2>
      <p className="muted">
        {c(
          "Compare your first attempt with a later revision. Rubric judgements are your own; these are not automatic grades.",
          "Vergleiche den ersten Versuch mit einer späteren Überarbeitung. Die Kriterien schätzt du selbst ein; es sind keine automatischen Noten.",
        )}
      </p>
      <ErrorNotice error={query.error} />
      {query.data?.length === 0 && (
        <p>
          {c(
            "Complete a production task in a mission to start your collection.",
            "Schließe eine Schreib- oder Sprechaufgabe in einer Mission ab.",
          )}
        </p>
      )}
      {query.data?.map((record) => (
        <ProductionEditor key={record.step_id} record={record} />
      ))}
    </section>
  );
}
export function MissionFinish({ sessionId }: { sessionId: string }) {
  const c = useCopy(),
    query = useConnected({ action: "recap", session_id: sessionId }, "recap"),
    today = useConnected({ action: "today" }, "today");
  const data = query.data;
  if (!data) return <ErrorNotice error={query.error} />;
  return (
    <div className="mission-finish">
      {data.mission && (
        <>
          <h2 lang="es">{data.mission.title.text}</h2>
          <p>{data.mission.outcome.text}</p>
          <Link className="text-button" to="/topics">
            {c("Continue with a topic", "Mit einem Thema weitermachen")}
          </Link>
        </>
      )}
      {data.suggestions.length > 0 && (
        <section>
          <h2>
            {c(
              "Take a few expressions with you",
              "Nimm ein paar Wendungen mit",
            )}
          </h2>
          <p className="muted">
            {today.data?.new_word_limit === 0
              ? c(
                  "Your review queue is full. You can save more, but practising your existing words comes first today.",
                  "Deine Wiederholungsliste ist voll. Du kannst mehr speichern; heute sind vorhandene Wörter wichtiger.",
                )
              : c(
                  "Choose the expressions you expect to use. Saving is a start, not evidence of mastery.",
                  "Wähle Wendungen, die du selbst brauchen kannst. Speichern ist ein Anfang, kein Beherrschungsnachweis.",
                )}
          </p>
          <div className="recap-word-grid">
            {data.suggestions
              .slice(0, today.data?.new_word_limit ?? 3)
              .map((word) => (
                <WordCard key={word.sense.content.id} word={word} compact />
              ))}
          </div>
          <details>
            <summary>
              {c(
                "All useful expressions from this mission",
                "Alle nützlichen Wendungen dieser Mission",
              )}
            </summary>
            {data.suggestions
              .slice(today.data?.new_word_limit ?? 3)
              .map((word) => (
                <WordCard key={word.sense.content.id} word={word} compact />
              ))}
          </details>
        </section>
      )}
      {data.productions.length > 0 && (
        <section>
          <h2>{c("Review, then revise", "Prüfen und überarbeiten")}</h2>
          {data.productions.map((record) => (
            <ProductionEditor key={record.step_id} record={record} />
          ))}
        </section>
      )}
    </div>
  );
}
export function SaveArgument({ source }: { source: ContentRef }) {
  const c = useCopy(),
    action = useConnectedAction(),
    [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [counterargument, setCounterargument] = useState("");
  return (
    <div className="argument-tool">
      <button
        className="text-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Icon path={mdiNotebookOutline} size="16px" />
        {c("Keep an argument", "Argument merken")}
      </button>
      {open && (
        <div className="argument-editor">
          <label>
            {c(
              "Your argument · grounded in this source",
              "Dein Argument · mit Bezug auf diese Quelle",
            )}
            <textarea
              value={text}
              maxLength={8000}
              rows={3}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            {c(
              "Switch sides: a reasonable counterargument",
              "Seitenwechsel: ein begründeter Einwand",
            )}
            <textarea
              value={counterargument}
              maxLength={8000}
              rows={2}
              onChange={(e) => setCounterargument(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!text.trim() || action.busy}
            onClick={async () => {
              const result = await action.run({
                action: "save_argument",
                id: null,
                source,
                text,
                counterargument,
              });
              if (result) {
                setOpen(false);
                setText("");
                setCounterargument("");
              }
            }}
          >
            {c("Save to notebook", "Im Notizbuch speichern")}
          </Button>
          <ErrorNotice error={action.error} />
        </div>
      )}
    </div>
  );
}
export function Notebook() {
  const c = useCopy(),
    query = useConnected({ action: "notebook" }, "notebook");
  return (
    <section>
      <p className="muted">
        {c(
          "Arguments you keep beside their sources, with room for a different perspective.",
          "Eigene Argumente mit Quellenbezug und Platz für eine andere Perspektive.",
        )}
      </p>
      <ErrorNotice error={query.error} />
      {query.data?.length === 0 && (
        <p>
          {c(
            "Use “Keep an argument” beside a mission reading to start.",
            "Nutze „Argument merken“ neben einem Lesetext in einer Mission.",
          )}
        </p>
      )}
      {query.data?.map((entry) => (
        <ArgumentEntry key={entry.id} entry={entry} />
      ))}
    </section>
  );
}
function ArgumentEntry({ entry }: { entry: NotebookEntry }) {
  const c = useCopy(),
    action = useConnectedAction(),
    app = useAppActions();
  const [text, setText] = useState(entry.text),
    [counterargument, setCounterargument] = useState(entry.counterargument);
  return (
    <article className="argument-card">
      <button
        className="text-button"
        onClick={() => app.reference(entry.source)}
      >
        {entry.source_title}
      </button>
      <label>
        {c("Argument", "Argument")}
        <textarea
          rows={3}
          value={text}
          maxLength={8000}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        {c("Counterargument", "Gegenargument")}
        <textarea
          rows={2}
          value={counterargument}
          maxLength={8000}
          onChange={(e) => setCounterargument(e.target.value)}
        />
      </label>
      <div className="connected-actions">
        <Button
          variant="secondary"
          disabled={action.busy || !text.trim()}
          onClick={() =>
            void action.run({
              action: "save_argument",
              id: entry.id,
              source: entry.source,
              text,
              counterargument,
            })
          }
        >
          {c("Save changes", "Änderungen speichern")}
        </Button>
        <Button
          variant="ghost"
          disabled={action.busy}
          aria-label={c("Delete argument", "Argument löschen")}
          onClick={() =>
            void action.run({ action: "delete_argument", id: entry.id })
          }
        >
          <Icon path={mdiDeleteOutline} size="18px" />
        </Button>
      </div>
      <ErrorNotice error={action.error} />
    </article>
  );
}
