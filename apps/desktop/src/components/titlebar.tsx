import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../lib/i18n";
import {
  mdiWindowClose,
  mdiWindowMaximize,
  mdiWindowMinimize,
  mdiWindowRestore,
} from "@mdi/js";
import Icon from "./icon";

export function Titlebar() {
  const { t } = useI18n();
  const windows = navigator.userAgent.includes("Windows");
  const [maximized, setMaximized] = useState(false);
  const [failed, setFailed] = useState(false);
  const window = getCurrentWindow();
  const run = (action: Promise<unknown>) =>
    void action.catch(() => setFailed(true));
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const value = await window.isMaximized();
      if (active) setMaximized(value);
    };
    run(refresh());
    const listener = window
      .onResized(() => run(refresh()))
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      void listener.then((stop) => stop?.());
    };
  }, []);
  return (
    <header className="titlebar">
      <div className="window-drag" data-tauri-drag-region />
      {failed && (
        <span role="alert" className="window-error">
          {t("Window action failed. Try again.")}
        </span>
      )}
      <div
        className="window-controls"
        role="group"
        aria-label={t("Window controls")}
      >
        <button
          type="button"
          aria-label={t("Minimize window")}
          title={t("Minimize window")}
          onClick={() => run(window.minimize())}
        >
          {windows ? (
            <span className="caption-glyph" aria-hidden="true">
              {"\uE921"}
            </span>
          ) : (
            <Icon path={mdiWindowMinimize} size="16px" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={t(maximized ? "Restore window" : "Maximize window")}
          title={t(maximized ? "Restore window" : "Maximize window")}
          onClick={() => run(window.toggleMaximize())}
        >
          {windows ? (
            <span className="caption-glyph" aria-hidden="true">
              {maximized ? "\uE923" : "\uE922"}
            </span>
          ) : (
            <Icon
              path={maximized ? mdiWindowRestore : mdiWindowMaximize}
              size="14px"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label={t("Close window")}
          title={t("Close window")}
          onClick={() => run(window.close())}
        >
          {windows ? (
            <span className="caption-glyph" aria-hidden="true">
              {"\uE8BB"}
            </span>
          ) : (
            <Icon path={mdiWindowClose} size="16px" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
