import { useState } from "react";
import Icon from "../components/icon";
import {
  mdiArrowRight,
  mdiCheck,
  mdiTable,
  mdiBookOpenPageVariantOutline,
  mdiMicrophoneOutline,
} from "@mdi/js";
import { useQueryClient } from "@tanstack/react-query";
import type { Band, Settings, SourceLanguage } from "@fluenta/contracts";
import { call } from "../lib/ipc";
import { I18nProvider, useI18n } from "../lib/i18n";
import { Brand, Button, ErrorNotice, Flag } from "../components/ui";

export function Onboarding({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState(settings);
  return (
    <I18nProvider language={draft.ui_language}>
      <Setup draft={draft} change={setDraft} />
    </I18nProvider>
  );
}
function Setup({
  draft,
  change,
}: {
  draft: Settings;
  change: (settings: Settings) => void;
}) {
  const { t } = useI18n(),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const levels: {
    band: Band;
    label:
      | "New to Spanish"
      | "Some foundations"
      | "Ready for longer texts"
      | "Advanced school tasks";
  }[] = [
    { band: "A1", label: "New to Spanish" },
    { band: "A2", label: "Some foundations" },
    { band: "B1", label: "Ready for longer texts" },
    { band: "B2", label: "Advanced school tasks" },
  ];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await call(
        {
          command: "update_settings",
          payload: { settings: { ...draft, onboarding_complete: true } },
        },
        "settings",
      );
      cache.setQueryData(["settings"], saved);
      await cache.invalidateQueries({ queryKey: ["overview"] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="onboarding">
      <div className="onboarding-story">
        <Brand />
        <div>
          <h1>{t("Spanish for school.")}</h1>
          <p>{t("Grammar, vocabulary and the skills to use them.")}</p>
          <ul className="setup-subjects">
            <li>
              <Icon path={mdiTable} size="22px" aria-hidden="true" />
              {t("Grammar")}
            </li>
            <li>
              <Icon
                path={mdiBookOpenPageVariantOutline}
                size="22px"
                aria-hidden="true"
              />
              {t("Vocabulary")}
            </li>
            <li>
              <Icon
                path={mdiMicrophoneOutline}
                size="22px"
                aria-hidden="true"
              />
              {t("Speaking")}
            </li>
          </ul>
        </div>
      </div>
      <form
        className="setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="setup-heading">
          <h2>{t("Let’s begin")}</h2>
          <p className="muted">
            {t("Choose a language to learn from. You can change it later.")}
          </p>
        </div>
        <fieldset>
          <legend>{t("I learn from")}</legend>
          <div className="segmented language-options">
            {(["en", "de"] as SourceLanguage[]).map((language) => (
              <button
                type="button"
                aria-pressed={draft.source_language === language}
                key={language}
                onClick={() =>
                  change({
                    ...draft,
                    source_language: language,
                    ui_language: language,
                  })
                }
              >
                <Flag language={language} />
                {t(language === "en" ? "English" : "German")}
                {draft.source_language === language && (
                  <Icon path={mdiCheck} aria-hidden="true" size="17px" />
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("Your starting point")}</legend>
          <div className="level-options">
            {levels.map(({ band, label }) => (
              <button
                type="button"
                key={band}
                aria-pressed={draft.starting_band === band}
                onClick={() => change({ ...draft, starting_band: band })}
              >
                <strong>{band}</strong>
                <span>{t(label)}</span>
                {draft.starting_band === band && (
                  <Icon path={mdiCheck} aria-hidden="true" size="17px" />
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <ErrorNotice error={error} />
        <Button type="submit" disabled={busy} className="full-width">
          {t("Let’s begin")}
          <Icon path={mdiArrowRight} aria-hidden="true" size="19px" />
        </Button>
      </form>
    </main>
  );
}
