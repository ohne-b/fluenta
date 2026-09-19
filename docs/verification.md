# Verification record

Version 0.0.1 is the first GitHub release. The higher numbers below identify earlier
local development builds, not published releases. The release workflow separately
checks native speech on Windows, Linux, Intel Mac, and Apple Silicon before packaging.

For 0.0.1, both UI builds, the Rust workspace tests, Clippy, and release-manifest tests
pass locally. Eight native Windows learner tests pass with external traffic blocked,
including Piper playback, actual local tutor replies, vocabulary persistence, drafts,
assistance restrictions, compact layouts, and the light-mode Settings overlay. Studio
and the separately configured updater test are not part of that eight-test run.

For 0.4.3, Windows caption buttons use the system Segoe Fluent Icons font, with
Segoe MDL2 Assets as the Windows 10 fallback. Other platforms retain the existing
MDI fallback. Native checks confirm maximize/restore changes the glyph, closing
preserves a lesson draft, and the Settings overlay covers the header in light mode.
The light Settings view and caption symbols were visually inspected in WebView2.
`npm run check` passes, including both UI builds, 37 Rust tests and Clippy.
Studio's native editing/compilation/preview check also passes against its optimized
0.4.3 binary.

For 0.4.2, `npm run check` passes. Eight native learner tests pass with external
traffic blocked, including real Piper playback, the local tutor and draft recovery.
The new regression covers course-level recommendations, independently expanded
course sections, page scroll reset, keyboard skip navigation, and preventing reference
search from opening over Settings. It also checks immediate daily recommendations
after changing the starting level, plus access to every sidebar destination at
600 × 500 in both themes. Vocabulary tests cover whitespace/case-insensitive search
and clearing filters from an empty result. The compact layouts and course spacing
were visually inspected in WebView2. Grammar content and native inference are unchanged.
The ninth native test passes against the optimized 0.4.2 Studio binary, covering
editing, bilingual compilation, preview grading and the unsaved-file update guard.

For 0.4.1, `npm run check` passes. Native UI checks cover the continuous sidebar
edge, higher branding, the GitHub link above Settings, consistent grammar list
alignment and 4 px corners, removed daily-goal controls, shorter model settings,
and silent draft saving across a restart. Text-field geometry and focus behavior
are unchanged. Seven learner/connected tests pass with network access blocked,
Piper playback and the local tutor enabled. The tests also check 12 px spacing
between foundation courses, MDI SVG window controls, and the tutor's text-free
progress indicator. The learner uses a separate QA identifier and temporary
profiles because the personal installed app is open; its data is untouched.
The separate Studio test also passes against the staged 0.4.1 production binary,
including content compilation, preview grading and the unsaved-editor update guard.
Test output now stays in `.cache/test-results` and `.cache/playwright-report`.

Measured on Windows, Ryzen 7 7800X3D, approximately 16 GB RAM. Initial performance
measurements were made on 14 September 2026; branding and release checks were updated
on 19 September 2026.
Native inference used six CPU threads. These are measurements on this machine, not
promises for a school laptop or other operating system.

## Application checks

`npm run check` passes: generated TypeScript drift checking, learner and Studio
production UI builds, 37 Rust tests, a release-manifest check, and Clippy for all workspace targets/features with
warnings denied. Tests cover answer policies, projections, revisions, archive integrity,
pagination, current-step assistance, clock/evidence rules, idempotent commits, drafts, checkpoint restrictions,
speaking alternatives, backups, damaged-database recovery and worker cancellation.

The 0.4 connected-learning checks add meaning-based vocabulary enrolment and deduplication,
restart persistence, shared FSRS memory across contexts, assistance recording, bounded
daily review and backlog handling. They exercise version-1 database and backup migration,
first/revised writing and recording records, notebook restoration, and native checkpoint
restrictions. Bilingual content checks cover 13 missions, 60 lexical meanings, annotation
ranges, existing grammar references, held-out sources, image/source-text blocks, and
agreement between writing instructions, submission limits and complete model lengths.

The new native suite covers a complete migration chapter, keyboard vocabulary popovers,
synthetic audio, saving expressions, recall, a writing draft across an app restart,
rubric self-review, revisions, personal notes and the source-linked notebook. Direct
IPC calls check that rehearsal blocks vocabulary, private models and external-source
help. Small-window rendering includes the original chart and its accessible table.
The suite also checks visible keyboard focus and German lookup translations in dark
mode at 620 px. The rendered Today, Topics, My Words, notebook, reading/popover,
revision, Abitur and chart views were visually inspected in the native app.

The speech pipeline was rerun for 0.4: cached Piper synthesis, WAV decoding/resampling
and whisper.cpp returned “Hoy tengo clase de español a las 9.” in 1.99 seconds of
recognition on this machine. The recording revision test uses registered recording
records; it does not exercise a physical microphone or assess pronunciation.

The Windows native UI suite passes seven learner tests with the optional model enabled:

- Finish a six-task lesson, maximize/restore the custom window, close it through its new
  titlebar, restart, and recover the draft. Open contextual grammar help without losing
  a typed answer.
- Browse/search 17 grammar courses in editorial topic order, open their conjugation tables and linked lessons,
  then search/bookmark references. Apply Light/Dark/System immediately, follow OS appearance
  changes and persist Light across a restart without saving pending language edits.
  Then save German settings and render dark mode at 600 px without horizontal overflow.
- Enforce checkpoint restrictions by calling Rust directly: reference search, grammar
  listing and contextual grammar access are denied.
- Complete a new ten-activity grammar lesson, including eight guided choices and two
  written forms; reopen its completion state and start the longer reading lesson.
- Produce actual local tutor responses, including a follow-up tense explanation in German
  with authored course references, cancel another turn, restart, and recover the
  stored conversation. Click and send all three presets, checking their modes and German
  explanations as well as successful replies.
  Delay the real worker's start acknowledgement to check that an immediate Stop is retained.

For 0.4.0, all seven tests also pass against the optimized production learner binary
staged with its bundled resources, without a development server. Studio's production
test passes separately. The app was launched with isolated data directories; the
personal installed copy and its progress were not replaced. All 1,584 bundled learner
resource hashes match the prepared manifest.

The separate updater test passed on 0.2.0: discover an update through a local test feed,
save pending settings and reject a deliberately altered download with the native error
`The signature verification failed`. The app remains usable. Production configuration
uses HTTPS on GitHub; the local HTTP override exists only in the isolated QA build.

Studio's separate test edits a translation file in an isolated curriculum checkout,
saves it, compiles eight packs, previews a selected lesson and checks native grading.
It also verifies that unsaved Studio files block installation of an app update.
It passes against the 0.4.0 production Studio binary with bundled resources and external
traffic blocked; it is intentionally skipped for learner binaries. The curriculum is
copied to an isolated workspace before editing.

The app uses the original transparent logo SVG; generated native icons
come from that same source. Onboarding, Learn, Tutor, dark mode and the 600 px layout
were visually inspected in the native app. Nine core text/background pairs were checked
in each theme: the lowest contrast is 4.66:1 in light mode and 6.16:1 in dark mode.
These token checks are not a complete accessibility audit.

The 0.3.1 UI removes the separate navigation toolbar, aligns reference search with
page headings, uses Windows caption glyphs, and applies 4 px field corners with
border-only focus feedback. Native checks cover heading/search alignment, window
controls, draft recovery without a saved-status message, and both themes at 600 px.

The installed 0.3.0 tutor failure was reproduced with “Hola”: `llama-completion`
prepended ANSI color escapes to otherwise valid JSON. Explicit `--color off` and
`--log-colors off` fix the worker output. The native test harness now clears the
test runner's color environment variables to match an Explorer launch. All five
learner tests pass with the real local model, including “Hola”, the three presets,
German explanations, cancellation and conversation recovery.

The 0.3.0 learner UI was checked in a separate `org.fluenta.qa` debug build. All five learner tests passed, including native Piper and the
optional tutor. Focused dropdowns, reference search and lesson text fields reported no
outline or shadow in WebView2. The custom scrollbar measured 7 px, had no arrow buttons,
and scrolled the settings dialog normally. Bundled flag SVGs loaded without network
requests; onboarding and both themes were visually checked again.
Studio's 0.3.0 production UI build and shared Rust checks pass.
The five learner checks also passed with the production frontend embedded in the
native binary, without Vite or an internet connection, including both tutor turns.

The 0.3.0 content checks cover the topic tree, the first eight choices in each new
introductory lesson, at least ten activities per new lesson, bilingual table round-trips,
schema compatibility, linked explanations and relevant retrieval for indefinido/imperfecto.
Content revisions propagate through referencing records so unfinished older sessions retain
their original teaching material. The current foundation has 36 lessons, four checkpoints
and 320 activities per teaching language. These checks do not replace teacher review.

Tutor output now constrains citations to supplied IDs, bounds response fields, requires
explanations in explanation/feedback modes and retains them in conversation history.
Manual probes used the installed model and runtime as well as the development build.
The reported preset error maps to `tutor.invalid_response`. That exact rejection was not
reproduced in the local baseline probes; wrong context, wrong-language explanations and
incorrect preset modes were reproduced and addressed. Presets now select their mode and
use localized explanation requests. A local language detector identifies confidently
wrong-language explanations; one local translation pass repairs that field while keeping
the Spanish reply and citations intact. Both passes share cancellation and the four-minute
deadline. Language detection and model accuracy remain imperfect.

```powershell
# Development learner
$env:TAURI_CONFIG='{"identifier":"org.fluenta.qa","productName":"Fluenta QA"}'
cargo build -p fluenta-desktop
Remove-Item Env:TAURI_CONFIG
$env:FLUENTA_TUTOR_TEST=(Resolve-Path '.cache/evaluation/gemma-4-E2B-it-Q4_K_M.gguf').Path
npm run test:e2e

# Studio: use a separate invocation
npm run tauri -w @fluenta/desktop -- build --debug --no-bundle --features studio --config src-tauri/tauri.studio.conf.json
$env:FLUENTA_STUDIO_TEST='1'
$env:FLUENTA_TEST_EXE=(Resolve-Path 'target/debug/fluenta.exe').Path
npx playwright test studio.spec.ts
```

The suite never downloads a model implicitly. Omit `FLUENTA_TUTOR_TEST` to check the
standard app alone. Use separate PowerShell sessions or remove the environment variables
when switching targets. Profiles live in ignored `.cache/desktop-test-*` directories.

## Content compatibility

Grammar explanations and conjugation tables are validated in both teaching languages.
The compiler checks table dimensions, grammar/reference kinds and practice links; the
round-trip test resolves each linked lesson back to its canonical explanations. Existing
record meanings were compared against the 0.2.0 local packs: **452 unchanged entity
revisions matched**. Grammar and lesson content changes use new revisions; previous
learner-installed packs remain available to their saved sessions.

Expanded content exposed a float-rounding problem in ranked search cursors. Enabling
serde_json's exact float round trips fixed duplicate pages; the existing pagination test
now also asserts bit-exact rank preservation.

## Packaged Windows build

Both Windows installers were rebuilt for 0.4.0. Their prepared bundle contains
the current courses, runtimes, models, MDI, Manrope and flag attribution. SHA-256
digests are recorded beside the artifacts. The matching
source archive includes the SVGs, licenses and updated UI tests; its Cargo vendor path
is relative. The currently installed personal copy was not replaced during these checks.

For 0.2.0, both NSIS installers were silently installed into isolated workspace
folders. All **1,548 installed resource hashes** matched their manifests. App-specific
installed learner files measured **378.9 MB** on a machine that already had WebView2.
Shared WebView2 storage is additional on a clean PC. The optional GGUF adds
**3,106,738,272 bytes**, plus working memory and temporary data. Both temporary
installations were uninstalled cleanly without leaving registered apps or shortcuts.

Those installed releases passed all four learner tests and the Studio authoring/preview
test, including real Piper playback. External web traffic was blocked in the WebView and native HTTP
was directed at an unavailable proxy; the virtual Tauri IPC transport remained available.
This checks offline application paths without altering the computer's network/firewall.
It is not a clean-VM test of Microsoft's WebView2 installation branch.

```powershell
$env:FLUENTA_TEST_EXE='C:/path/to/installed/Fluenta/fluenta.exe'
$env:FLUENTA_TEST_OFFLINE='1'
$env:FLUENTA_TEST_AUDIO='1'
$env:FLUENTA_TUTOR_TEST=(Resolve-Path '.cache/evaluation/gemma-4-E2B-it-Q4_K_M.gguf').Path
npm run test:e2e
```

Chromium's global offline emulation also disables virtual HTTP schemes used by Tauri IPC,
so the test blocks external requests specifically. No development server supplies the
installed app's UI, and no cloud speech or model API is involved.

## Content and speech

The reproducible benchmark compiles the foundation plus **50,000 extra reference
materials** into a **25.8 MiB** SQLite pack. Latest optimized results:

| Operation | Elapsed |
|---|---:|
| Compile | 1.03 s |
| Open catalog metadata | 0.63 ms |
| Indexed search, 20 results | 45.84 ms |
| Read compiled unit overview | 0.38 ms |

```sh
cargo run --release -p fluenta-content --example benchmark_catalog
cargo run -p fluenta-speech --example verify_speech
```

Piper → finalized WAV → resampling → whisper.cpp completed with Spanish text preserved.
The latest recorded recognition took 2.32 s for the short synthetic sample. A previous
cold Piper generation took about 1.0 s; cached audio lookup is much faster. This does not
measure learner accents, microphone quality, disconnection, room noise or pronunciation
accuracy. Those require learner trials and physical-device checks.

## Tutor evidence and remaining gates

The six 0.3.0 production-runtime smoke cases all produced valid response shapes in the intended
explanation language, with a median **6.25 s** per turn. A language repair adds another
inference pass when triggered. Raw results and human review
criteria are in [the tutor evaluation](../evals/tutor/README.md). Shape/language compliance
is not teaching accuracy. The plural case omitted the requested subject/agreement explanation,
and the conversation drifted from history to music. Generated responses do not control
grading or progress; shape compliance is not a guarantee of teaching quality.

Before a public supported release, complete teacher review and wider curriculum coverage,
learner speech trials, microphone permission/unplug tests, a clean Windows VM test,
platform signing/notarization and Linux/macOS hardware runs. GitHub workflows are present
but have not run in a configured remote repository. The signed updater is implemented for `ohne-b/fluenta`; live GitHub release publication
and the CI signing secret remain publisher setup. GPU offload and a general-purpose media asset manager are not implemented release
features. Mission PNG/WAV blocks are supported; delivered listening remains synthetic.
