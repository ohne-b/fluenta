import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import Icon from "../components/icon";
import { mdiDownload, mdiLoading, mdiRefresh } from "@mdi/js";
import { useI18n } from "../lib/i18n";
import { Button } from "../components/ui";

export function AppUpdates({
  beforeInstall,
  onInstalling,
  disabled = false,
  blockedReason,
}: {
  beforeInstall: () => Promise<boolean>;
  onInstalling: (busy: boolean) => void;
  disabled?: boolean;
  blockedReason?: string;
}) {
  const { t } = useI18n();
  const { data: version } = useQuery({
    queryKey: ["app-version"],
    queryFn: getVersion,
    staleTime: Infinity,
  });
  const update = useRef<Update | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installing"
    | "error"
  >("idle");
  const [progress, setProgress] = useState<number>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void update.current?.close().catch(() => {});
    };
  }, []);
  const checkRelease = async () => {
    setPhase("checking");
    try {
      await update.current?.close();
      update.current = null;
      const candidate = await check({ timeout: 15_000 });
      if (!mounted.current) {
        await candidate?.close();
        return;
      }
      update.current = candidate;
      setPhase(candidate ? "available" : "current");
    } catch (error) {
      console.error("Fluenta updater:", error);
      if (mounted.current) setPhase("error");
    }
  };
  const install = async () => {
    if (!update.current || blockedReason) return;
    onInstalling(true);
    setProgress(undefined);
    setPhase("downloading");
    try {
      if (!(await beforeInstall())) {
        setPhase("error");
        return;
      }
      let received = 0,
        total = 0;
      await update.current.downloadAndInstall(
        (event) => {
          if (!mounted.current) return;
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            received += event.data.chunkLength;
            if (total) setProgress(Math.min(1, received / total));
          }
          if (event.event === "Finished") setPhase("installing");
        },
        { timeout: 600_000 },
      );
      await relaunch();
    } catch (error) {
      console.error("Fluenta updater:", error);
      if (mounted.current) setPhase("error");
    } finally {
      if (mounted.current) onInstalling(false);
    }
  };
  const installing = phase === "downloading" || phase === "installing";
  return (
    <div className="app-updates">
      <div className="update-heading">
        <h3>{t("App updates")}</h3>
        <span className="small muted">Fluenta {version}</span>
      </div>
      {blockedReason && (
        <p role="status" className="small danger-text">
          {blockedReason}
        </p>
      )}
      {phase === "current" && (
        <p role="status" className="small success-text">
          {t("You have the latest version.")}
        </p>
      )}
      {phase === "available" && update.current && (
        <div className="release-notes">
          <strong>
            {t("Available update")} · {update.current.version}
          </strong>
          {update.current.body && <p>{update.current.body}</p>}
          <p className="small muted">
            {t(
              "Fluenta will close to install the update. Your settings are saved first.",
            )}
          </p>
        </div>
      )}
      {installing && (
        <div role="status" className="update-progress">
          <p>
            {t(
              phase === "installing"
                ? "Verifying and installing…"
                : "Downloading update…",
            )}
          </p>
          <progress
            max={1}
            value={progress}
            aria-label={t("Downloading update…")}
          />
        </div>
      )}
      {phase === "error" && (
        <p role="alert" className="small danger-text">
          {t(
            "The update could not be completed. Check your connection and try again.",
          )}
        </p>
      )}
      <Button
        variant="secondary"
        disabled={
          disabled ||
          phase === "checking" ||
          installing ||
          (phase === "available" && !!blockedReason)
        }
        onClick={() =>
          void (phase === "available" ? install() : checkRelease())
        }
      >
        <Icon
          path={
            phase === "checking" || installing
              ? mdiLoading
              : phase === "available"
                ? mdiDownload
                : mdiRefresh
          }
          size="19px"
          className={phase === "checking" || installing ? "spin" : undefined}
          aria-hidden="true"
        />
        {t(
          phase === "available"
            ? "Download and install"
            : phase === "checking"
              ? "Checking…"
              : installing
                ? "Updating…"
                : "Check for updates",
        )}
      </Button>
    </div>
  );
}
