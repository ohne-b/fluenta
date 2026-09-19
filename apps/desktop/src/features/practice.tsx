import { Benchmark, MissionCard } from "./topics";
import { WorkHistory } from "./work";
import { useConnected, useCopy } from "../lib/connected";
import { PageHeading } from "../components/page-heading";
import { useState } from "react";
import Icon from "../components/icon";
import {
  mdiAlphabeticalVariant,
  mdiArrowRight,
  mdiBookOpenPageVariantOutline,
  mdiClipboardCheckOutline,
  mdiHeadphones,
  mdiMicrophoneOutline,
  mdiPencilOutline,
  mdiRestore,
  mdiTable,
} from "@mdi/js";
import type { Band, ContentRef, Skill } from "@fluenta/contracts";
import { useOverview } from "../lib/context";
import { useI18n, type Key } from "../lib/i18n";
import { Button, Empty, ErrorNotice, Loading, Modal } from "../components/ui";
import { useStartSession } from "./learn";

const skills: { skill: Skill; label: Key; icon: string }[] = [
  { skill: "grammar", label: "Grammar", icon: mdiTable },
  { skill: "vocabulary", label: "Vocabulary", icon: mdiAlphabeticalVariant },
  { skill: "reading", label: "Reading", icon: mdiBookOpenPageVariantOutline },
  { skill: "listening", label: "Listening", icon: mdiHeadphones },
  { skill: "writing", label: "Writing", icon: mdiPencilOutline },
  { skill: "speaking", label: "Speaking", icon: mdiMicrophoneOutline },
];
export function Practice() {
  const c = useCopy(),
    topics = useConnected({ action: "today" }, "today");
  const [area, setArea] = useState("skills");
  const { data, error, refetch } = useOverview(),
    { t } = useI18n(),
    start = useStartSession();
  const [skill, setSkill] = useState<Skill>("grammar"),
    [band, setBand] = useState<Band | null>(null),
    [checkpoint, setCheckpoint] = useState<ContentRef | null>(null);
  if (!data)
    return error ? (
      <ErrorNotice error={error} retry={() => void refetch()} />
    ) : (
      <Loading />
    );
  const selectedBand = band ?? data.settings.starting_band,
    units = data.units.filter((u) => u.band === selectedBand);
  const target = data.recommended_lesson ?? data.units[0]?.lessons[0]?.content;
  const selected = skills.find((s) => s.skill === skill)!;
  return (
    <div className="page practice-page">
      <PageHeading>
        <h1>{t("Choose what to work on")}</h1>
      </PageHeading>
      <div className="segmented connected-tabs">
        <button
          aria-pressed={area === "skills"}
          onClick={() => setArea("skills")}
        >
          {c("Skills", "Fertigkeiten")}
        </button>
        <button
          aria-pressed={area === "abitur"}
          onClick={() => setArea("abitur")}
        >
          {c("General Abitur", "Allgemeines Abitur")}
        </button>
        <button aria-pressed={area === "work"} onClick={() => setArea("work")}>
          {c("My work", "Meine Arbeiten")}
        </button>
      </div>
      {area === "work" ? (
        <WorkHistory />
      ) : area === "abitur" ? (
        <section className="abitur-practice">
          <Benchmark />
          <div className="mission-list">
            {topics.data?.topics
              .flatMap((t) => t.missions)
              .map((m) => (
                <MissionCard key={m.mission.content.id} view={m} />
              ))}
          </div>
        </section>
      ) : (
        <>
          <section className="review-card">
            <span className="review-icon">
              <Icon path={mdiRestore} aria-hidden="true" size="30px" />
            </span>
            <div>
              <h2>
                {data.due_reviews
                  ? t("Review what is due")
                  : t("Nothing due right now")}
              </h2>
              <p className="muted">
                {data.due_reviews
                  ? t("A short session built from your previous answers.")
                  : t("Keep learning. Your next review will appear here.")}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={!data.due_reviews || start.busy}
              onClick={() =>
                target &&
                void start.start(
                  target,
                  "review",
                  data.settings.source_language,
                )
              }
            >
              {t("Review")}
              <span className="count-badge">{data.due_reviews}</span>
            </Button>
          </section>
          <ErrorNotice error={start.error} />
          <div
            className="skill-picker"
            role="group"
            aria-label={t("All skills")}
          >
            {skills.map(({ skill: value, label, icon }) => (
              <button
                key={value}
                aria-pressed={skill === value}
                onClick={() => setSkill(value)}
              >
                <Icon path={icon} size="22px" aria-hidden="true" />
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
          <div className="section-heading">
            <h2>{t(selected.label)}</h2>
            <div className="segmented compact">
              {(["A1", "A2", "B1", "B2"] as Band[]).map((value) => (
                <button
                  key={value}
                  aria-pressed={selectedBand === value}
                  onClick={() => setBand(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="practice-grid">
            {units
              .flatMap((u) => u.lessons)
              .filter((l) => l.skills.includes(skill))
              .map((lesson, i) => (
                <button
                  className="practice-card"
                  key={lesson.content.id}
                  disabled={start.busy}
                  onClick={() =>
                    lesson.objectives[0] &&
                    void start.start(
                      lesson.objectives[0],
                      "focused_practice",
                      data.settings.source_language,
                      skill,
                    )
                  }
                >
                  <span className={`practice-symbol tone-${i % 4}`}>
                    <Icon path={selected.icon} size="24px" aria-hidden="true" />
                  </span>
                  <h3 lang={lesson.title.language}>{lesson.title.text}</h3>
                  <span className="card-link">
                    {t("Begin")}
                    <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
                  </span>
                </button>
              ))}
          </div>
          {!units.length && (
            <Empty
              icon={
                <Icon
                  path={mdiBookOpenPageVariantOutline}
                  aria-hidden="true"
                  size="22px"
                />
              }
              title={t("No results yet")}
            />
          )}
          <section className="checkpoint-section">
            <div className="section-heading">
              <div>
                <h2>{t("Check your skills")}</h2>
                <p className="muted">
                  {t("A timed checkpoint. Feedback comes at the end.")}
                </p>
              </div>
              <Icon
                path={mdiClipboardCheckOutline}
                aria-hidden="true"
                className="muted"
                size="27px"
              />
            </div>
            <div className="checkpoint-list">
              {data.units
                .filter((u) => u.assessment)
                .map((unit) => (
                  <button
                    className="checkpoint-row"
                    key={unit.content.id}
                    onClick={() => setCheckpoint(unit.assessment ?? null)}
                  >
                    <span className="band-badge">{unit.band}</span>
                    <strong lang={unit.title.language}>
                      {unit.title.text}
                    </strong>
                    <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
                  </button>
                ))}
            </div>
          </section>
        </>
      )}
      <Modal
        open={Boolean(checkpoint)}
        onClose={() => setCheckpoint(null)}
        title={t("Before you begin")}
        description={t(
          "The timer keeps running if you leave or close the app. Hints, references and the tutor are unavailable until you finish. Listening allows an initial play and two replays.",
        )}
      >
        <ErrorNotice error={start.error} />
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setCheckpoint(null)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={start.busy}
            onClick={() =>
              checkpoint &&
              void start.start(
                checkpoint,
                "test",
                data.settings.source_language,
              )
            }
          >
            {t("Start checkpoint")}
            <Icon path={mdiArrowRight} aria-hidden="true" size="18px" />
          </Button>
        </div>
      </Modal>
    </div>
  );
}
