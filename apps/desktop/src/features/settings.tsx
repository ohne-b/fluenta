import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import Icon from "../components/icon";
import {
  mdiCheck,
  mdiDownload,
  mdiHarddisk,
  mdiLoading,
  mdiTrashCanOutline,
} from "@mdi/js";
import type { Settings } from "@fluenta/contracts";
import { call, request, useOperation } from "../lib/ipc";
import { useSettings } from "../lib/context";
import { useI18n } from "../lib/i18n";
import { Button, ErrorNotice, Loading, Modal } from "../components/ui";
import { AppUpdates } from "./updates";

function UninstallApp({
  disabled,
  beforeUninstall,
  onUninstalling,
}: {
  disabled: boolean;
  beforeUninstall: () => Promise<boolean>;
  onUninstalling: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: available } = useQuery({
    queryKey: ["can-uninstall"],
    queryFn: () => invoke<boolean>("can_uninstall"),
    staleTime: Infinity,
  });
  const [open, setOpen] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Parameters<typeof t>[0] | "">("");
  if (!available) return null;
  const uninstall = async () => {
    setBusy(true);
    setError("");
    onUninstalling(true);
    try {
      if (!removeData && !(await beforeUninstall()))
        throw new Error("Settings could not be saved");
      await invoke("uninstall_app", { removeData });
    } catch (error) {
      setError(
        error === "uninstall.busy"
          ? "Finish or cancel the current activity before uninstalling."
          : "The uninstaller could not start. Try again.",
      );
      setBusy(false);
      onUninstalling(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setRemoveData(false);
          setError("");
          setOpen(true);
        }}
      >
        <Icon path={mdiTrashCanOutline} aria-hidden="true" size="17px" />
        {t("Uninstall Fluenta")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        title={t("Uninstall Fluenta?")}
        description={t("The AI model is always removed.")}
      >
        <label className="switch-row">
          <span>
            <strong>{t("Also delete my learning data")}</strong>
            <span className="small muted">
              {t("Progress, notes, drafts and recordings.")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={removeData}
            disabled={busy}
            onChange={(event) => setRemoveData(event.target.checked)}
          />
        </label>
        {error && (
          <p className="error-notice" role="alert">
            {t(error)}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void uninstall()}
          >
            {t("Uninstall")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function ModelDownload({ condensed = false }: { condensed?: boolean }) {
  const { t } = useI18n(),
    cache = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["downloads"],
    queryFn: () => call({ command: "get_downloads" }, "downloads"),
  });
  const [remove, setRemove] = useState(false),
    [removeError, setRemoveError] = useState<unknown>(null),
    [removing, setRemoving] = useState(false);
  const operation = useOperation((event) => {
    if (["finished", "cancelled", "failed"].includes(event.event.event)) {
      void cache.invalidateQueries({ queryKey: ["downloads"] });
      void cache.invalidateQueries({ queryKey: ["overview"] });
    }
  }, false);
  useEffect(() => {
    if (data?.tutor_operation) operation.attach(data.tutor_operation);
  }, [data?.tutor_operation, operation.attach]);
  const tutor = data?.items.find((item) => !item.required);
  const uninstall = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await request({ command: "remove_tutor" });
      await cache.invalidateQueries({ queryKey: ["downloads"] });
      await cache.invalidateQueries({ queryKey: ["overview"] });
      setRemove(false);
    } catch (error) {
      setRemoveError(error);
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div className="downloads">
      <ErrorNotice error={error} />
      <div className="tutor-download">
        <div className="download-title">
          <span className="stat-icon coral">
            <Icon path={mdiHarddisk} aria-hidden="true" size="23px" />
          </span>
          <div>
            <strong>{tutor?.title ?? t("Local tutor")}</strong>
            <span className="small muted">
              {tutor && `${(Number(tutor.bytes) / 1e9).toFixed(2)} GB · `}
              {t("Optional")}
            </span>
          </div>
          {tutor?.installed && (
            <span className="pill installed">
              <Icon path={mdiCheck} aria-hidden="true" size="12px" />
              {t("Installed")}
            </span>
          )}
        </div>
        {operation.busy ? (
          <div className="download-progress">
            <div className="progress-label">
              <span>
                <Icon
                  path={mdiLoading}
                  aria-hidden="true"
                  size="15px"
                  className="spin"
                />
                {t(
                  operation.progress !== null && operation.progress > 0.995
                    ? "Verifying download…"
                    : "Downloading…",
                )}
              </span>
              <strong>{Math.floor((operation.progress ?? 0) * 100)}%</strong>
            </div>
            <progress max={1} value={operation.progress ?? 0} />
            <button
              className="text-button"
              onClick={() => void operation.cancel()}
            >
              {t("Cancel download")}
            </button>
          </div>
        ) : tutor?.installed ? (
          !condensed && (
            <button
              className="text-button muted"
              onClick={() => setRemove(true)}
            >
              <Icon path={mdiTrashCanOutline} aria-hidden="true" size="15px" />
              {t("Remove model")}
            </button>
          )
        ) : (
          <Button
            disabled={!data}
            onClick={() =>
              void operation.begin({
                command: "install_pack",
                payload: { release_id: tutor!.id },
              })
            }
          >
            <Icon path={mdiDownload} aria-hidden="true" size="18px" />
            {t("Download tutor")}
          </Button>
        )}
        <ErrorNotice error={operation.error} />
        <p className="small muted">{t("16 GB RAM recommended.")}</p>
      </div>
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        title={t("Remove model")}
        description={
          tutor
            ? `${tutor.title} · ${(Number(tutor.bytes) / 1e9).toFixed(2)} GB`
            : undefined
        }
      >
        <ErrorNotice error={removeError} />
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setRemove(false)}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={removing}
            onClick={() => void uninstall()}
          >
            {t("Remove model")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export function SettingsPanel({
  onInstalling,
}: {
  onInstalling: (busy: boolean) => void;
}) {
  const { data } = useSettings();
  return data ? (
    <SettingsForm initial={data} onInstalling={onInstalling} />
  ) : (
    <Loading />
  );
}
function SettingsForm({
  initial,
  onInstalling,
}: {
  initial: Settings;
  onInstalling: (busy: boolean) => void;
}) {
  const { t } = useI18n(),
    cache = useQueryClient();
  const [changes, setChanges] = useState<Partial<Settings>>({}),
    [busy, setBusy] = useState(false),
    [installing, setInstalling] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<unknown>(null),
    [backupMessage, setBackupMessage] = useState("");
  const restoring = useRef(false);
  const draft = { ...initial, ...changes };
  const studioDraft = cache.getQueryData<{
    document: { text: string };
    text: string;
  }>(["studio-document"]);
  const courses = useOperation((event) => {
    if (event.event.event === "finished") {
      setBackupMessage(t("Courses updated"));
      void cache.invalidateQueries();
    }
  }, false);
  const backup = useOperation((event) => {
    if (event.event.event === "finished") {
      if (restoring.current) setChanges({});
      setBackupMessage(
        t(restoring.current ? "Backup restored" : "Backup completed"),
      );
      void cache.invalidateQueries();
    }
  }, false);
  const update = (patch: Partial<Settings>) => {
    setChanges((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const save = async (theme?: Settings["theme"]) => {
    setBusy(true);
    setError(null);
    try {
      const value = await call(
        {
          command: "update_settings",
          payload: { settings: theme ? { ...initial, theme } : draft },
        },
        "settings",
      );
      cache.setQueryData(["settings"], value);
      if (!theme) setChanges({});
      await cache.invalidateQueries({ queryKey: ["overview"] });
      if (!theme) {
        await cache.invalidateQueries({ queryKey: ["connected"] });
        setSaved(true);
      }
      return true;
    } catch (error) {
      setError(error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-content">
      <div className="settings-options" inert={installing}>
        <section>
          <h3>{t("Learning preferences")}</h3>
          <div className="settings-fields">
            <label>
              {t("Learning language")}
              <select
                disabled={busy}
                value={draft.source_language}
                onChange={(event) =>
                  update({
                    source_language: event.target
                      .value as Settings["source_language"],
                  })
                }
              >
                <option value="en">English → Español</option>
                <option value="de">Deutsch → Español</option>
              </select>
            </label>
            <label>
              {t("App language")}
              <select
                disabled={busy}
                value={draft.ui_language}
                onChange={(event) =>
                  update({
                    ui_language: event.target.value as Settings["ui_language"],
                  })
                }
              >
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </select>
            </label>
            <label>
              {t("Your starting point")}
              <select
                disabled={busy}
                value={draft.starting_band}
                onChange={(event) =>
                  update({
                    starting_band: event.target
                      .value as Settings["starting_band"],
                  })
                }
              >
                {["A1", "A2", "B1", "B2"].map((band) => (
                  <option key={band}>{band}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("Appearance")}</legend>
            <div className="segmented">
              {(["system", "light", "dark"] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  disabled={busy}
                  aria-pressed={draft.theme === theme}
                  onClick={() => void save(theme)}
                >
                  {t(
                    theme === "system"
                      ? "System"
                      : theme === "light"
                        ? "Light"
                        : "Dark",
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="switch-row">
            <span>
              <strong>{t("Spanish speech")}</strong>
              <span className="small muted">
                {t("Read examples and listening activities aloud.")}
              </span>
            </span>
            <input
              type="checkbox"
              disabled={busy}
              role="switch"
              checked={draft.audio_enabled}
              onChange={(event) =>
                update({ audio_enabled: event.target.checked })
              }
            />
          </label>
          <ErrorNotice error={error} />
          <div className="settings-save">
            <Button disabled={busy} onClick={() => void save()}>
              {saved ? (
                <Icon path={mdiCheck} aria-hidden="true" size="17px" />
              ) : null}
              {t(saved ? "Saved" : "Save settings")}
            </Button>
          </div>
        </section>
        <section>
          <h3>{t("Tutor")}</h3>
          <ModelDownload />
        </section>
        <section>
          <h3>{t("Course updates")}</h3>
          <Button
            variant="secondary"
            disabled={courses.busy || backup.busy}
            onClick={() => void courses.begin({ command: "import_courses" })}
          >
            <Icon path={mdiDownload} aria-hidden="true" size="17px" />
            {t("Install course file")}
          </Button>
          {courses.busy && <Loading />}
          <ErrorNotice error={courses.error} />
        </section>
        <section>
          <h3>{t("Your data")}</h3>
          <p className="muted">
            {t(
              "Back up your progress, drafts, conversations and recordings to a file you control.",
            )}
          </p>
          <div className="button-row">
            <Button
              variant="secondary"
              disabled={backup.busy}
              onClick={() => {
                restoring.current = false;
                setBackupMessage("");
                void backup.begin({ command: "create_backup" });
              }}
            >
              <Icon path={mdiDownload} aria-hidden="true" size="17px" />
              {t("Export a backup")}
            </Button>
            <Button
              variant="ghost"
              disabled={backup.busy}
              onClick={() => {
                restoring.current = true;
                setBackupMessage("");
                void backup.begin({ command: "restore_backup" });
              }}
            >
              {t("Restore a backup")}
            </Button>
          </div>
          {backup.busy && (
            <Icon
              path={mdiLoading}
              aria-hidden="true"
              size="17px"
              className="spin"
            />
          )}
          <p role="status" className="small success-text">
            {backupMessage}
          </p>
          <ErrorNotice error={backup.error} />
        </section>
      </div>
      <section className="about">
        <AppUpdates
          blockedReason={
            studioDraft && studioDraft.text !== studioDraft.document.text
              ? t("Save your open Studio file before installing an update.")
              : undefined
          }
          beforeInstall={() => save()}
          disabled={busy || backup.busy || courses.busy}
          onInstalling={(value) => {
            setInstalling(value);
            onInstalling(value);
          }}
        />
        <UninstallApp
          disabled={
            busy ||
            installing ||
            backup.busy ||
            courses.busy ||
            Boolean(
              studioDraft && studioDraft.text !== studioDraft.document.text,
            )
          }
          beforeUninstall={() => save()}
          onUninstalling={(value) => {
            setInstalling(value);
            onInstalling(value);
          }}
        />
      </section>
    </div>
  );
}
