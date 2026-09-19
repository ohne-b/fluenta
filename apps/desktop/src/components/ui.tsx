import * as Dialog from "@radix-ui/react-dialog";
import Icon from "./icon";
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiClose,
  mdiLoading,
} from "@mdi/js";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { useErrorMessage, useI18n } from "../lib/i18n";
import logo from "../assets/app-icon.svg";
import englishFlag from "../assets/flags/gb.svg";
import germanFlag from "../assets/flags/de.svg";
import spanishFlag from "../assets/flags/es.svg";

const flags = { en: englishFlag, de: germanFlag, es: spanishFlag };
export function Flag({ language }: { language: keyof typeof flags }) {
  return (
    <img
      className="flag"
      src={flags[language]}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={24}
      height={18}
    />
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && dismissible) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? "wide" : ""}`}
          {...(!description ? { "aria-describedby": undefined } : {})}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t("Close")} disabled={!dismissible}>
                <Icon path={mdiClose} aria-hidden="true" size="20px" />
              </IconButton>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="muted">
              {description}
            </Dialog.Description>
          )}
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const message = useErrorMessage(),
    { t } = useI18n();
  if (!error) return null;
  return (
    <div className="error-notice" role="alert">
      <Icon path={mdiAlertCircleOutline} aria-hidden="true" size="20px" />
      <div>
        <p>{message(error)}</p>
        {retry && (
          <button type="button" className="text-button" onClick={retry}>
            {t("Try again")}{" "}
            <Icon path={mdiArrowRight} aria-hidden="true" size="15px" />
          </button>
        )}
      </div>
    </div>
  );
}
export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <Icon path={mdiLoading} aria-hidden="true" size="25px" className="spin" />
      <span>{label ?? t("Loading…")}</span>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <img
        className="brand-mark"
        src={logo}
        alt={compact ? "Fluenta" : ""}
        width={48}
        height={48}
      />
      {!compact && <span>fluenta</span>}
    </span>
  );
}
