import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  Annotation,
  MutationContext,
  Text,
  WordView,
} from "@fluenta/contracts";
import Icon from "./icon";
import { mdiClose, mdiPlus, mdiCheck, mdiVolumeHigh, mdiStop } from "@mdi/js";
import { connected, useConnectedAction, useCopy } from "../lib/connected";
import { useOperation } from "../lib/ipc";
import { Button, ErrorNotice } from "./ui";

export const VocabularyContext = createContext<{
  context?: MutationContext;
  allowed: boolean;
}>({ allowed: true });
export function AnnotatedText({ text }: { text: Text }) {
  const { allowed } = useContext(VocabularyContext);
  if (!allowed || !text.annotations?.length)
    return <span lang={text.language}>{text.text}</span>;
  const chars = Array.from(text.text);
  let end = 0;
  const parts = text.annotations.map((a) => {
    const before = chars.slice(end, a.start).join("");
    end = a.end;
    return (
      <span key={a.occurrence.id}>
        {before}
        <Word annotation={a}>{chars.slice(a.start, a.end).join("")}</Word>
      </span>
    );
  });
  return (
    <span lang={text.language}>
      {parts}
      {chars.slice(end).join("")}
    </span>
  );
}
function Word({
  annotation,
  children,
}: {
  annotation: Annotation;
  children: string;
}) {
  const { context } = useContext(VocabularyContext),
    c = useCopy(),
    action = useConnectedAction();
  const id = useId(),
    trigger = useRef<HTMLSpanElement>(null),
    popover = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [word, setWord] = useState<WordView>(),
    [open, setOpen] = useState(false),
    [hover, setHover] = useState(false),
    [error, setError] = useState<unknown>(null),
    [position, setPosition] = useState({ top: 0, left: 0 });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !popover.current?.contains(event.target)
      )
        popover.current?.hidePopover();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  const lookup = async (opened: boolean) => {
    try {
      const result = await connected(
        {
          action: "lookup",
          occurrence: annotation.occurrence,
          context: context ?? null,
          opened,
        },
        "word",
      );
      if (live.current) {
        setWord(result);
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(e);
    }
  };
  const show = () => {
    if (window.getSelection()?.toString()) return;
    setHover(false);
    clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 440)),
    });
    popover.current?.showPopover();
    void lookup(true);
  };
  return (
    <>
      <span
        ref={trigger}
        className="teaching-word"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        onMouseEnter={() => {
          timer.current = setTimeout(() => {
            setHover(true);
            void lookup(false);
          }, 300);
        }}
        onMouseLeave={() => {
          clearTimeout(timer.current);
          setHover(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          show();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            show();
          }
        }}
      >
        {children}
        {hover && !open && word && (
          <span
            role="tooltip"
            className="word-preview"
            lang={word.sense.gloss.language}
          >
            {word.contexts[0]?.meaning.text ?? word.sense.gloss.text}
          </span>
        )}
      </span>
      {createPortal(
        <div
          ref={popover}
          id={id}
          popover="auto"
          role="dialog"
          aria-label={c("Word lookup", "Wort nachschlagen")}
          className="word-popover"
          style={position}
          onToggle={(e) => {
            const visible = e.newState === "open";
            setOpen(visible);
            if (visible)
              popover.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus();
            else if (document.activeElement === document.body)
              trigger.current?.focus();
          }}
        >
          <button
            className="word-close icon-button"
            aria-label={c("Close", "Schließen")}
            onClick={() => popover.current?.hidePopover()}
          >
            <Icon path={mdiClose} size="19px" />
          </button>
          {word ? (
            <>
              <h3 lang="es">{word.sense.lemma}</h3>
              <p lang={word.sense.gloss.language}>{word.sense.gloss.text}</p>
              {word.sense.grammar && (
                <p className="small muted" lang={word.sense.grammar.language}>
                  {word.sense.grammar.text}
                </p>
              )}
              <blockquote lang="es">
                {word.contexts[0]?.context.text}
              </blockquote>
              <p className="small muted">
                {c("In this context", "In diesem Kontext")}:{" "}
                {word.contexts[0]?.meaning.text}
              </p>
              <div className="connected-actions">
                <Button
                  disabled={action.busy || word.status === "active"}
                  onClick={async () => {
                    const result = await action.run({
                      action: "learn_word",
                      occurrence: annotation.occurrence,
                      context: context ?? null,
                    });
                    if (result?.kind === "word") setWord(result.data);
                  }}
                >
                  <Icon
                    path={word.status === "active" ? mdiCheck : mdiPlus}
                    size="18px"
                  />
                  {word.status === "active"
                    ? c("Learning", "In Lernliste")
                    : c("Learn this", "Lernen")}
                </Button>
                {word.contexts[0]?.speech && (
                  <WordAudio word={word} context={context} />
                )}
              </div>
            </>
          ) : (
            <p>{c("Loading…", "Lädt…")}</p>
          )}
          <ErrorNotice error={error ?? action.error} />
        </div>,
        document.body,
      )}
    </>
  );
}
export function WordAudio({
  word,
  context,
}: {
  word: WordView;
  context?: MutationContext;
}) {
  const c = useCopy(),
    audio = useOperation(),
    speech = word.contexts.find((c) => c.speech)?.speech;
  return (
    <>
      <Button
        variant="ghost"
        disabled={!speech}
        aria-label={
          audio.busy
            ? c("Stop audio", "Audio stoppen")
            : c("Listen · synthetic voice", "Anhören · synthetische Stimme")
        }
        onClick={() =>
          audio.busy
            ? void audio.cancel()
            : speech &&
              void audio.begin({
                command: "synthesize",
                payload: {
                  segment: speech,
                  slow: false,
                  context: context ?? null,
                },
              })
        }
      >
        <Icon path={audio.busy ? mdiStop : mdiVolumeHigh} size="21px" />
      </Button>
      <ErrorNotice error={audio.error} />
    </>
  );
}
