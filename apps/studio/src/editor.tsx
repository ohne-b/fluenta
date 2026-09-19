import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import Icon from "../../desktop/src/components/icon";
import {
  mdiCheckCircleOutline,
  mdiCodeBraces,
  mdiCodeJson,
  mdiContentSaveOutline,
  mdiFolderOpenOutline,
  mdiMagnify,
  mdiPlay,
} from "@mdi/js";
import type { StudioRequest, StudioResponse } from "@fluenta/contracts";
import { Button, Modal } from "../../desktop/src/components/ui";
import { PageHeading } from "../../desktop/src/components/page-heading";
import { useStartSession } from "../../desktop/src/features/learn";
import "./editor.css";

type Workspace = Extract<StudioResponse, { kind: "workspace" }>;
type Document = Extract<StudioResponse, { kind: "document" }>;
type Report = Extract<StudioResponse, { kind: "validated" }>;
const rpc = (request: StudioRequest) =>
  invoke<StudioResponse>("studio_dispatch", { request });

export default function StudioEditor() {
  const cache = useQueryClient(),
    preview = useStartSession();
  const [workspace, setWorkspace] = useState<Workspace | undefined>(() =>
    cache.getQueryData(["studio-workspace"]),
  );
  const cached = cache.getQueryData<{ document: Document; text: string }>([
    "studio-document",
  ]);
  const [document, setDocument] = useState<Document | undefined>(
      cached?.document,
    ),
    [text, setText] = useState(cached?.text ?? ""),
    [query, setQuery] = useState("");
  const [report, setReport] = useState<Report | undefined>(() =>
    cache.getQueryData(["studio-report"]),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [pending, setPending] = useState<string | null>(null),
    [language, setLanguage] = useState<"en" | "de">("en");
  const dirty = !!document && text !== document.text;
  useEffect(() => {
    if (workspace) return;
    let disposed = false;
    void rpc({ command: "current" })
      .then((result) => {
        if (!disposed && result.kind === "workspace") {
          setWorkspace(result);
          cache.setQueryData(["studio-workspace"], result);
        }
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [workspace, cache]);
  const draft = useRef({ document, text });
  draft.current = { document, text };
  useEffect(() => {
    if (document) cache.setQueryData(["studio-document"], { document, text });
    else cache.removeQueries({ queryKey: ["studio-document"] });
  }, [document, text, cache]);
  useEffect(() => {
    let disposed = false,
      unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const { document, text } = draft.current;
        if (!document || document.text === text) return;
        event.preventDefault();
        try {
          await rpc({
            command: "save",
            path: document.path,
            text,
            expected_sha256: document.sha256,
          });
          await getCurrentWindow().destroy();
        } catch (error) {
          setError(`Your file could not be saved. ${String(error)}`);
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
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const open = () =>
    perform(async () => {
      const result = await rpc({ command: "open" });
      if (result.kind === "workspace") {
        setWorkspace(result);
        cache.setQueryData(["studio-workspace"], result);
        setDocument(undefined);
        setText("");
        setReport(undefined);
        cache.removeQueries({ queryKey: ["studio-report"] });
      }
    });
  const read = (path: string) =>
    perform(async () => {
      const result = await rpc({ command: "read", path });
      if (result.kind === "document") {
        setDocument(result);
        setText(result.text);
        setQuery("");
      }
    });
  const select = (path: string) => {
    if (dirty) setPending(path);
    else void read(path);
  };
  const save = () =>
    perform(async () => {
      if (!document) return;
      const result = await rpc({
        command: "save",
        path: document.path,
        text,
        expected_sha256: document.sha256,
      });
      if (result.kind === "document") {
        setDocument(result);
        setText(result.text);
        setReport(undefined);
        cache.removeQueries({ queryKey: ["studio-report"] });
        setStatus("Saved. Validate the curriculum to refresh its preview.");
      }
    });
  const validate = () =>
    perform(async () => {
      const result = await rpc({ command: "validate" });
      if (result.kind === "validated") {
        setReport(result);
        cache.setQueryData(["studio-report"], result);
        await cache.invalidateQueries({ queryKey: ["overview"] });
        setStatus(
          `${result.packs} course packs compiled. All references, translations and answer policies passed validation.`,
        );
      }
    });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  let translations: Record<string, string> | undefined;
  if (document?.path.startsWith("locales/")) {
    try {
      translations = JSON.parse(text) as Record<string, string>;
    } catch {
      /* JSON editor remains available for invalid drafts. */
    }
  }
  const slots =
    translations &&
    Object.entries(translations).filter(([key, value]) =>
      `${key} ${value}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <main className="studio-page">
      <PageHeading>
        <h1>Curriculum editor</h1>
      </PageHeading>
      {!workspace ? (
        <section className="studio-welcome">
          <Icon path={mdiCodeBraces} aria-hidden="true" size="46px" />
          <h2>Open your curriculum source</h2>
          <p>
            Choose <code>content/foundation</code>, or a separate checkout with
            the same source format. The learner app never includes these editing
            tools.
          </p>
          <Button onClick={() => void open()}>Choose folder</Button>
        </section>
      ) : (
        <>
          <div className="studio-toolbar">
            <span title={workspace.root}>
              {workspace.root.split(/[\\/]/).filter(Boolean).at(-1)}
            </span>
            <div className="button-row">
              <Button
                variant="secondary"
                disabled={busy || dirty}
                onClick={() => void open()}
              >
                <Icon
                  path={mdiFolderOpenOutline}
                  aria-hidden="true"
                  size="18px"
                />
                Open curriculum
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty || busy}
                onClick={() => void save()}
              >
                <Icon
                  path={mdiContentSaveOutline}
                  aria-hidden="true"
                  size="16px"
                />
                Save file
              </Button>
              <Button disabled={dirty || busy} onClick={() => void validate()}>
                <Icon
                  path={mdiCheckCircleOutline}
                  aria-hidden="true"
                  size="17px"
                />
                {busy ? "Working…" : "Validate & preview"}
              </Button>
            </div>
          </div>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          <p className="studio-status" role="status">
            {status ||
              (dirty
                ? "Unsaved changes. Save before validating or opening another curriculum."
                : "")}
          </p>
          <div className="studio-workspace">
            <aside className="studio-files" aria-label="Curriculum files">
              <h2>Source files</h2>
              {workspace.files.map((path) => (
                <button
                  key={path}
                  aria-current={document?.path === path ? "page" : undefined}
                  onClick={() => select(path)}
                >
                  <Icon path={mdiCodeJson} aria-hidden="true" size="15px" />
                  <span>{path}</span>
                </button>
              ))}
            </aside>
            <section className="studio-document">
              {document ? (
                <>
                  <div className="studio-document-heading">
                    <h2>{document.path}</h2>
                    <span className="pill">{dirty ? "Unsaved" : "Saved"}</span>
                  </div>
                  {translations && slots ? (
                    <>
                      <label className="studio-filter">
                        <Icon
                          path={mdiMagnify}
                          aria-hidden="true"
                          size="17px"
                        />
                        <input
                          placeholder="Find a translation slot…"
                          aria-label="Find a translation slot"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <p className="small muted">
                        Showing {Math.min(slots.length, 40)} of {slots.length}{" "}
                        matches. Filter to find another slot.
                      </p>
                      <div className="translation-fields">
                        {slots.slice(0, 40).map(([key, value]) => (
                          <label key={key}>
                            <code>{key}</code>
                            <textarea
                              rows={Math.min(
                                6,
                                Math.max(2, Math.ceil(value.length / 90)),
                              )}
                              value={value}
                              onChange={(event) =>
                                setText(
                                  JSON.stringify(
                                    {
                                      ...translations,
                                      [key]: event.target.value,
                                    },
                                    null,
                                    2,
                                  ) + "\n",
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="small muted">
                        Spanish content and stable IDs live here. Teaching text
                        uses translation slots. Increment a revision whenever
                        its meaning or answer policy changes.
                      </p>
                      <label className="sr-only" htmlFor="source-editor">
                        Curriculum JSON
                      </label>
                      <textarea
                        id="source-editor"
                        className="source-editor"
                        spellCheck={false}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                      />
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          try {
                            setText(
                              JSON.stringify(JSON.parse(text), null, 2) + "\n",
                            );
                            setError("");
                          } catch (error) {
                            setError(String(error));
                          }
                        }}
                      >
                        Format JSON
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <Icon path={mdiCodeJson} aria-hidden="true" size="32px" />
                  <h2>Choose a source file</h2>
                  <p>
                    Lesson fragments keep related activities, rubrics and
                    materials together.
                  </p>
                </div>
              )}
            </section>
          </div>
          {report && (
            <section className="studio-previews">
              <div className="section-heading">
                <h2>Preview a lesson</h2>
                <div className="segmented">
                  {(["en", "de"] as const).map((locale) => (
                    <button
                      key={locale}
                      aria-pressed={language === locale}
                      onClick={() => setLanguage(locale)}
                    >
                      {locale === "de"
                        ? "Deutsch → Español"
                        : "English → Español"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="small muted">
                Previews use a separate Studio profile. Your learner progress is
                never edited.
              </p>
              {!!preview.error && <p role="alert">{String(preview.error)}</p>}
              <div className="studio-preview-grid">
                {report.units
                  .filter((unit) => unit.title.language === language)
                  .flatMap((unit) =>
                    unit.lessons.map((lesson) => (
                      <button
                        key={`${language}-${lesson.content.id}`}
                        disabled={preview.busy || dirty}
                        onClick={() =>
                          void preview.start(lesson.content, "lesson", language)
                        }
                      >
                        <span className="band-badge">{unit.band}</span>
                        <span>
                          <strong>{lesson.title.text}</strong>
                          <small>
                            {lesson.activity_count} activities ·{" "}
                            {lesson.estimated_minutes} min
                          </small>
                        </span>
                        <Icon path={mdiPlay} aria-hidden="true" size="17px" />
                      </button>
                    )),
                  )}
              </div>
            </section>
          )}
        </>
      )}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Keep your changes?"
        description="Save this file first to keep your draft, or discard it to open the selected file."
      >
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setPending(null)}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const path = pending;
              setPending(null);
              if (path) void read(path);
            }}
          >
            Discard changes
          </Button>
        </div>
      </Modal>
    </main>
  );
}
