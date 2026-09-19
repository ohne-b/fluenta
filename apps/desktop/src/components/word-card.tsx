import { useState } from "react";
import type { WordView, WordStatus } from "@fluenta/contracts";
import { mdiRestore, mdiPencilOutline } from "@mdi/js";
import Icon from "./icon";
import { Button, ErrorNotice } from "./ui";
import { WordAudio } from "./annotated-text";
import { useConnectedAction, useCopy } from "../lib/connected";

export function WordCard({
  word,
  compact = false,
}: {
  word: WordView;
  compact?: boolean;
}) {
  const c = useCopy(),
    action = useConnectedAction(),
    [notes, setNotes] = useState(word.notes),
    [saved, setSaved] = useState(false);
  const changeStatus = (status: WordStatus) =>
    action.run({
      action: "update_word",
      sense: word.sense.content,
      status,
      notes,
    });
  const learn = async () => {
    if (word.contexts[0])
      await action.run({
        action: "learn_word",
        occurrence: word.contexts[0].content,
        context: null,
      });
  };
  return (
    <article className={`word-card ${compact ? "compact" : ""}`}>
      <div className="word-card-heading">
        <div>
          <h3 lang="es">{word.sense.lemma}</h3>
          <p lang={word.sense.gloss.language}>{word.sense.gloss.text}</p>
        </div>
        <WordAudio word={word} />
      </div>
      {word.sense.grammar && (
        <p className="small muted" lang={word.sense.grammar.language}>
          {word.sense.grammar.text}
        </p>
      )}
      {!compact && (
        <div className="word-evidence">
          <span>
            {word.understanding} {c("understood", "verstanden")}
          </span>
          <span>
            {word.independent_recall}{" "}
            {c("independent recalls", "selbst abgerufen")}
          </span>
          <span>
            {word.spoken_recognition}{" "}
            {c("spoken answers recognised", "erkannte Sprechantworten")}
          </span>
          <span>
            {word.productive_attempts}{" "}
            {c(
              "production attempts · self-review",
              "Produktionsversuche · Selbstprüfung",
            )}
          </span>
          {word.assisted_recall > 0 && (
            <span>
              {word.assisted_recall} {c("assisted", "mit Hilfe")}
            </span>
          )}
        </div>
      )}
      <div className="connected-actions">
        {word.status !== "active" ? (
          <Button
            disabled={action.busy}
            variant="secondary"
            onClick={() => void learn()}
          >
            {c("Learn this", "Lernen")}
          </Button>
        ) : !compact ? (
          <>
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run({
                  action: "review_words",
                  sense: word.sense.content,
                  production: false,
                })
              }
            >
              <Icon path={mdiRestore} size="16px" />
              {c("Recall", "Abrufen")}
            </Button>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={() =>
                void action.run({
                  action: "review_words",
                  sense: word.sense.content,
                  production: true,
                })
              }
            >
              <Icon path={mdiPencilOutline} size="16px" />
              {c("Use it", "Anwenden")}
            </Button>
          </>
        ) : (
          <span className="success-text small">
            {c("In your learning list", "In deiner Lernliste")}
          </span>
        )}
        {!compact && word.status === "active" && (
          <span className="small muted">
            {word.due_ms
              ? `${c("Next recall", "Nächster Abruf")}: ${new Date(word.due_ms).toLocaleDateString()}`
              : c("Ready for first recall", "Bereit für den ersten Abruf")}
          </span>
        )}
      </div>
      {!compact && (
        <details>
          <summary>
            {c("Contexts & personal notes", "Kontexte und eigene Notizen")}{" "}
            <span className="muted">({word.contexts.length})</span>
          </summary>
          {word.contexts.map((context) => (
            <blockquote key={context.content.id}>
              <p lang="es">{context.context.text}</p>
              <small lang={context.meaning.language}>
                {context.meaning.text}
              </small>
            </blockquote>
          ))}
          <label className="field-label">
            {c("Your notes", "Deine Notizen")}
            <textarea
              rows={3}
              maxLength={8000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="connected-actions">
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={async () => {
                const result = await changeStatus(word.status);
                if (result) setSaved(true);
              }}
            >
              {saved
                ? c("Saved", "Gespeichert")
                : c("Save notes", "Notizen speichern")}
            </Button>
            <select
              aria-label={c("Study status", "Lernstatus")}
              value={word.status}
              disabled={action.busy}
              onChange={(e) => void changeStatus(e.target.value as WordStatus)}
            >
              <option value="active">{c("Learning", "In Lernliste")}</option>
              <option value="recent">
                {c("Recently encountered", "Zuletzt entdeckt")}
              </option>
              <option value="paused">{c("Paused", "Pausiert")}</option>
              <option value="archived">{c("Archived", "Archiviert")}</option>
            </select>
          </div>
          <p className="small muted">
            {c(
              "Seeing or saving a word does not establish recall. Production counts are attempts, not verified successful reuse. Speech recognition does not assess pronunciation or spelling.",
              "Sehen und Speichern belegen keinen Abruf. Produktionszahlen zählen Versuche, keine bestätigte gelungene Anwendung. Spracherkennung bewertet weder Aussprache noch Rechtschreibung.",
            )}
          </p>
        </details>
      )}
      <ErrorNotice error={action.error} />
    </article>
  );
}
