# Local data, backups and privacy

Fluenta has no account, telemetry endpoint, cloud database or paid inference service.
Its optional tutor download is an ordinary HTTPS request to a pinned Hugging Face URL;
the downloader checks byte count and SHA-256, supports resume and allows cancellation.
Conversations, learner answers and audio are not sent in that request. There is no
background course/app update polling or embedding search service. **Settings → App
updates** explicitly checks GitHub and, when requested, downloads a signed installer.
No learner content is included; GitHub receives normal request metadata such as the
IP address. Tauri verifies the update before launching the Windows installer.
Opening a curriculum source link explicitly launches that HTTPS page in the system
browser. The learning content itself does not need the source website to be reachable.

WebView2, the operating system and third-party download hosts can have their own
network behavior. “Fluenta works offline” describes the application's installed learning
features; it does not disable Windows services or configure the user's firewall.

## Storage

The learner identifier is `org.fluenta.desktop`; Studio uses `org.fluenta.studio`.
Tauri chooses the platform application-data location. On Windows the default is under
`%APPDATA%/org.fluenta.desktop`. A development/test process can set `FLUENTA_DATA_DIR`
to an isolated directory. Do not point two running applications at the same override.

```text
app-data/
  learner/student.sqlite       progress, drafts, review history, preferences, conversations
  learner/courses/             immutable installed and pinned course packs
  learner/recordings/          saved open-speaking answers
  learner/snapshots/           up to seven healthy daily SQLite snapshots
  cache/speech/                synthesized audio; bounded cache
  models/                     optional model and its verification marker
  recovery.fluenta             portable backup created before a manual restore
```

Short voice-answer audio is temporary; its transcript and evidence may remain with the
attempt. Open-speaking answers are saved so the learner can replay and review them.
Tutor thread deletion removes that thread from the student database. Removing the
optional model leaves learning content and progress intact. Data is local, but is not
encrypted by Fluenta; use the operating system's account and disk protection on shared
computers. Daily snapshots can contain earlier copies of deleted conversations.

## Backup and restore

Settings can export a `.fluenta` archive containing a consistent SQLite snapshot,
course packs and saved recordings. Optional LLM weights and disposable TTS cache are
excluded. Keep an export on a separate drive or another location if you need protection
against device failure. A snapshot on the same disk cannot provide that protection.

Import validates a staged archive and asks before replacing progress. Current data is
first exported to `recovery.fluenta`. Files with conflicting immutable names are rejected.
The importer accepts at most 10,000 entries and 2 GiB uncompressed, with a 512 MiB
per-file limit. Large recording archives should be managed before reaching this ceiling.

At first launch each UTC day, Fluenta attempts an online SQLite snapshot, keeping seven
launch days. These snapshots use the course/recording files already present beside the
database. On a detected database error, the app offers the latest healthy snapshot and
preserves the original database and WAL in a `recovery-…` directory before replacement.
Recent progress can be missing from an older snapshot. Unsupported future database
versions are refused; never downgrade over a newer profile without an appropriate backup.
