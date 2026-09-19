import { request } from "../lib/ipc";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { MissionView, Source, SupportLevel } from "@fluenta/contracts";
import Icon from "../components/icon";
import {
  mdiArrowLeft,
  mdiArrowRight,
  mdiCheck,
  mdiClockOutline,
  mdiHeartOutline,
  mdiHeart,
  mdiBookOpenPageVariantOutline,
  mdiEarth,
  mdiAccountGroupOutline,
  mdiMessageTextOutline,
  mdiLeaf,
  mdiPaletteOutline,
  mdiHistory,
} from "@mdi/js";
import { PageHeading } from "../components/page-heading";
import { Button, ErrorNotice, Loading } from "../components/ui";
import { useConnected, useConnectedAction, useCopy } from "../lib/connected";

const icons: Record<string, string> = {
  migration: mdiAccountGroupOutline,
  "spain-memory": mdiHistory,
  "latin-america": mdiEarth,
  language: mdiMessageTextOutline,
  media: mdiMessageTextOutline,
  sustainability: mdiLeaf,
  world: mdiEarth,
  arts: mdiPaletteOutline,
};
function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault();
          void request({ command: "open_source", payload: { url } }).catch(
            setError,
          );
        }}
      >
        {children}
      </a>
      <ErrorNotice error={error} />
    </>
  );
}
export function Sources({ sources }: { sources: Source[] }) {
  const c = useCopy();
  return (
    <details className="content-sources">
      <summary>
        {c("Sources & editorial scope", "Quellen und Einordnung")}
      </summary>
      {sources.map((source, i) => (
        <div key={`${source.url}:${i}`}>
          <SourceLink url={source.url}>{source.title}</SourceLink>
          <p>{source.note.text}</p>
          <small>
            {c("Checked", "Geprüft")}: {source.accessed}
          </small>
        </div>
      ))}
    </details>
  );
}
export function Topics() {
  const { topicId } = useParams(),
    c = useCopy(),
    query = useConnected({ action: "today" }, "today"),
    action = useConnectedAction();
  const [band, setBand] = useState("");
  if (!query.data)
    return (
      <div className="page">
        <ErrorNotice error={query.error} />
        <Loading />
      </div>
    );
  const data = query.data,
    current = data.topics.find((t) => t.topic.content.id === topicId);
  if (topicId && !current)
    return (
      <div className="page">
        <Link to="/topics">{c("Back to topics", "Zur Themenübersicht")}</Link>
      </div>
    );
  if (current)
    return (
      <div className="page connected-page topic-detail">
        <Link className="text-button back-link" to="/topics">
          <Icon path={mdiArrowLeft} size="17px" />
          {c("Topics", "Themen")}
        </Link>
        <PageHeading>
          <h1>{current.topic.title.text}</h1>
        </PageHeading>
        <div
          className={`topic-introduction theme-${current.topic.content.id.split(".")[1]}`}
        >
          <h2 lang="es">{current.topic.question.text}</h2>
          <p>{current.topic.description.text}</p>
          <ul>
            {current.topic.outcomes.map((o, i) => (
              <li key={i}>
                <Icon path={mdiCheck} size="17px" />
                {o.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="section-heading">
          <h2>{c("Available chapters", "Verfügbare Kapitel")}</h2>
          <span className="muted">
            {current.missions.length} {c("complete", "vollständig")}
          </span>
        </div>
        <div className="mission-list">
          {current.missions.map((mission, i) => (
            <MissionCard
              key={mission.mission.content.id}
              view={mission}
              index={i + 1}
            />
          ))}
        </div>
        <Sources sources={current.topic.sources} />
        <Benchmark compact />
      </div>
    );
  return (
    <div className="page connected-page">
      <PageHeading>
        <h1>
          {c(
            "Find something worth talking about",
            "Worüber möchtest du sprechen?",
          )}
        </h1>
      </PageHeading>
      <div className="connected-toolbar">
        <label>
          {c("Language difficulty", "Sprachliche Schwierigkeit")}
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">{c("All entry points", "Alle Einstiege")}</option>
            {["A2", "B1", "B2"].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <Link className="text-button" to="/learn">
          <Icon path={mdiBookOpenPageVariantOutline} size="19px" />
          {c("Start with the foundations", "Mit den Grundlagen beginnen")}
        </Link>
      </div>
      <ErrorNotice error={action.error} />
      <div className="topic-grid">
        {data.topics
          .filter(
            (topic) =>
              !band || topic.missions.some((m) => m.mission.band === band),
          )
          .map(({ topic, missions }) => {
            const chosen = data.interests.includes(topic.content.id);
            return (
              <article
                className={`topic-card theme-${topic.content.id.split(".")[1]}`}
                key={topic.content.id}
              >
                <div className="topic-card-top">
                  <span className="topic-symbol">
                    <Icon
                      path={
                        icons[topic.content.id.split(".")[1] ?? ""] ??
                        mdiBookOpenPageVariantOutline
                      }
                      size="29px"
                    />
                  </span>
                  <button
                    className="icon-button"
                    aria-pressed={chosen}
                    aria-label={`${c("Follow topic", "Thema merken")}: ${topic.title.text}`}
                    disabled={action.busy}
                    onClick={() =>
                      void action.run({
                        action: "interests",
                        topics: chosen
                          ? data.interests.filter(
                              (id) => id !== topic.content.id,
                            )
                          : [...data.interests, topic.content.id],
                      })
                    }
                  >
                    <Icon
                      path={chosen ? mdiHeart : mdiHeartOutline}
                      size="20px"
                    />
                  </button>
                </div>
                <Link
                  className="topic-card-link"
                  to={`/topics/${topic.content.id}`}
                >
                  <h2>{topic.title.text}</h2>
                  <p lang="es">{topic.question.text}</p>
                  <div className="topic-card-meta">
                    <span>
                      {missions.length}{" "}
                      {c(
                        missions.length === 1
                          ? "introductory mission"
                          : "connected chapters",
                        missions.length === 1
                          ? "Einstiegsmission"
                          : "verbundene Kapitel",
                      )}
                    </span>
                    <Icon path={mdiArrowRight} size="19px" />
                  </div>
                </Link>
              </article>
            );
          })}
      </div>
      <Benchmark compact />
    </div>
  );
}
export function MissionCard({
  view,
  index,
}: {
  view: MissionView;
  index?: number;
}) {
  const c = useCopy(),
    action = useConnectedAction();
  const [support, setSupport] = useState<SupportLevel>("learn");
  const mission = view.mission;
  return (
    <article className="mission-card">
      <div className="mission-number" aria-hidden="true">
        {view.completed ? (
          <Icon path={mdiCheck} size="22px" />
        ) : (
          (index ?? <Icon path={mdiBookOpenPageVariantOutline} size="24px" />)
        )}
      </div>
      <div className="mission-card-body">
        <div className="mission-title">
          <h3 lang="es">{mission.title.text}</h3>
          <span className="level-tag">{mission.band}</span>
        </div>
        <p>{mission.outcome.text}</p>
        <div className="mission-meta">
          <Icon path={mdiClockOutline} size="16px" />
          {view.minutes} {c("min · pause and resume", "Min. · pausierbar")}
        </div>
        <details className="mission-options">
          <summary>
            {c(
              "Support & independent challenge",
              "Hilfen und unabhängige Aufgabe",
            )}
          </summary>
          <label>
            {c("Support level", "Unterstützung")}
            <select
              value={support}
              onChange={(e) => setSupport(e.target.value as SupportLevel)}
            >
              <option value="learn">
                {c(
                  "Learn · preparation and help",
                  "Lernen · Vorbereitung und Hilfen",
                )}
              </option>
              <option value="independent">
                {c(
                  "Independent · attempt first",
                  "Selbstständig · zuerst versuchen",
                )}
              </option>
              <option value="rehearsal">
                {c(
                  "Exam rehearsal · new source",
                  "Prüfungstraining · neue Quelle",
                )}
              </option>
            </select>
          </label>
          <p className="small muted">
            {support === "rehearsal"
              ? c(
                  "20–30 minute editorial practice task; help is blocked and feedback follows submission. This is not a full state exam simulation.",
                  "Redaktionelle Übungsaufgabe mit 20–30 Minuten; Hilfen sind gesperrt, Feedback folgt danach. Keine vollständige Landesprüfung.",
                )
              : support === "independent"
                ? c(
                    "Preparation is skipped. Requested translations and help are recorded as assistance.",
                    "Die Vorbereitung wird übersprungen. Angeforderte Übersetzungen und Hilfen werden erfasst.",
                  )
                : c(
                    "Read, practise useful language, then make your own response. All help stays available.",
                    "Lesen, nützliche Sprache üben und selbst antworten. Hilfen bleiben verfügbar.",
                  )}
          </p>
          {support === "rehearsal" && view.challenge_seen && (
            <p className="small">
              {c(
                "You have already opened this challenge. A repeat will not count as unseen work.",
                "Du hast diese Aufgabe bereits geöffnet. Eine Wiederholung zählt nicht als neue Quelle.",
              )}
            </p>
          )}
          <p className="small muted">{mission.attribution.text}</p>
          <Sources sources={mission.sources} />
        </details>
        <div className="connected-actions">
          {view.resume && (
            <Link className="button primary" to={`/session/${view.resume}`}>
              {c("Resume", "Fortsetzen")}
            </Link>
          )}
          <Button
            variant={view.resume ? "secondary" : "primary"}
            disabled={action.busy}
            onClick={() =>
              void action.run({
                action: "start_mission",
                mission: mission.content,
                support,
              })
            }
          >
            {support === "rehearsal"
              ? c("Open challenge", "Aufgabe öffnen")
              : view.completed
                ? c("Practise again", "Erneut üben")
                : c("Start mission", "Mission starten")}
            <Icon path={mdiArrowRight} size="18px" />
          </Button>
          {view.unseen_completed && (
            <span className="small success-text">
              {c(
                "Unseen task submitted · self-review",
                "Neue Aufgabe abgegeben · Selbstprüfung",
              )}
            </span>
          )}
        </div>
        <ErrorNotice error={action.error} />
      </div>
    </article>
  );
}
export function Benchmark({ compact = false }: { compact?: boolean }) {
  const c = useCopy();
  return (
    <details className="benchmark" open={compact ? undefined : true}>
      <summary>
        {c(
          "General Abitur · curriculum benchmark",
          "Allgemeines Abitur · Lehrplanbezug",
        )}
      </summary>
      <p>
        {c(
          "Practise summary, analysis, comparison, discussion, literary and visual interpretation, and audience-aware mediation. No state or exam year is required.",
          "Übe Zusammenfassung, Analyse, Vergleich, Diskussion, literarische und visuelle Deutung sowie adressatengerechte Sprachmittlung. Ohne Auswahl eines Bundeslands oder Prüfungsjahrs.",
        )}
      </p>
      <p>
        {c(
          "Advanced reference: Bayern, continued Spanish, erhöhtes Anforderungsniveau / Leistungsfach, years 12–13. The topic collections are Fluenta’s editorial organisation. This library does not cover the full syllabus or certify a proficiency level; reading complex material and producing language independently are tracked separately.",
          "Anspruchsvolle Referenz: Bayern, fortgeführtes Spanisch, erhöhtes Anforderungsniveau / Leistungsfach, Jahrgangsstufen 12–13. Die Themen sind Fluenta-redaktionell gegliedert. Diese Bibliothek deckt nicht den gesamten Lehrplan ab und zertifiziert kein Sprachniveau; komplexes Lesen und selbstständige Sprachproduktion werden getrennt betrachtet.",
        )}
      </p>
      <p className="small">
        {c(
          "Bayern’s illustrative written format from 2026 specifies 30 minutes of listening and 285 minutes for writing/mediation. The short tasks here are practice, not that full exam. Audio in the missions is synthetic unless a recording is explicitly labelled otherwise.",
          "Das illustrierende bayerische schriftliche Format ab 2026 sieht 30 Minuten Hörverstehen und 285 Minuten Schreiben/Sprachmittlung vor. Die kurzen Aufgaben hier sind Übung, keine solche Gesamtprüfung. Missionsaudio ist synthetisch, sofern eine Aufnahme nicht anders gekennzeichnet ist.",
        )}
      </p>
      <div className="connected-actions">
        <SourceLink url="https://www.lehrplanplus.bayern.de/fachlehrplan/gymnasium/12/spanisch/erhoeht">
          LehrplanPLUS
        </SourceLink>
        <SourceLink url="https://www.isb.bayern.de/schularten/gymnasium/faecher/spanisch/illustrierende-pruefungsaufgaben/">
          ISB · {c("illustrative tasks", "illustrierende Aufgaben")}
        </SourceLink>
      </div>
    </details>
  );
}
