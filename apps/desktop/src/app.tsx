import { Today } from "./features/today";
import { Topics } from "./features/topics";
import { MyWords } from "./features/words";
import { useCopy } from "./lib/connected";
import "./connected.css";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Icon from "./components/icon";
import {
  mdiBookOpenPageVariantOutline,
  mdiBullseyeArrow,
  mdiCogOutline,
  mdiLaptop,
  mdiMessageTextOutline,
  mdiFormatLetterCase,
  mdiWeatherSunny,
  mdiBookmarkMultipleOutline,
  mdiGithub,
} from "@mdi/js";
import type { ContentRef, Settings } from "@fluenta/contracts";
import { AppActions, useSettings } from "./lib/context";
import { desktopAvailable, request } from "./lib/ipc";
import { I18nProvider, useI18n } from "./lib/i18n";
import { Brand, Button, ErrorNotice, Loading, Modal } from "./components/ui";
import { Learn } from "./features/learn";
import { Practice } from "./features/practice";
import { SessionPage } from "./features/lesson";
import { Onboarding } from "./features/onboarding";
import { TutorPage } from "./features/tutor";
import { SettingsPanel } from "./features/settings";
import { ReferencePanel } from "./features/reference";
import { Titlebar } from "./components/titlebar";
import { Grammar } from "./features/grammar";
const Studio =
  import.meta.env.MODE === "studio"
    ? lazy(() => import("../../studio/src/editor"))
    : undefined;

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Fluenta view error", error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <Brand />
        <h1>Fluenta needs to reopen this view.</h1>
        <Button onClick={() => window.location.reload()}>Reload Fluenta</Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  return desktopAvailable ? <DesktopFrame /> : <DesktopRequired />;
}
function DesktopFrame() {
  const { data } = useSettings();
  return (
    <I18nProvider language={data?.ui_language ?? "en"}>
      <div className="desktop-frame">
        <Titlebar />
        <div className="desktop-viewport">
          <ErrorBoundary>
            <DesktopApp />
          </ErrorBoundary>
        </div>
      </div>
    </I18nProvider>
  );
}
function DesktopRequired() {
  const { t } = useI18n();
  return (
    <main className="fatal-error">
      <Brand />
      <Icon path={mdiLaptop} aria-hidden="true" size="54px" />
      <h1>{t("Open Fluenta on your desktop")}</h1>
      {import.meta.env.DEV && <code>npm run desktop:dev</code>}
    </main>
  );
}
function DesktopApp() {
  const { data, error, refetch } = useSettings();
  if (!data)
    return (
      <div className="startup">
        <Brand />
        {error ? (
          <ErrorNotice error={error} retry={() => void refetch()} />
        ) : (
          <Loading />
        )}
      </div>
    );
  return (
    <>
      {!data.onboarding_complete ? (
        <Onboarding settings={data} />
      ) : (
        <Shell settings={data} />
      )}
    </>
  );
}
function Shell({ settings }: { settings: Settings }) {
  const c = useCopy();
  const { t } = useI18n(),
    location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false),
    [linkError, setLinkError] = useState<unknown>(null),
    [installingUpdate, setInstallingUpdate] = useState(false),
    [referenceOpen, setReferenceOpen] = useState(false),
    [reference, setReference] = useState<ContentRef | undefined>();
  const session = location.pathname.startsWith("/session/");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.closest(".desktop-viewport")?.scrollTo(0, 0);
  }, [location.pathname]);
  const openReference = (value?: ContentRef) => {
    setReference(value);
    setReferenceOpen(true);
  };
  useEffect(() => {
    document.documentElement.lang = settings.ui_language;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? query.matches
            ? "dark"
            : "light"
          : settings.theme;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings.theme, settings.ui_language]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !session &&
        !settingsOpen &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openReference();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [session, settingsOpen]);
  return (
    <AppActions
      value={{
        reference: openReference,
      }}
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
      >
        {c("Skip to content", "Zum Inhalt springen")}
      </a>
      <div className={session ? "focused-layout" : "app-layout"}>
        {!session && (
          <aside className="sidebar">
            <NavLink to="/today" className="brand-link" aria-label="Fluenta">
              <Brand />
            </NavLink>
            <nav aria-label="Fluenta">
              {[
                ["/today", c("Today", "Heute"), mdiWeatherSunny],
                [
                  "/topics",
                  c("Topics", "Themen"),
                  mdiBookOpenPageVariantOutline,
                ],
                [
                  "/words",
                  c("My words", "Meine Wörter"),
                  mdiBookmarkMultipleOutline,
                ],
                ["/practice", t("Practice"), mdiBullseyeArrow],
                ["/grammar", t("Grammar"), mdiFormatLetterCase],
              ].map(([to, label, icon]) => (
                <NavLink key={to} to={to!} aria-label={label} title={label}>
                  <Icon path={icon!} aria-hidden="true" size="22px" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <NavLink to="/tutor" className="settings-nav" title={t("Tutor")}>
                <Icon path={mdiMessageTextOutline} size="20px" />
                {t("Tutor")}
              </NavLink>
              <a
                className="settings-nav"
                href="https://github.com/ohne-b/fluenta"
                title="GitHub"
                onClick={(event) => {
                  event.preventDefault();
                  setLinkError(null);
                  void request({
                    command: "open_source",
                    payload: { url: event.currentTarget.href },
                  }).catch(setLinkError);
                }}
              >
                <Icon path={mdiGithub} aria-hidden="true" size="20px" />
                GitHub
              </a>
              <ErrorNotice error={linkError} />
              <button
                className="settings-nav"
                title={t("Settings")}
                onClick={() => setSettingsOpen(true)}
              >
                <Icon path={mdiCogOutline} aria-hidden="true" size="20px" />
                {t("Settings")}
              </button>
            </div>
          </aside>
        )}
        <div
          className="app-content"
          id="main-content"
          ref={content}
          tabIndex={-1}
        >
          {Studio && !session && location.pathname !== "/author" && (
            <NavLink className="studio-return text-button" to="/author">
              Fluenta Studio · Open editor
            </NavLink>
          )}
          <Routes>
            {Studio && (
              <Route
                path="/author"
                element={
                  <Suspense fallback={<Loading />}>
                    <Studio />
                  </Suspense>
                }
              />
            )}
            <Route path="/today" element={<Today />} />
            <Route path="/topics" element={<Topics />} />
            <Route path="/topics/:topicId" element={<Topics />} />
            <Route path="/words" element={<MyWords />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/grammar" element={<Grammar />} />
            <Route path="/grammar/:topicId" element={<Grammar />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/tutor" element={<TutorPage />} />
            <Route path="/session/:id" element={<SessionPage />} />
            <Route
              path="*"
              element={<Navigate to={Studio ? "/author" : "/today"} replace />}
            />
          </Routes>
        </div>
        <Modal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={t("Settings")}
          wide
          dismissible={!installingUpdate}
        >
          <SettingsPanel onInstalling={setInstallingUpdate} />
        </Modal>
        <Modal
          open={referenceOpen}
          onClose={() => setReferenceOpen(false)}
          title={t("Reference")}
          wide
        >
          <ReferencePanel initial={reference} />
        </Modal>
      </div>
    </AppActions>
  );
}
