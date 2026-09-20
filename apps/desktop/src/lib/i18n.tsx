import { createContext, useContext, type ReactNode } from "react";
import type { SourceLanguage } from "@fluenta/contracts";

const de = {
  "Uninstall Fluenta": "Fluenta deinstallieren",
  "Uninstall Fluenta?": "Fluenta deinstallieren?",
  "The AI model is always removed.": "Das KI-Modell wird immer entfernt.",
  "Also delete my learning data": "Auch meine Lerndaten löschen",
  "Progress, notes, drafts and recordings.":
    "Fortschritt, Notizen, Entwürfe und Aufnahmen.",
  "The uninstaller could not start. Try again.":
    "Die Deinstallation konnte nicht gestartet werden. Versuche es erneut.",
  Uninstall: "Deinstallieren",
  "Finish or cancel the current activity before uninstalling.":
    "Beende oder stoppe die laufende Aktivität vor der Deinstallation.",
  Studio: "Studio",
  "Grammar help": "Grammatikhilfe",
  "Grammar course": "Grammatikkurs",
  Explanation: "Erklärung",
  Exercises: "Übungen",
  "All grammar": "Grammatikübersicht",
  "This grammar course is not in your installed content.":
    "Dieser Grammatikkurs ist nicht in deinen installierten Inhalten enthalten.",
  "Search grammar": "Grammatik durchsuchen",
  "No grammar courses match your search.":
    "Keine Grammatikkurse passen zu deiner Suche.",
  "No explanation is linked to this activity yet.":
    "Für diese Aufgabe ist noch keine Erklärung verknüpft.",

  "Save your open Studio file before installing an update.":
    "Speichere die offene Studio-Datei, bevor du ein Update installierst.",
  "App updates": "App-Updates",
  "You have the latest version.": "Du hast die aktuelle Version.",
  "Available update": "Verfügbares Update",
  "Fluenta will close to install the update. Your settings are saved first.":
    "Fluenta wird zur Installation geschlossen. Deine Einstellungen werden vorher gespeichert.",
  "Verifying and installing\u2026": "Prüfen und installieren…",
  "Downloading update\u2026": "Update wird heruntergeladen…",
  "The update could not be completed. Check your connection and try again.":
    "Das Update konnte nicht abgeschlossen werden. Prüfe die Verbindung und versuche es erneut.",
  "Download and install": "Herunterladen und installieren",
  "Checking\u2026": "Wird geprüft…",
  "Updating\u2026": "Wird aktualisiert…",
  "Check for updates": "Nach Updates suchen",

  "Window controls": "Fenstersteuerung",
  "Minimize window": "Fenster minimieren",
  "Maximize window": "Fenster maximieren",
  "Restore window": "Fenster wiederherstellen",
  "Close window": "Fenster schließen",
  "Window action failed. Try again.":
    "Fensteraktion fehlgeschlagen. Versuche es erneut.",
  "Your Spanish": "Dein Spanisch",
  "Spanish for school.": "Spanisch für die Schule.",
  "Grammar, vocabulary and the skills to use them.":
    "Grammatik, Wortschatz und die Fähigkeiten, beides anzuwenden.",
  "Learning preferences": "Lerneinstellungen",
  "Lesson complete": "Lektion abgeschlossen",
  Correct: "Richtig",
  "Check the explanation": "Sieh dir die Erklärung an",
  "Review your answer": "Prüfe deine Antwort",

  "Load more": "Mehr laden",
  "Local tutor": "Lokaler Tutor",
  "16 GB RAM recommended.": "16 GB RAM empfohlen.",
  "Course updates": "Kurs-Updates",
  "Courses updated": "Kurse aktualisiert",
  "Install course file": "Kursdatei installieren",
  "Your changes still need saving.":
    "Deine Änderungen sind noch nicht gespeichert.",
  Learn: "Lernen",
  Practice: "Üben",
  Tutor: "Tutor",
  Settings: "Einstellungen",
  Search: "Suchen",
  "Search your Spanish reference": "In deinen Spanischmaterialien suchen",
  "Continue learning": "Weiterlernen",
  "Start learning": "Loslernen",
  "Your course": "Dein Kurs",
  Foundations: "Grundlagen",
  "Build connections": "Zusammenhänge zeigen",
  "Express your ideas": "Gedanken ausdrücken",
  "Make your case": "Argumente entwickeln",
  "Lessons completed": "Lektionen abgeschlossen",
  "Ready to review": "Zum Wiederholen bereit",
  "Answers today": "Antworten heute",
  "Your week": "Deine Woche",
  min: "Min.",
  activities: "Aufgaben",
  "Start lesson": "Lektion starten",
  "Replay lesson": "Lektion wiederholen",
  Review: "Wiederholen",
  "Review what is due": "Fälliges wiederholen",
  "A short session built from your previous answers.":
    "Eine kurze Lerneinheit auf Grundlage deiner bisherigen Antworten.",
  "Nothing due right now": "Gerade ist nichts fällig",
  "Keep learning. Your next review will appear here.":
    "Lerne weiter. Deine nächste Wiederholung erscheint hier.",
  "Choose what to work on": "Woran möchtest du arbeiten?",
  "All skills": "Alle Fertigkeiten",
  Grammar: "Grammatik",
  Vocabulary: "Wortschatz",
  Reading: "Lesen",
  Listening: "Hören",
  Writing: "Schreiben",
  Speaking: "Sprechen",
  "Check your skills": "Prüfe deinen Lernstand",
  "A timed checkpoint. Feedback comes at the end.":
    "Ein Test mit Zeitlimit. Rückmeldung bekommst du am Ende.",
  "Start checkpoint": "Test starten",
  "Before you begin": "Bevor du beginnst",
  "The timer keeps running if you leave or close the app. Hints, references and the tutor are unavailable until you finish. Listening allows an initial play and two replays.":
    "Die Zeit läuft weiter, auch wenn du die App schließt. Hinweise, Nachschlagewerk und Tutor sind bis zum Abschluss gesperrt. Hörtexte kannst du einmal abspielen und zweimal wiederholen.",
  Begin: "Beginnen",
  Cancel: "Abbrechen",
  Close: "Schließen",
  Back: "Zurück",
  Continue: "Weiter",
  "Check answer": "Antwort prüfen",
  "Save answer": "Antwort speichern",
  "Your answer": "Deine Antwort",
  "Type your answer in Spanish": "Schreibe deine Antwort auf Spanisch",
  "Write in Spanish…": "Schreibe auf Spanisch …",
  "Arrange the words": "Ordne die Wörter",
  "Tap words to build your sentence. Tap again to return a word.":
    "Wähle Wörter aus, um den Satz zu bilden. Erneutes Antippen legt ein Wort zurück.",
  "Selected words": "Ausgewählte Wörter",
  "Available words": "Verfügbare Wörter",
  "Choose all that apply": "Wähle alle passenden Antworten",
  "Choose one answer": "Wähle eine Antwort",
  "Need a hint?": "Brauchst du einen Hinweis?",
  "A hint counts as supported practice.":
    "Mit Hinweis zählt die Antwort als unterstützte Übung.",
  "Show hint": "Hinweis anzeigen",
  "Answer saved": "Antwort gespeichert",
  "Use the guidance below to check your work. Longer answers are not automatically graded.":
    "Prüfe deine Antwort anhand der Kriterien. Längere Antworten werden nicht automatisch benotet.",
  "You used support for this answer.":
    "Du hast für diese Antwort Unterstützung genutzt.",
  "Recognised content, not a pronunciation score.":
    "Erkannter Inhalt, keine Aussprachebewertung.",
  "Edited transcript": "Bearbeitete Transkription",
  Listen: "Anhören",
  Slower: "Langsamer",
  "Stop audio": "Audio stoppen",
  "Preparing audio…": "Audio wird vorbereitet …",
  "Speak your answer": "Sprich deine Antwort",
  "Record your response": "Nimm deine Antwort auf",
  "Stop recording": "Aufnahme beenden",
  "Listening…": "Aufnahme läuft …",
  "Transcribing…": "Transkribieren …",
  "Check what we heard before submitting. You can edit it.":
    "Prüfe den erkannten Text vor dem Absenden. Du kannst ihn bearbeiten.",
  "Record again": "Neu aufnehmen",
  "Type instead": "Stattdessen schreiben",
  "Play my recording": "Meine Aufnahme anhören",
  "Recording saved": "Aufnahme gespeichert",
  words: "Wörter",
  "Leave this session?": "Lerneinheit verlassen?",
  "Your answer and place will be saved. Come back whenever you’re ready.":
    "Deine Antwort und Position werden gespeichert. Du kannst jederzeit weitermachen.",
  "Keep learning": "Weiterlernen",
  "Save and leave": "Speichern und verlassen",
  "End checkpoint": "Test beenden",
  "The timer will keep running.": "Die Zeit läuft weiter.",
  "Answers checked": "Antworten geprüft",
  "Correct without hints": "Richtig ohne Hinweise",
  "To revisit": "Noch einmal ansehen",
  "See your answers": "Deine Antworten ansehen",
  "Back to learning": "Zurück zum Lernen",
  "No answer submitted": "Keine Antwort abgegeben",
  "Model response": "Modellantwort",
  "Choose a language to learn from. You can change it later.":
    "Wähle deine Ausgangssprache. Du kannst sie später ändern.",
  "I learn from": "Ich lerne auf",
  English: "Englisch",
  German: "Deutsch",
  Spanish: "Spanisch",
  "Your starting point": "Dein Einstieg",
  "New to Spanish": "Neu in Spanisch",
  "Some foundations": "Erste Grundlagen",
  "Ready for longer texts": "Bereit für längere Texte",
  "Advanced school tasks": "Anspruchsvolle Schulaufgaben",
  "Let’s begin": "Los geht’s",
  "Learning language": "Ausgangssprache",
  "App language": "Sprache der App",
  Appearance: "Darstellung",
  System: "System",
  Light: "Hell",
  Dark: "Dunkel",
  minutes: "Minuten",
  Audio: "Audio",
  "Spanish speech": "Spanische Sprachausgabe",
  "Read examples and listening activities aloud.":
    "Beispiele und Hörübungen vorlesen lassen.",
  "Save settings": "Einstellungen speichern",
  Saved: "Gespeichert",
  Optional: "Optional",
  Installed: "Installiert",
  "Download tutor": "Tutor herunterladen",
  "Remove model": "Modell entfernen",
  "Downloading…": "Wird heruntergeladen …",
  "Verifying download…": "Download wird geprüft …",
  "Cancel download": "Download abbrechen",
  "Your data": "Deine Daten",
  "Export a backup": "Sicherung exportieren",
  "Restore a backup": "Sicherung wiederherstellen",
  "Back up your progress, drafts, conversations and recordings to a file you control.":
    "Sichere Fortschritt, Entwürfe, Gespräche und Aufnahmen in einer eigenen Datei.",
  "Backup completed": "Sicherung abgeschlossen",
  "Backup restored": "Sicherung wiederhergestellt",
  "New conversation": "Neues Gespräch",
  "Recent conversations": "Letzte Gespräche",
  Conversation: "Gespräch",
  "Explain something": "Etwas erklären",
  "Writing feedback": "Schreibrückmeldung",
  "Practise talking about school": "Über die Schule sprechen",
  "Explain the past tenses": "Vergangenheitszeiten erklären",
  "Help me structure an argument": "Eine Argumentation aufbauen",
  "Explain the difference between indefinido and imperfecto using a school example.":
    "Erkläre die spanischen Vergangenheitsformen Indefinido und Imperfecto auf Deutsch. Gib für jede ein kurzes Beispiel aus der Schule.",
  "Help me plan a short argument in Spanish about phones in class: a position, a reason and an example.":
    "Hilf mir, eine kurze Argumentation auf Spanisch über Handys im Unterricht zu planen: eine These, eine Begründung und ein Beispiel.",
  "Message your tutor…": "Schreibe deinem Tutor …",
  "Send message": "Nachricht senden",
  "Generating reply…": "Antwort wird erstellt …",
  "Stop response": "Antwort stoppen",
  "Course references": "Kursbezüge",
  "Delete conversation": "Gespräch löschen",
  "Using your current lesson as context":
    "Deine aktuelle Lektion dient als Kontext",
  "Remove lesson context": "Lektionskontext entfernen",
  Reference: "Nachschlagen",
  Bookmarks: "Lesezeichen",
  "Find an explanation, phrase or word.":
    "Finde eine Erklärung, Wendung oder ein Wort.",
  "Search Spanish and your teaching language.":
    "Suche auf Spanisch und in deiner Ausgangssprache.",
  "No results yet": "Noch keine Treffer",
  "Try a word such as ser, pasado or texto.":
    "Versuche ein Wort wie ser, pasado oder texto.",
  "No bookmarks yet": "Noch keine Lesezeichen",
  "Save a reference to find it here.":
    "Speichere einen Eintrag, um ihn hier wiederzufinden.",
  Bookmark: "Als Lesezeichen speichern",
  "Remove bookmark": "Lesezeichen entfernen",
  "Try again": "Erneut versuchen",
  "Loading…": "Laden …",
  "Open Fluenta on your desktop": "Öffne Fluenta als Desktop-App",
} as const;
export type Key = keyof typeof de;
const LanguageContext = createContext<SourceLanguage>("en");
export function I18nProvider({
  language,
  children,
}: {
  language: SourceLanguage;
  children: ReactNode;
}) {
  return <LanguageContext value={language}>{children}</LanguageContext>;
}
export function useI18n() {
  const language = useContext(LanguageContext);
  return {
    language,
    t: (key: Key): string => (language === "de" ? de[key] : key),
  };
}

const errors: Record<string, [string, string]> = {
  "courses.invalid": [
    "This course file could not be verified. Download an official signed release.",
    "Diese Kursdatei konnte nicht geprüft werden. Lade eine offiziell signierte Veröffentlichung herunter.",
  ],
  "courses.older_release": [
    "This course release is already installed or older than your installed version.",
    "Dieser Kurs ist bereits installiert oder älter als deine installierte Version.",
  ],
  "courses.revision_conflict": [
    "The publisher changed existing content without a new revision. This course cannot be installed safely.",
    "Vorhandene Inhalte wurden ohne neue Revision geändert. Dieser Kurs kann nicht sicher installiert werden.",
  ],
  "state.conflict": [
    "Your saved session has changed. Reload it and try again.",
    "Deine gespeicherte Lerneinheit wurde geändert. Lade sie neu und versuche es erneut.",
  ],
  "operation.busy": [
    "Let the current task finish, or cancel it first.",
    "Warte, bis die laufende Aufgabe fertig ist, oder brich sie zuerst ab.",
  ],
  "speech.device_unavailable": [
    "The audio device is unavailable. Check your microphone, speakers and system permissions.",
    "Das Audiogerät ist nicht verfügbar. Prüfe Mikrofon, Lautsprecher und Systemberechtigungen.",
  ],
  "speech.no_speech": [
    "No clear speech was captured. Try again, or type your answer.",
    "Es wurde keine klare Sprache aufgenommen. Versuche es erneut oder schreibe deine Antwort.",
  ],
  "speech.failed": [
    "Speech could not finish. Check the installed speech files and try again.",
    "Die Sprachverarbeitung konnte nicht abgeschlossen werden. Prüfe die installierten Sprachdateien und versuche es erneut.",
  ],
  "speech.disabled": [
    "Enable Spanish speech in Settings to play this audio.",
    "Aktiviere die spanische Sprachausgabe in den Einstellungen.",
  ],
  "speech.stop_playback_first": [
    "Stop the audio before recording your answer.",
    "Stoppe das Audio, bevor du deine Antwort aufnimmst.",
  ],
  "speech.stop_recording_first": [
    "Finish your recording before playing audio.",
    "Beende die Aufnahme, bevor du Audio abspielst.",
  ],
  "test.finish_first": [
    "Finish or end your checkpoint before opening other activities.",
    "Schließe deinen Test ab oder beende ihn, bevor du andere Aktivitäten öffnest.",
  ],
  "test.time_expired": [
    "Time is up. Your saved answers are ready to review.",
    "Die Zeit ist abgelaufen. Du kannst deine gespeicherten Antworten ansehen.",
  ],
  "test.replays_exhausted": [
    "You have used the listening replays for this question.",
    "Du hast alle Wiederholungen für diese Höraufgabe genutzt.",
  ],
  "answer.word_count": [
    "Keep your answer within the displayed word range.",
    "Halte dich an den angezeigten Wortbereich.",
  ],
  "tutor.not_installed": [
    "Download the optional tutor model to start a conversation.",
    "Lade das freiwillige Tutor-Modell herunter, um ein Gespräch zu beginnen.",
  ],
  "tutor.invalid_response": [
    "The tutor returned an incomplete or invalid reply. Please try again.",
    "Der Tutor hat eine unvollständige oder ungültige Antwort geliefert. Versuche es erneut.",
  ],
  "tutor.context_too_long": [
    "This is too much for one tutor turn. Shorten your message or start a new conversation.",
    "Das ist zu viel für eine einzelne Tutor-Antwort. Kürze deine Nachricht oder starte ein neues Gespräch.",
  ],
  "tutor.failed": [
    "The tutor could not finish. Close other demanding apps and try again.",
    "Der Tutor konnte nicht fertig werden. Schließe andere aufwendige Programme und versuche es erneut.",
  ],
  "tutor.language_mismatch": [
    "Start a new conversation for your current learning language.",
    "Starte für deine aktuelle Ausgangssprache ein neues Gespräch.",
  ],
  "download.failed": [
    "The download stopped. Check your connection and retry; the saved part can be resumed.",
    "Der Download wurde unterbrochen. Prüfe deine Verbindung und starte ihn erneut. Der gespeicherte Teil kann fortgesetzt werden.",
  ],
  "download.insufficient_space": [
    "There is not enough free space for this model.",
    "Für dieses Modell ist nicht genug Speicherplatz frei.",
  ],
  "download.integrity": [
    "The file did not pass verification. Download it again.",
    "Die Datei hat die Prüfung nicht bestanden. Lade sie erneut herunter.",
  ],
  "backup.invalid": [
    "This is not a valid Fluenta backup. Your current progress is unchanged.",
    "Das ist keine gültige Fluenta-Sicherung. Dein aktueller Fortschritt bleibt erhalten.",
  ],
  "storage.failure": [
    "Your data could not be saved. Check free disk space and folder access before continuing.",
    "Deine Daten konnten nicht gespeichert werden. Prüfe freien Speicherplatz und Ordnerzugriff, bevor du fortfährst.",
  ],
  "app.update_required": [
    "The app and its content need matching versions. Reinstall the latest release.",
    "App und Inhalte brauchen zueinander passende Versionen. Installiere die aktuelle Veröffentlichung erneut.",
  ],
  "review.none_due": [
    "Nothing is due for review right now.",
    "Gerade ist nichts zum Wiederholen fällig.",
  ],
};
export function useErrorMessage() {
  const { language } = useI18n();
  return (error: unknown) => {
    const key = error instanceof Error ? error.message : "";
    return (
      errors[key]?.[language === "de" ? 1 : 0] ??
      (language === "de"
        ? "Diese Aktion konnte nicht abgeschlossen werden. Versuche es erneut."
        : "This action could not finish. Please try again.")
    );
  };
}
