import { useState } from "react";
import { Link } from "react-router-dom";
import type { WordStatus } from "@fluenta/contracts";
import Icon from "../components/icon";
import { mdiMagnify, mdiRestore, mdiArrowRight } from "@mdi/js";
import { PageHeading } from "../components/page-heading";
import { Button, ErrorNotice, Loading } from "../components/ui";
import { WordCard } from "../components/word-card";
import { useConnected, useConnectedAction, useCopy } from "../lib/connected";
import { Notebook } from "./work";

export function MyWords() {
  const c = useCopy(),
    query = useConnected({ action: "words" }, "words"),
    topics = useConnected({ action: "today" }, "today"),
    action = useConnectedAction();
  const [search, setSearch] = useState(""),
    [topic, setTopic] = useState(""),
    [status, setStatus] = useState<WordStatus>("active"),
    [notebook, setNotebook] = useState(false);
  const labels: Record<WordStatus, string> = {
    active: c("Learning", "In Lernliste"),
    recent: c("Recently encountered", "Zuletzt entdeckt"),
    paused: c("Paused", "Pausiert"),
    archived: c("Archived", "Archiviert"),
  };
  const words = query.data?.filter(
    (w) =>
      w.status === status &&
      (!topic || w.sense.topics?.includes(topic)) &&
      [w.sense.lemma, w.sense.gloss.text, w.notes]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="page connected-page">
      <PageHeading>
        <h1>{c("Your vocabulary", "Dein Wortschatz")}</h1>
      </PageHeading>
      <div
        className="segmented connected-tabs"
        aria-label={c("Personal collection", "Persönliche Sammlung")}
      >
        <button aria-pressed={!notebook} onClick={() => setNotebook(false)}>
          {c("My words", "Meine Wörter")}
        </button>
        <button aria-pressed={notebook} onClick={() => setNotebook(true)}>
          {c("Notebook", "Notizbuch")}
        </button>
      </div>
      {notebook ? (
        <Notebook />
      ) : (
        <>
          <div className="connected-toolbar word-filters">
            <label className="word-search">
              <Icon path={mdiMagnify} size="19px" />
              <input
                aria-label={c(
                  "Search words and notes",
                  "Wörter und Notizen suchen",
                )}
                placeholder={c(
                  "Search words and notes",
                  "Wörter und Notizen suchen",
                )}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">{c("Topic", "Thema")}</span>
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">{c("All topics", "Alle Themen")}</option>
                {topics.data?.topics.map(({ topic }) => (
                  <option key={topic.content.id} value={topic.content.id}>
                    {topic.title.text}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={
                action.busy ||
                !query.data?.some(
                  (w) =>
                    w.status === "active" &&
                    (!w.due_ms || w.due_ms <= Date.now()),
                )
              }
              onClick={() =>
                void action.run({
                  action: "review_words",
                  sense: null,
                  production: false,
                })
              }
            >
              <Icon path={mdiRestore} size="18px" />
              {c("Review due words", "Fällige Wörter üben")}
            </Button>
          </div>
          <div
            className="word-status-tabs"
            role="group"
            aria-label={c("Word status", "Lernstatus")}
          >
            {(Object.keys(labels) as WordStatus[]).map((value) => (
              <button
                key={value}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {labels[value]}{" "}
                <span>
                  {query.data?.filter((w) => w.status === value).length ?? 0}
                </span>
              </button>
            ))}
          </div>
          <ErrorNotice error={query.error ?? action.error} />
          {!query.data && !query.error && <Loading />}
          {words?.length === 0 && (
            <div className="connected-empty">
              <h2>
                {search.trim() || topic
                  ? c("No matching expressions", "Keine passenden Wendungen")
                  : c(
                      "No expressions in this view",
                      "Keine Wendungen in dieser Ansicht",
                    )}
              </h2>
              {search.trim() || topic ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setSearch("");
                    setTopic("");
                  }}
                >
                  {c("Clear filters", "Filter zurücksetzen")}
                </button>
              ) : (
                <>
                  <p>
                    {c(
                      "Open an underlined expression in a mission and choose “Learn this”.",
                      "Öffne eine unterstrichene Wendung in einer Mission und wähle „Lernen“.",
                    )}
                  </p>
                  <Link className="text-button" to="/topics">
                    {c("Explore topics", "Themen entdecken")}
                    <Icon path={mdiArrowRight} size="17px" />
                  </Link>
                </>
              )}
            </div>
          )}
          <div className="word-list">
            {words?.map((word) => (
              <WordCard key={word.sense.content.id} word={word} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
