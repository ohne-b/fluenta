# Releases

The **Release** workflow builds Windows x64, Linux x64, and universal macOS downloads. It uploads to an existing draft release after native tests, package smoke checks, filename validation, and updater-feed assembly succeed. Publishing the draft is a separate step.

## Publish

1. Update the version in the root and workspace `package.json` files, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`. Update `CHANGELOG.md`.
2. Run `npm run check`, prepare resources, and exercise the desktop app. Commit the release with a conventional commit.
3. Push a matching tag, for example `v0.0.1`, and create its draft GitHub release.
4. Run **Release** with that tag. The workflow checks out the tag, not the moving default branch.
5. Review the nine uploaded assets, verify checksums, and publish the draft as the latest stable release.

Keep `TAURI_SIGNING_PRIVATE_KEY` in repository secrets. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only when the key is password-protected. Back up the private key separately; losing it prevents updates to existing installations. Public keys are in `config/`; private keys never belong in Git or release archives.

## Download names

```text
Fluenta-0.0.1-windows-x64.exe
Fluenta-0.0.1-windows-x64-setup.exe
Fluenta-0.0.1-linux-x64.AppImage
Fluenta-0.0.1-linux-x64.deb
Fluenta-0.0.1-macos.dmg
Fluenta-0.0.1-macos-universal.app.tar.gz
Fluenta-0.0.1-source.zip
SHA256SUMS.txt
latest.json
```

This follows ohneguessr's platform naming and formats, with an additional corresponding-source ZIP for the GPL components. The source archive contains Fluenta, locked Rust dependency sources, Piper, and its pinned eSpeak NG source. npm dependencies remain locked; building from source can require network access.

Windows Setup includes the offline WebView2 installer. The portable EXE extracts into a temporary directory, runs without installing, and preserves progress in the normal application profile; WebView2 must already be installed. Linux targets Ubuntu 24.04. macOS targets version 15 or later, matching the native build hosts. Its app contains a universal main executable and separate native speech/runtime directories selected by the running architecture.

Windows Authenticode signing and Apple notarization are not configured. macOS receives an ad-hoc signature. Tauri updater signatures verify update payloads; they do not replace platform code-signing identities.

## Local builds

```sh
npm ci
npm run content:build
python scripts/prepare-runtime.py
python scripts/prepare-notices.py
npm run check
cargo run -p fluenta-speech --example verify_speech
npm run release -- --key-file .cache/signing/updater.key
```

Outputs go to `artifacts/release/`. Windows also creates the corresponding-source ZIP. The release workflow merges the platform feed fragments into `latest.json` and hashes the final files. For universal macOS, prepare both architecture-specific runtime sets as shown in the workflow before calling the packaging script.

Unsigned development packages use `npm run desktop:build`. Studio remains a separate development tool (`npm run studio:dev`, `npm run studio:build`); the learner release does not publish Studio updates.

## Runtime sources

| Component | Version / artifact |
| --- | --- |
| Piper | 1.8.0, C++ library and CLI |
| eSpeak NG | `212928b394a96e8fd2096616bfd54e17845c48f6` |
| ONNX Runtime | 1.22.0 |
| whisper.cpp | Windows b5130; source build 1.9.4 on Linux/macOS |
| Whisper Small | `ggml-small-q5_1.bin` |
| Spanish voice | `es_ES-davefx-medium.onnx` |
| llama.cpp | b10956, platform-specific runtime |
| Optional tutor | Gemma 4 E2B Q4_K_M, 3,106,738,272 bytes |

`scripts/prepare-runtime.py` contains the pinned URLs and hashes. `prepare-notices.py` collects licenses and refreshes the resource inventory. The tutor model is downloaded separately in the app; it is not in the installer. Current inference is CPU-only with six threads.

## Updates

The learner checks `https://github.com/ohne-b/fluenta/releases/latest/download/latest.json`. The repository and release must be public for unauthenticated checks. `latest.json` maps Windows to Setup, Linux to AppImage, and both Mac architectures to the universal app archive. Each payload carries a Tauri signature checked before installation. Portable Windows and DEB users should replace their download manually; the Windows in-app updater installs the Setup edition.

Version 0.0.1 is the first GitHub release. Earlier local development builds used higher version numbers and need a manual installation of 0.0.1; automatic updates do not downgrade versions. The Windows installer permits that manual transition and keeps the learner profile.

## Course releases

Courses can ship separately as signed `.fluentacourse` files:

```sh
cargo run -p fluenta-content --bin content-release -- publish apps/desktop/src-tauri/resources/courses artifacts/foundation-1.fluentacourse 1 .cache/signing/content.key
cargo run -p fluenta-content --bin content-release -- verify artifacts/foundation-1.fluentacourse config/content-public-key.txt
```

The content key is separate from the updater key. Increase the release sequence monotonically and include only packs selected by `active-releases.json`. Learners import files in Settings. Each archive supports up to 32 packs, 256 MiB per pack, and 1 GiB total; old session packs remain available locally.

For a fork, generate new key pairs before publishing its first app. Changing the trusted public keys after release requires an application update.
