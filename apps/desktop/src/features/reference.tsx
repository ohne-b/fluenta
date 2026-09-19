import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Icon from "../components/icon";
import {
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiBookmark,
  mdiBookmarkOutline,
  mdiMagnify,
} from "@mdi/js";
import type { ContentRef } from "@fluenta/contracts";
import { call, request } from "../lib/ipc";
import { useSettings } from "../lib/context";
import { useI18n } from "../lib/i18n";
import { Button, Empty, ErrorNotice, Loading } from "../components/ui";
import { MaterialView } from "../components/material";

export function ReferencePanel({ initial }: { initial?: ContentRef }) {
  const { t } = useI18n(),
    { data: settings } = useSettings(),
    cache = useQueryClient();
  const [selected, setSelected] = useState(initial),
    [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [tab, setTab] = useState<"search" | "bookmarks">("search"),
    [error, setError] = useState<unknown>(null);
  useEffect(() => setSelected(initial), [initial?.id, initial?.revision]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const locale = settings?.source_language ?? "en";
  const bookmarks = useQuery({
    queryKey: ["bookmarks", locale],
    queryFn: () =>
      call(
        { command: "list_bookmarks", payload: { source_language: locale } },
        "bookmarks",
      ),
  });
  const search = useInfiniteQuery({
    queryKey: ["reference-search", locale, debounced],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      call(
        {
          command: "search_content",
          payload: {
            source_language: locale,
            query: debounced,
            cursor: pageParam,
          },
        },
        "search",
      ),
    getNextPageParam: (last) => last.next_cursor,
    enabled: debounced.trim().length > 0,
  });
  const material = useQuery({
    queryKey: ["reference", locale, selected?.id, selected?.revision],
    queryFn: () =>
      call(
        {
          command: "get_reference",
          payload: { content: selected!, source_language: locale },
        },
        "reference",
      ),
    enabled: Boolean(selected),
    staleTime: 0,
  });
  const bookmarked = Boolean(
    bookmarks.data?.some((hit) => hit.content.id === selected?.id),
  );
  const toggle = async () => {
    if (!selected) return;
    try {
      await request({
        command: "toggle_bookmark",
        payload: { source_language: locale, content: selected },
      });
      await cache.invalidateQueries({ queryKey: ["bookmarks"] });
    } catch (error) {
      setError(error);
    }
  };
  const hits =
    tab === "bookmarks"
      ? bookmarks.data
      : search.data?.pages.flatMap((page) => page.items);
  if (selected)
    return (
      <div className="reference-detail">
        <div className="reference-toolbar">
          <Button variant="ghost" onClick={() => setSelected(undefined)}>
            <Icon path={mdiArrowLeft} aria-hidden="true" size="17px" />
            {t("Back")}
          </Button>
          <Button variant="ghost" onClick={() => void toggle()}>
            <Icon
              path={bookmarked ? mdiBookmark : mdiBookmarkOutline}
              aria-hidden="true"
              size="17px"
            />
            {t(bookmarked ? "Remove bookmark" : "Bookmark")}
          </Button>
        </div>
        <ErrorNotice error={material.error ?? error} />
        {material.data ? (
          <MaterialView material={material.data} />
        ) : (
          !material.error && <Loading />
        )}
      </div>
    );
  return (
    <div className="reference-search">
      <div className="segmented compact">
        <button
          aria-pressed={tab === "search"}
          onClick={() => setTab("search")}
        >
          <Icon path={mdiMagnify} aria-hidden="true" size="16px" />
          {t("Search")}
        </button>
        <button
          aria-pressed={tab === "bookmarks"}
          onClick={() => setTab("bookmarks")}
        >
          <Icon
            path={bookmarked ? mdiBookmark : mdiBookmarkOutline}
            aria-hidden="true"
            size="16px"
          />
          {t("Bookmarks")}
        </button>
      </div>
      {tab === "search" && (
        <>
          <label className="search-input">
            <Icon path={mdiMagnify} aria-hidden="true" size="20px" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Find an explanation, phrase or word.")}
              aria-label={t("Search your Spanish reference")}
            />
          </label>
          <p className="small muted">
            {t("Search Spanish and your teaching language.")}
          </p>
        </>
      )}
      <ErrorNotice error={tab === "search" ? search.error : bookmarks.error} />
      <div className="reference-results">
        {hits?.map((hit) => (
          <button key={hit.content.id} onClick={() => setSelected(hit.content)}>
            <div>
              <strong lang={hit.title.language}>{hit.title.text}</strong>
              <p lang={hit.excerpt.language}>{hit.excerpt.text}</p>
            </div>
            <Icon path={mdiArrowTopRight} aria-hidden="true" size="18px" />
          </button>
        ))}
      </div>
      {tab === "search" && search.hasNextPage && (
        <Button
          variant="secondary"
          disabled={search.isFetchingNextPage}
          onClick={() => void search.fetchNextPage()}
        >
          {t("Load more")}
        </Button>
      )}
      {!hits?.length && !(search.isFetching || bookmarks.isFetching) && (
        <Empty
          icon={
            tab === "search" ? (
              <Icon path={mdiMagnify} aria-hidden="true" size="27px" />
            ) : (
              <Icon
                path={bookmarked ? mdiBookmark : mdiBookmarkOutline}
                aria-hidden="true"
                size="27px"
              />
            )
          }
          title={t(tab === "search" ? "No results yet" : "No bookmarks yet")}
        >
          {t(
            tab === "search"
              ? "Try a word such as ser, pasado or texto."
              : "Save a reference to find it here.",
          )}
        </Empty>
      )}
    </div>
  );
}
