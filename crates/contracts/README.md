# Fluenta contracts

Rust is the authority for curriculum and native/UI values. `src/lib.rs` defines the
content and protocol; `src/app.rs` defines application views and Studio requests.
This crate contains no database, Tauri dependency, speech engine or inference runtime.

From the repository root:

```sh
npm run contracts
cargo test -p fluenta-contracts
node scripts/contracts.mjs --check
```

Commit generated JSON Schemas under `schema/` and generated TypeScript under
`packages/contracts/src/` alongside the Rust change. Tests check schema drift,
unknown-field rejection, policy restrictions, bilingual reference closure and the
answer-free frontend projection. `crates/content` adds compiler graph validation.

`ContentRef` is a stable validated ID and positive revision. IDs are not paths.
Release identity, source language, entity revision, session version and mutation nonce
serve separate purposes. A client cannot submit an authoritative score or evidence type.

`Activity` owns grading policy; `ActivityView` exposes only what the step may display.
`MutationContext` binds an answer to its session, step and version. `SessionSnapshot`
is persisted state, not a frontend-derived progress estimate. Long-running work uses
operation events with cancellation and replay cursors.

The two `fixtures/unit.*.json` files are resolved examples for contract tests.
Editable curriculum lives in `content/foundation`, with shared Spanish and translation
slots. Do not expand contract fixtures into the production authoring system.

See [architecture](../../docs/architecture.md) and [authoring](../../docs/content.md)
for implemented ownership, persistence and extension rules.
