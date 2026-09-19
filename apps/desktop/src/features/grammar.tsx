import { PageHeading } from "../components/page-heading";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { mdiArrowLeft, mdiArrowRight, mdiCheck, mdiMagnify } from "@mdi/js";
import type {
  ContentRef,
  GrammarTopic,
  MutationContext,
  SourceLanguage,
} from "@fluenta/contracts";
import Icon from "../components/icon";
import { MaterialView } from "../components/material";
import { ErrorNotice, Loading } from "../components/ui";
import { useOverview } from "../lib/context";
import { call } from "../lib/ipc";
import { useI18n } from "../lib/i18n";
import { LessonRow, useStartSession } from "./learn";

function Explanation({
  content,
  language,
}: {
  content: ContentRef;
  language: SourceLanguage;
}) {
  const query = useQuery({
    queryKey: ["reference", language, content.id, content.revision],
    queryFn: () =>
      call(
        {
          command: "get_reference",
          payload: { content, source_language: language },
        },
        "reference",
      ),
    staleTime: 0,
  });
  if (query.error)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  return query.data ? <MaterialView material={query.data} /> : <Loading />;
}

export function GrammarHelp({ context }: { context: MutationContext }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: [
      "grammar-help",
      context.session_id,
      context.step_id,
      context.expected_step_version,
    ],
    queryFn: () =>
      call(
        { command: "get_grammar_help", payload: { context } },
        "grammar_help",
      ),
    staleTime: 0,
  });
  if (query.error)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  if (!query.data) return <Loading />;
  return (
    <div className="grammar-explanations">
      {query.data.map((material) => (
        <MaterialView
          key={`${material.content.id}:${material.content.revision}`}
          material={material}
        />
      ))}
      {!query.data.length && (
        <p className="muted">
          {t("No explanation is linked to this activity yet.")}
        </p>
      )}
    </div>
  );
}

export function Grammar() {
  const { t } = useI18n(),
    { topicId } = useParams();
  const overview = useOverview();
  const language = overview.data?.settings.source_language ?? "en";
  const query = useQuery({
    queryKey: ["grammar", language],
    queryFn: () =>
      call(
        { command: "list_grammar", payload: { source_language: language } },
        "grammar",
      ),
    enabled: !!overview.data,
  });
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"explanation" | "exercises">("explanation");
  const start = useStartSession();
  const lessons = overview.data?.units.flatMap((unit) => unit.lessons) ?? [];
  if (query.error || overview.error)
    return <ErrorNotice error={query.error ?? overview.error} />;
  if (!query.data || !overview.data) return <Loading />;
  const topic = query.data.find((item) => item.content.id === topicId);
  if (topicId)
    return (
      <div className="page grammar-page">
        <Link to="/grammar" className="text-button grammar-back">
          <Icon path={mdiArrowLeft} size="18px" aria-hidden="true" />
          {t("All grammar")}
        </Link>
        {topic ? (
          <>
            <PageHeading>
              <h1 lang={topic.title.language}>{topic.title.text}</h1>
            </PageHeading>
            <p className="grammar-summary" lang={topic.summary.language}>
              {topic.summary.text}
            </p>
            <div
              className="grammar-tabs"
              role="group"
              aria-label={t("Grammar course")}
            >
              <button
                aria-pressed={view === "explanation"}
                onClick={() => setView("explanation")}
              >
                {t("Explanation")}
              </button>
              <button
                aria-pressed={view === "exercises"}
                onClick={() => setView("exercises")}
              >
                {t("Exercises")} <span>{topic.lessons.length}</span>
              </button>
            </div>
            {view === "explanation" ? (
              <div className="grammar-explanations">
                {topic.explanations.map((content) => (
                  <Explanation
                    key={`${content.id}:${content.revision}`}
                    content={content}
                    language={language}
                  />
                ))}
              </div>
            ) : (
              <section className="grammar-practice">
                <ErrorNotice error={start.error} />
                <div className="grammar-lessons">
                  {topic.lessons.map((reference, index) => {
                    const lesson = lessons.find(
                      (item) =>
                        item.content.id === reference.id &&
                        item.content.revision === reference.revision,
                    );
                    return (
                      lesson && (
                        <LessonRow
                          key={reference.id}
                          lesson={lesson}
                          index={index}
                          disabled={start.busy}
                          onStart={() =>
                            void start.start(reference, "lesson", language)
                          }
                        />
                      )
                    );
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="muted">
            {t("This grammar course is not in your installed content.")}
          </p>
        )}
      </div>
    );
  const needle = search.trim().toLocaleLowerCase(language);
  const filtered = query.data.filter((item) =>
    `${item.group?.text ?? ""} ${item.title.text} ${item.summary.text}`
      .toLocaleLowerCase(language)
      .includes(needle),
  );
  const groups: { title?: GrammarTopic["title"]; topics: GrammarTopic[] }[] =
    [];
  for (const item of [...filtered].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.title.text.localeCompare(b.title.text, language),
  )) {
    const last = groups.at(-1);
    if (last && last.title?.text === item.group?.text) last.topics.push(item);
    else groups.push({ title: item.group ?? undefined, topics: [item] });
  }
  return (
    <div className="page grammar-page">
      <PageHeading>
        <h1>{t("Grammar")}</h1>
      </PageHeading>
      <div className="grammar-filters">
        <label className="search-input">
          <Icon path={mdiMagnify} size="20px" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("Search grammar")}
            placeholder={t("Search grammar")}
          />
        </label>
      </div>
      {groups.map((group, groupIndex) => (
        <section
          className={`grammar-group ${group.title ? "grammar-nested" : ""}`}
          key={groupIndex}
        >
          {group.title && (
            <h2 lang={group.title.language}>{group.title.text}</h2>
          )}
          <div className="grammar-list">
            {group.topics.map((item) => {
              const complete = item.lessons.every((reference) =>
                lessons.some(
                  (lesson) =>
                    lesson.content.id === reference.id && lesson.completed,
                ),
              );
              return (
                <Link
                  to={`/grammar/${item.content.id}`}
                  className="grammar-row"
                  key={item.content.id}
                  onClick={() => setView("explanation")}
                >
                  <div>
                    <h3 lang={item.title.language}>{item.title.text}</h3>
                    <p lang={item.summary.language}>{item.summary.text}</p>
                  </div>
                  <Icon
                    path={complete ? mdiCheck : mdiArrowRight}
                    size="20px"
                    aria-hidden="true"
                  />
                  {complete && (
                    <span className="sr-only">{t("Lessons completed")}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {!filtered.length && (
        <p className="muted">{t("No grammar courses match your search.")}</p>
      )}
    </div>
  );
}
