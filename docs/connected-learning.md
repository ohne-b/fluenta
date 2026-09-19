# Connected learning

Fluenta 0.4 connects an authored passage to saved expressions, FSRS recall and a
purposeful response. It uses the existing Rust evaluator, SQLite store, speech
workers and optional tutor. No service or account is needed.

## Delivered library

The library contains 13 complete missions in English–Spanish and German–Spanish.
Migration has six connected chapters: Llegar; ¿Por qué nos vamos?; Entre dos lugares;
Lo que cuentan los medios; Encontrar soluciones; Tu perspectiva. The module introduces
60 lexical meanings, including gender, required prepositions and expressions such as
*echar de menos*, *tener en cuenta* and *hacer frente a*. Other missions reuse these
meanings in new contexts. Each of the seven other collections has one complete
introductory mission, with a separate unseen challenge. Foundation lessons and grammar
courses remain available.

| Editorial collection | Introductory mission | Main work |
|---|---|---|
| Migration and belonging | Six-chapter sequence | Arrival, motives, belonging, media, proposals, independent response |
| Spain: dictatorship, democracy and memory | Una plaza, varias memorias | Historical context, evidence and public memory |
| Latin America: countries and history | Chile: escuchar sin generalizar | A specific Chilean case and limits of generalisation |
| Language and identity | Dos lenguas, muchas voces | Bilingual experience and participation |
| Society, young people and media | Antes de publicar | Audience, consent and a reasoned publishing decision |
| Economy, environment and sustainability | Una calle para todos | An original chart, costs, accessibility and evaluation |
| Spain and the wider world | Un intercambio con sentido | European cooperation and German-to-Spanish mediation |
| Literature, film and art | La silla junto a la puerta | Original short fiction, perspective, symbolism and alternative interpretations |

These are editorial groupings, not official syllabus titles. The advanced reference is
[Bayern's continued Spanish, erhöhtes Anforderungsniveau, years 12–13](https://www.lehrplanplus.bayern.de/fachlehrplan/gymnasium/12/spanisch/erhoeht).
Its themes support these connections; its communication requirements include analysis,
argument, mediation and engagement with different kinds of texts. This starter library
does **not** supply all required literary works or claim complete syllabus coverage.
The [Baden-Württemberg guiding curriculum](https://www.bildungsplaene-bw.de/,Lde/BP2016BW_ALLG_GYM_SPA3_LG)
also connects communication, intercultural understanding and language learning. It is
not an implemented state-specific exam profile.

[ISB illustrative tasks](https://www.isb.bayern.de/schularten/gymnasium/faecher/spanisch/illustrierende-pruefungsaufgaben/)
and its [June 2025 overview](https://www.isb.bayern.de/fileadmin/user_upload/Gymnasium/IlluPA/S/IlluPA_Spanisch_Uebersichtsblatt_06_25.pdf)
describe the Bayern written eA format from 2026: 30 minutes listening and 285 minutes
writing/mediation. Fluenta's 20–30 minute challenges are editorial practice tasks, not
that complete exam. No exact additional state/year profile or proficiency certification
is offered. Demanding reading is not treated as evidence of equally advanced production.

Factual sources and check dates are stored with each mission. Classroom scenarios,
dialogues, literature and chart data are original and explicitly fictional/illustrative;
factual introductions are identified separately. Speech is synthetic. Copyrighted ISB
exam passages or recordings have not been bundled. Authoring and consistency checks
are not an independent expert linguistic review or a learner-efficacy study.

## Data and boundaries

- `crates/contracts/src/connected.rs` defines topics, missions, occurrences, word views,
  notebook entries and revisions. Content schema 4 adds these to existing packs.
- `content/foundation/shared/b2/missions/` contains one editable fragment per mission,
  a collection index, lexical meanings, occurrences and reusable word practice. A
  mission's entry difficulty is independent of this packaging location and its topic.
- A Spanish `Text` has authored, non-overlapping Unicode-scalar annotation offsets.
  They point to occurrence IDs; occurrences point to stable lexical meaning IDs.
  Translation, sentence, surface form and speech are authored data, not runtime
  substring matching or model inference. A second meaning needs a different ID even
  when its lemma is identical. Inflected forms share an appropriate meaning ID.
- Teaching strings may use existing translation slots or adjacent `{de, en}` strings.
  Compilation resolves both to the existing `Text` contract. Mission objectives link
  existing grammar topic IDs; grammar explanations are not copied into missions.
- The compiler checks range/surface agreement, reference kinds, both teaching languages,
  lexical practice targets and held-out challenge sources. Signed course releases and
  stable revision checks continue to apply. Change a published record's revision when
  changing its meaning or content.
- PNG and WAV blocks accept bounded byte payloads, not executable markup or file paths.
  German mediation excerpts have an explicit source-text block. Timed listening uses
  native speech-segment replay controls. The compiler and native session layer reject
  raw recorded-audio blocks in any checkpoint until controlled replay is implemented.

The native layer authorises every lookup and audio request. An active checkpoint
blocks reference, vocabulary, notebook and tutor help globally, including IPC calls
without a session context. Private models and unseen passages cannot be fetched by
guessing their IDs. Feedback becomes available after the appropriate submission or
completed checkpoint. Looking up a translation during an answer marks assistance;
hover never creates a study item. Deliberate opening records an encounter, and saving
enrols the meaning. Repeated saves add source contexts rather than duplicate meanings.

SQLite migration 2 retains existing sessions, attempts and activity reviews. New word
state is keyed by meaning and teaching language; learner notes and occurrence contexts
are stored locally. A lexical FSRS review has one memory across its authored contexts.
Typed recall, assisted recall, choice understanding, recognised speech and production
attempts remain distinct. Explicit expression-use tasks can record a productive
attempt; a general essay does not credit every word from its chapter. Spelling is not
inferred from speech recognition, and a production attempt does not prove successful reuse. Hovering, saving and multiple
choice do not establish mastery.

The existing portable backup includes the new SQLite tables and recordings. Old
version-1 databases and backups migrate on opening/restoring. First production answers
are immutable attempts; revisions are separate records. Rubric judgements are explicit
self-review with `met`, `developing` or `not_assessed`, never automatic grades.
Optional AI remains supplementary and cannot write FSRS state or grades.

## Daily flow and support

Today prioritises a resumable session, suitable entry difficulty, chosen interests and
unfinished chapters. A1 learners are offered existing foundations. Review batches are
bounded to three items for short goals and six for longer goals. Guided missions can
include one to three due lexical recalls before their input when they share the pack.
A backlog reduces the suggested number of new saved expressions to zero; it does not
erase overdue reviews. The learner can pause a longer chapter and resume its exact step
and draft.

Learn includes a preparation step. Independent practice skips that preparation and
records requested help. Rehearsal uses a separate source, a running timer, blocked aids
and feedback afterwards. Reopening a challenge is marked as previously seen. Completed
unseen work is reported as submitted, self-reviewed work, not a score or certification.

My Words separates active, recent, paused and archived meanings. Practice contains
general Abitur tasks and a history of first/revised production. The notebook keeps
arguments with source references and a counterargument field. Mission help opens
beside the current answer without clearing drafts. The optional tutor remains available
contextually and through the sidebar.

## Validation

`crates/storage/tests/connected.rs` exercises lookup/enrolment, deduplication, restarts,
backup/restore, version-1 migration, shared FSRS memory, assistance, mission resumption,
unseen restrictions and original/revised responses. `crates/content/tests/connected.rs`
checks the complete bilingual library, grammar links, source/media support, broken
annotations, wrong references and exposed assessments.

`tests/desktop/connected.spec.ts` drives the actual Windows WebView and native IPC through
reading, keyboard popovers, saving, recall, draft restart, self-review, revision,
notes, checkpoint restrictions and responsive visual-source rendering. Set
`FLUENTA_TEST_AUDIO=1` to exercise vocabulary speech playback. Platform and manual
verification limits are recorded in [verification.md](verification.md).
