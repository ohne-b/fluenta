import { PageHeading } from "../components/page-heading";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/icon";
import {
  mdiArrowRight,
  mdiBookOpenPageVariantOutline,
  mdiBullseyeArrow,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiClockOutline,
  mdiHeadphones,
  mdiRestore,
} from "@mdi/js";
import type {
  Band,
  ContentRef,
  LessonOverview,
  SessionMode,
  Skill,
} from "@fluenta/contracts";
import { useOverview } from "../lib/context";
import { call } from "../lib/ipc";
import { useI18n } from "../lib/i18n";
import { Button, ErrorNotice, Loading } from "../components/ui";

export function useStartSession() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return {
    busy,
    error,
    start: async (
      target: ContentRef,
      mode: SessionMode,
      source_language: "en" | "de",
      skill?: Skill,
    ) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const session = await call(
          {
            command: "start_session",
            payload: { target, mode, source_language, skill: skill ?? null },
          },
          "session",
        );
        navigate(`/session/${session.session_id}`);
      } catch (error) {
        setError(error);
      } finally {
        setBusy(false);
      }
    },
  };
}
export function LessonRow({
  lesson,
  index,
  next,
  onStart,
  disabled,
}: {
  lesson: LessonOverview;
  index: number;
  next?: boolean;
  onStart: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      className={`lesson-row ${next ? "next" : ""} ${lesson.completed ? "complete" : ""}`}
      onClick={onStart}
      disabled={disabled}
      aria-label={`${t(lesson.completed ? "Replay lesson" : "Start lesson")}: ${lesson.title.text}`}
    >
      <span className="lesson-node">
        {lesson.completed ? (
          <Icon path={mdiCheck} aria-hidden="true" size="22px" />
        ) : next ? (
          <Icon
            path={mdiBookOpenPageVariantOutline}
            aria-hidden="true"
            size="23px"
          />
        ) : (
          <span>{String(index + 1).padStart(2, "0")}</span>
        )}
      </span>
      <span className="lesson-details">
        <strong lang={lesson.title.language}>{lesson.title.text}</strong>
        <span className="lesson-meta">
          <Icon path={mdiClockOutline} aria-hidden="true" size="13px" />
          {lesson.estimated_minutes} {t("min")}
          <span className="meta-dot">·</span>
          {lesson.activity_count} {t("activities")}
          {lesson.skills.includes("listening") && (
            <Icon path={mdiHeadphones} aria-hidden="true" size="14px" />
          )}
        </span>
      </span>
      <span className="lesson-action">
        {lesson.completed ? (
          <Icon path={mdiRestore} aria-hidden="true" size="19px" />
        ) : (
          <Icon path={mdiArrowRight} aria-hidden="true" size="20px" />
        )}
      </span>
    </button>
  );
}
const labels = {
  A1: "Foundations",
  A2: "Build connections",
  B1: "Express your ideas",
  B2: "Make your case",
} as const;
export function Learn() {
  const { data, error, refetch } = useOverview(),
    { t, language } = useI18n(),
    navigate = useNavigate();
  const [band, setBand] = useState<Band | null>(null),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const start = useStartSession();
  if (!data)
    return error ? (
      <ErrorNotice error={error} retry={() => void refetch()} />
    ) : (
      <Loading />
    );
  const currentBand = band ?? data.settings.starting_band;
  const units = data.units.filter((unit) => unit.band === currentBand);
  const lessons = units.flatMap((unit) => unit.lessons);
  const recommended =
    lessons.find(
      (lesson) => lesson.content.id === data.recommended_lesson?.id,
    ) ??
    lessons.find((lesson) => !lesson.completed) ??
    lessons[0];
  return (
    <div className="page learn-page">
      <PageHeading grammarHelp>
        <h1>{t("Your Spanish")}</h1>
      </PageHeading>
      <section className="hero-card">
        <div className="hero-copy">
          <h2 lang={recommended?.title.language}>
            {data.continue_session
              ? t("Keep learning")
              : (recommended?.title.text ?? t("Your course"))}
          </h2>
          {recommended && !data.continue_session && (
            <p>
              {currentBand} <span aria-hidden="true">·</span>{" "}
              {recommended.estimated_minutes} {t("min")}{" "}
              <span aria-hidden="true">·</span> {recommended.activity_count}{" "}
              {t("activities")}
            </p>
          )}
          <Button
            disabled={start.busy || (!data.continue_session && !recommended)}
            onClick={() => {
              if (data.continue_session)
                navigate(`/session/${data.continue_session}`);
              else if (recommended)
                void start.start(
                  recommended.content,
                  "lesson",
                  data.settings.source_language,
                );
            }}
          >
            {t(data.continue_session ? "Continue learning" : "Start learning")}
            <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
          </Button>
        </div>
      </section>
      <ErrorNotice error={start.error} />
      <div className="stats-row">
        <div className="stat">
          <span className="stat-icon mint">
            <Icon path={mdiCheckCircleOutline} aria-hidden="true" size="21px" />
          </span>
          <div>
            <strong>{data.total_completed}</strong>
            <span>{t("Lessons completed")}</span>
          </div>
        </div>
        <button className="stat" onClick={() => navigate("/practice")}>
          <span className="stat-icon coral">
            <Icon path={mdiRestore} aria-hidden="true" size="21px" />
          </span>
          <div>
            <strong>{data.due_reviews}</strong>
            <span>{t("Ready to review")}</span>
          </div>
          <Icon
            path={mdiArrowRight}
            aria-hidden="true"
            className="muted"
            size="16px"
          />
        </button>
        <div className="stat">
          <span className="stat-icon peach">
            <Icon path={mdiBullseyeArrow} aria-hidden="true" size="21px" />
          </span>
          <div>
            <strong>{data.today_attempts}</strong>
            <span>{t("Answers today")}</span>
          </div>
        </div>
      </div>
      <div className="course-layout">
        <section className="course-section">
          <div className="section-heading">
            <h2>{t("Your course")}</h2>
            <label className="select-label">
              <span className="sr-only">{t("Your starting point")}</span>
              <select
                value={currentBand}
                onChange={(event) => setBand(event.target.value as Band)}
              >
                {(["A1", "A2", "B1", "B2"] as Band[]).map((value) => (
                  <option key={value} value={value}>
                    {value} · {t(labels[value])}
                  </option>
                ))}
              </select>
              <Icon path={mdiChevronDown} aria-hidden="true" size="15px" />
            </label>
          </div>
          {units.map((unit) => {
            const open =
              expanded[unit.content.id] ??
              unit.lessons.some(
                (lesson) => lesson.content.id === recommended?.content.id,
              );
            const completed = unit.lessons.filter((l) => l.completed).length;
            return (
              <div className="unit-card" key={unit.content.id}>
                <button
                  className="unit-heading"
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [unit.content.id]: !open,
                    }))
                  }
                  aria-expanded={open}
                >
                  <span className="band-badge">{unit.band}</span>
                  <span>
                    <strong lang={unit.title.language}>
                      {unit.title.text}
                    </strong>
                  </span>
                  <span className="unit-progress">
                    {completed}/{unit.lessons.length}
                  </span>
                  <Icon
                    path={mdiChevronDown}
                    aria-hidden="true"
                    className={open ? "" : "rotate-left"}
                    size="18px"
                  />
                </button>
                {open && (
                  <div className="lesson-list">
                    {unit.lessons.map((lesson, index) => (
                      <LessonRow
                        key={lesson.content.id}
                        lesson={lesson}
                        index={index}
                        next={lesson.content.id === recommended?.content.id}
                        disabled={start.busy}
                        onStart={() =>
                          void start.start(
                            lesson.content,
                            "lesson",
                            data.settings.source_language,
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        <aside className="week-card">
          <div className="section-heading">
            <h3>{t("Your week")}</h3>
          </div>

          <div className="week-days">
            {data.week.map((day) => (
              <div key={day.day} title={`${day.day}: ${day.attempts}`}>
                <span className={day.attempts ? "day done" : "day"}>
                  {day.attempts ? (
                    <Icon path={mdiCheck} aria-hidden="true" size="15px" />
                  ) : (
                    <span />
                  )}
                </span>
                <span className="small muted">
                  {new Intl.DateTimeFormat(language, {
                    weekday: "narrow",
                  }).format(new Date(`${day.day}T12:00:00`))}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
