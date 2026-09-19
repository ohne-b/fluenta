import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { mdiHelp, mdiMagnify } from "@mdi/js";
import { useAppActions } from "../lib/context";
import { useI18n } from "../lib/i18n";
import Icon from "./icon";

export function PageHeading({
  children,
  grammarHelp = false,
}: {
  children: ReactNode;
  grammarHelp?: boolean;
}) {
  const { t } = useI18n();
  const actions = useAppActions();
  return (
    <header className="page-heading">
      {children}
      <div className="page-actions">
        {grammarHelp && (
          <NavLink
            to="/grammar"
            className="icon-button"
            aria-label={t("Grammar help")}
            title={t("Grammar help")}
          >
            <Icon path={mdiHelp} aria-hidden="true" size="22px" />
          </NavLink>
        )}
        <button
          type="button"
          aria-label={t("Search")}
          aria-keyshortcuts="Control+k Meta+k"
          className="search-shortcut"
          onClick={() => actions.reference()}
        >
          <Icon path={mdiMagnify} aria-hidden="true" size="17px" />
          <span>{t("Search")}</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>
    </header>
  );
}
