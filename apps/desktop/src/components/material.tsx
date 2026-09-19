import { useContext, useEffect, useState } from "react";
import { AnnotatedText, VocabularyContext } from "./annotated-text";
import { SaveArgument } from "../features/work";
import Icon from "./icon";
import { mdiArrowTopRight, mdiLoading, mdiStop, mdiVolumeHigh } from "@mdi/js";
import type {
  Block,
  ContentRef,
  Material,
  MutationContext,
  Text,
} from "@fluenta/contracts";
import { useOperation, request } from "../lib/ipc";
import { useAppActions } from "../lib/context";
import { useI18n } from "../lib/i18n";
import { Button, ErrorNotice } from "./ui";

export function Spans({ spans }: { spans: Text[] }) {
  return (
    <>
      {spans.map((span, i) => (
        <span lang={span.language} key={i}>
          <AnnotatedText text={span} />
          {i < spans.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}
export function AudioButton({
  segment,
  context,
  compact = false,
  onFinished,
}: {
  segment: ContentRef;
  context?: MutationContext;
  compact?: boolean;
  onFinished?: () => void;
}) {
  const { t } = useI18n();
  const operation = useOperation((event) => {
    if (["finished", "cancelled", "failed"].includes(event.event.event))
      onFinished?.();
  });
  return (
    <div className={`audio-control ${compact ? "compact" : ""}`}>
      <Button
        variant="secondary"
        aria-label={operation.busy ? t("Stop audio") : t("Listen")}
        onClick={() => {
          if (operation.busy) void request({ command: "stop_playback" });
          else
            void operation.begin({
              command: "synthesize",
              payload: { segment, slow: false, context: context ?? null },
            });
        }}
      >
        {operation.busy ? (
          <>
            <Icon path={mdiStop} aria-hidden="true" size="17px" />
            {!compact && t("Stop audio")}
          </>
        ) : (
          <>
            <Icon path={mdiVolumeHigh} aria-hidden="true" size="20px" />
            {!compact && t("Listen")}
          </>
        )}
      </Button>
      {!compact && (
        <button
          type="button"
          className="text-button"
          disabled={operation.busy}
          onClick={() =>
            void operation.begin({
              command: "synthesize",
              payload: { segment, slow: true, context: context ?? null },
            })
          }
        >
          {t("Slower")} <span className="speed">0.8×</span>
        </button>
      )}
      {operation.busy && (
        <Icon
          path={mdiLoading}
          aria-hidden="true"
          size="15px"
          className="spin muted"
          aria-label={t("Preparing audio…")}
        />
      )}
      <ErrorNotice error={operation.error} />
    </div>
  );
}
function ContentBlock({
  block,
  context,
  onAudioFinished,
}: {
  block: Block;
  context?: MutationContext;
  onAudioFinished?: () => void;
}) {
  const actions = useAppActions();
  switch (block.kind) {
    case "source_text":
      return (
        <figure className="source-extract">
          <figcaption>{block.caption.text}</figcaption>
          <p lang={block.language}>{block.text}</p>
        </figure>
      );
    case "image":
      return (
        <figure className="mission-image">
          <img
            src={`data:image/png;base64,${btoa(Array.from(block.png, (b) => String.fromCharCode(b)).join(""))}`}
            alt={block.alt.text}
          />
          <figcaption>{block.caption.text}</figcaption>
        </figure>
      );
    case "recorded_audio":
      return <RecordedAudio bytes={block.wav} caption={block.caption.text} />;
    case "heading":
      return (
        <h3>
          <Spans spans={block.spans} />
        </h3>
      );
    case "paragraph":
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      );
    case "list":
      return (
        <ul>
          {block.items.map((spans, i) => (
            <li key={i}>
              <Spans spans={spans} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div
          className="table-scroll"
          role="region"
          aria-label={block.caption.text}
          tabIndex={0}
        >
          <table className="grammar-table">
            <caption lang={block.caption.language}>
              {block.caption.text}
            </caption>
            <thead>
              <tr>
                {block.columns.map((column, i) => (
                  <th scope="col" lang={column.language} key={i}>
                    <AnnotatedText text={column} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) =>
                    j === 0 ? (
                      <th scope="row" lang={cell.language} key={j}>
                        <AnnotatedText text={cell} />
                      </th>
                    ) : (
                      <td lang={cell.language} key={j}>
                        <AnnotatedText text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "example":
      return (
        <div className="example-block">
          <p>
            <Spans spans={block.spans} />
          </p>
          {block.speech && (
            <AudioButton
              segment={block.speech}
              context={context}
              compact
              onFinished={onAudioFinished}
            />
          )}
        </div>
      );
    case "audio":
      return (
        <div className="listening-block">
          <AudioButton
            segment={block.speech}
            context={context}
            onFinished={onAudioFinished}
          />
        </div>
      );
    case "reference":
      return (
        <button
          type="button"
          className="reference-link"
          onClick={() => actions.reference(block.target)}
        >
          <span lang={block.label.language}>{block.label.text}</span>
          <Icon path={mdiArrowTopRight} aria-hidden="true" size="16px" />
        </button>
      );
  }
}
export function MaterialView({
  material,
  context,
  onAudioFinished,
}: {
  material: Material;
  context?: MutationContext;
  onAudioFinished?: () => void;
}) {
  const vocabulary = useContext(VocabularyContext);
  return (
    <div className="material">
      {material.blocks.map((block, i) => (
        <ContentBlock
          key={i}
          block={block}
          context={context}
          onAudioFinished={onAudioFinished}
        />
      ))}
      {vocabulary.allowed &&
        material.searchable &&
        material.content.id.startsWith("mission.") && (
          <SaveArgument source={material.content} />
        )}
    </div>
  );
}

function RecordedAudio({
  bytes,
  caption,
}: {
  bytes: number[];
  caption: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    );
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes]);
  return (
    <figure>
      <audio controls preload="none" src={url} aria-label={caption} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
