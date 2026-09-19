import { Link } from "react-router-dom";
import Icon from "../components/icon";
import {
  mdiArrowRight,
  mdiRestore,
  mdiBookOpenPageVariantOutline,
} from "@mdi/js";
import { PageHeading } from "../components/page-heading";
import { Button, ErrorNotice, Loading } from "../components/ui";
import { useConnected, useConnectedAction, useCopy } from "../lib/connected";
import { useOverview } from "../lib/context";
import { useStartSession } from "./learn";

export function Today() {
  const c = useCopy(),
    query = useConnected({ action: "today" }, "today"),
    overview = useOverview(),
    action = useConnectedAction(),
    foundation = useStartSession();
  if (!query.data || !overview.data)
    return (
      <div className="page">
        {query.error || overview.error ? (
          <ErrorNotice
            error={query.error ?? overview.error}
            retry={() => {
              void query.refetch();
              void overview.refetch();
            }}
          />
        ) : (
          <Loading />
        )}
      </div>
    );
  const data = query.data,
    current = overview.data,
    mission = data.recommended;
  const beginner = current.settings.starting_band === "A1",
    reviewCount = data.due + current.due_reviews;
  return (
    <div className="page connected-page today-page">
      <PageHeading>
        <h1>{c("Your next step", "Dein nächster Schritt")}</h1>
      </PageHeading>
      <div className="today-layout">
        <section className="daily-mission">
          <h2 lang={beginner ? undefined : "es"}>
            {beginner
              ? c(
                  "Build your Spanish foundations",
                  "Baue deine Spanischgrundlagen auf",
                )
              : (mission?.mission.title.text ??
                c("Choose your next question", "Wähle deine nächste Frage"))}
          </h2>
          <p>
            {beginner
              ? c(
                  "Work with everyday school language, sentence patterns and short responses.",
                  "Übe Sprache für den Schulalltag, Satzmuster und kurze eigene Antworten.",
                )
              : mission?.mission.outcome.text}
          </p>
          <div className="daily-sequence">
            <span>{c("Recall", "Erinnern")}</span>
            <span>{c("Read & listen", "Lesen & hören")}</span>
            <span>{c("Use it", "Anwenden")}</span>
          </div>
          <div className="connected-actions">
            {current.continue_session ? (
              <Link
                className="button primary"
                to={`/session/${current.continue_session}`}
              >
                {c("Resume your session", "Sitzung fortsetzen")}
                <Icon path={mdiArrowRight} size="18px" />
              </Link>
            ) : beginner && current.recommended_lesson ? (
              <Button
                disabled={foundation.busy}
                onClick={() =>
                  void foundation.start(
                    current.recommended_lesson!,
                    "lesson",
                    current.settings.source_language,
                  )
                }
              >
                {c("Start learning", "Lernen starten")}
                <Icon path={mdiArrowRight} size="18px" />
              </Button>
            ) : mission ? (
              <Button
                disabled={action.busy}
                onClick={() =>
                  void action.run({
                    action: "start_mission",
                    mission: mission.mission.content,
                    support: "learn",
                  })
                }
              >
                {c("Start today", "Heute starten")}
                <Icon path={mdiArrowRight} size="18px" />
              </Button>
            ) : (
              <Link className="button primary" to="/topics">
                {c("Choose a topic", "Thema wählen")}
              </Link>
            )}
          </div>
          {mission && !beginner && (
            <p className="small muted">
              {c(
                "Based on your level, interests and progress.",
                "Passend zu deinem Einstieg, deinen Interessen und deinem Fortschritt.",
              )}{" "}
              {mission.minutes} {c("min", "Min.")}
            </p>
          )}
        </section>
        <section className="daily-review">
          <span className="review-icon">
            <Icon path={mdiRestore} size="29px" />
          </span>
          <h2>
            {reviewCount
              ? c("Due for review", "Zum Wiederholen")
              : c("No reviews due", "Keine Wiederholungen fällig")}
          </h2>
          <strong className="due-count">
            {Math.min(data.review_limit, reviewCount)}
          </strong>
          <p>
            {reviewCount
              ? `${reviewCount} ${c("items due", "Einträge fällig")}.`
              : c(
                  "Save expressions while reading to practise them here.",
                  "Speichere Wendungen beim Lesen, um sie hier zu üben.",
                )}
          </p>
          {reviewCount > 0 && (
            <Button
              variant="secondary"
              disabled={action.busy || foundation.busy}
              onClick={() =>
                data.due
                  ? void action.run({
                      action: "review_words",
                      sense: null,
                      production: false,
                    })
                  : current.recommended_lesson &&
                    void foundation.start(
                      current.recommended_lesson,
                      "review",
                      current.settings.source_language,
                    )
              }
            >
              {c("Review now", "Jetzt wiederholen")}
            </Button>
          )}
          {data.new_word_limit === 0 && (
            <p className="small muted">
              {c(
                "Review first; add new words later.",
                "Erst wiederholen, dann neue Wörter lernen.",
              )}
            </p>
          )}
        </section>
      </div>
      <ErrorNotice error={action.error ?? foundation.error} />
      <div className="today-alternatives">
        <Link to="/topics">
          <Icon path={mdiBookOpenPageVariantOutline} size="22px" />
          <div>
            <strong>{c("Choose another topic", "Anderes Thema wählen")}</strong>
            <span>
              {c(
                "Eight questions, different entry points",
                "Acht Themen, verschiedene Einstiege",
              )}
            </span>
          </div>
          <Icon path={mdiArrowRight} size="18px" />
        </Link>
        <Link to="/practice">
          <Icon path={mdiRestore} size="22px" />
          <div>
            <strong>{c("Practise independently", "Selbstständig üben")}</strong>
            <span>
              {c(
                "Skills, Abitur tasks and your own work",
                "Fertigkeiten, Abituraufgaben und eigene Texte",
              )}
            </span>
          </div>
          <Icon path={mdiArrowRight} size="18px" />
        </Link>
      </div>
      <div className="evidence-summary">
        <div>
          <strong>{data.independent_words}</strong>
          <span>
            {c(
              "expressions independently recalled",
              "Wendungen selbst abgerufen",
            )}
          </span>
        </div>
        <div>
          <strong>{data.unseen_tasks}</strong>
          <span>
            {c(
              "unseen challenges submitted · self-review",
              "neue Aufgaben abgegeben · Selbstprüfung",
            )}
          </span>
        </div>
        <Link to="/learn" className="text-button">
          {c("All foundation lessons", "Alle Grundlagenlektionen")}
          <Icon path={mdiArrowRight} size="16px" />
        </Link>
      </div>
    </div>
  );
}
