# Authoring a curriculum

Open `content/foundation` in **Fluenta Studio** or edit it in a normal Git checkout.
Studio can edit lesson JSON, search English/German translation slots, validate all
references and policies, and preview the actual learner renderer and Rust grading.
Files are saved atomically with an expected-content hash to detect another editor's
changes. A conflicting or invalid save keeps the draft on screen.

```text
content/foundation/
  shared/a1/course.json
  shared/a1/grammar/01-identities.json
  shared/a1/lessons/01-identities.json
  shared/a1/assessments/checkpoint.json
  shared/a2/...
  shared/b1/...
  shared/b2/...
  locales/en.json
  locales/de.json
```

A course file owns its units and their ordered lesson/objective references. A lesson
fragment groups its lesson, activities, objectives, materials, speech, vocabulary and
rubrics. Grammar files own the reference explanations and grammar-course metadata;
lessons point to those materials by stable IDs. Assessment fragments hold separate tasks. This keeps a reviewer from navigating
one file per sentence while avoiding an entire textbook in one file.

## What an author stores

| Record | Contents |
|---|---|
| Course / unit / lesson | Stable identity and revision, title, ordering, band, estimated duration, references |
| Objective | Can-do description, skill, prerequisites and explanatory references |
| Activity | Instruction, objective refs, authored skill/use, task, accepted answers, feedback, hints |
| Material | Restricted text blocks, headings, examples, lists, reference links and audio references |
| Grammar topic | Stable identity, localized title/summary, editorial order, optional display group, ordered explanations and linked practice lessons; internal band/category metadata |
| Speech | Spanish text, optional pronunciation override and stable voice/cache identity |
| Vocabulary | Lemma, part of speech, gloss, examples and a source-language review scope where needed |
| Rubric | Review criteria and linked model answers |
| Assessment | Ordered held-out activities, time budget and listening replay allowance |

A source teaching string is `{"slot":"es.a1.identities.guide"}`. The corresponding
English and German entries may teach the same Spanish point differently. Spanish
examples and answer keys live in shared source, not duplicated translation dictionaries.
App chrome such as “Settings” lives in app localization, not the curriculum.

The Grammar tab follows an editorial topic order, with no level filter or CEFR badges.
The present-tense group contains regular, stem-changing and irregular verbs. Other core
topics are ser/estar, hay, perfecto, indefinido, imperfecto, subjuntivo and pronouns.
Seven further topics remain available below them. Search covers titles, summaries and
group names. Each course separates its explanation from its exercise list.

The ten core topics each have two new ten-activity lessons. The first starts with eight
single-choice activities about meaning and form, then two written forms. The second uses
an original school text with three comprehension questions, four written forms, sentence
ordering, a separate listening passage and a longer writing task with a specific rubric
and model answer. Multiple-choice positions vary; answer keys and explanations are authored.
English and German share all Spanish content. General Learn exposes these same lessons.

Adding a course means adding a `grammar/*.json`
fragment and its English/German slots, then validating in Studio. Explanations must refer
to public reference materials and practice links must resolve to real lessons in the pack.
There is no duplicate progress track: Grammar's practice buttons use the same lessons and
completion history as Learn, mixing grammar with vocabulary, listening and writing.

The lesson question-mark button follows the current activity's objectives to their
authored explanations in that session's pinned course release. It does not use AI or
guess from keywords. Opening it preserves the draft and counts as assistance for that
answer. Timed checkpoints reject grammar access in Rust, including direct IPC calls.

Implemented tasks are explanation, single choice, ordering, short answer, writing and
speaking. A listening activity uses an authored speech segment in its visible materials.
Speaking has a writing alternative. Short-answer policy explicitly controls typing,
voice input, accepted variants and accent/case/punctuation normalization. An ASR result
such as `a las 7` needs an authored numeric variant when it means `a las siete`.

Rich text is a closed tree, not executable Markdown or HTML. Schema 2 adds
semantic tables with a localized caption, 2–12 column headers and 1–100 complete rows.
The first cell in each row is a row header. Cells use the same language-tagged Text
values as paragraphs; captions/teaching labels live in the English/German locale files
and Spanish conjugations stay in shared source. Tables are searchable and rendered
identically in lessons, reference and Studio. Older schema 1 packs still open; older
apps reject schema 2 packs. Images are not currently supported.
Schema 3 adds explicit grammar `order` and optional localized `group` metadata.
Versions 1 and 2 still load; apps predating schema 3 reject the new packs.
There is no hidden “accept any answer” fallback for a task the evaluator does not know.

## Identity and revisions

Use globally namespaced IDs such as `es.a2.past-events.recall`; never use filenames or
translated labels as identity. Each reference pins a positive integer revision. Keep a
concept's ID stable; increment its revision when published meaning, accepted answers,
rubric or teaching text changes. Update referencing records and their revisions as needed.
Do not silently rewrite an already published `(ID, revision, teaching language)` tuple.

Unpublished drafts can be edited before the initial release baseline is established.
After publication the importer compares old and new records and rejects changed payloads
with unchanged revisions. Do not remove old learner-installed packs to force an update:
they are the source of truth for unfinished sessions and existing attempts.

## Review and publish

```sh
npm run content:build
cargo test -p fluenta-content
npm run studio:dev
```

Compiler checks include unique IDs, closed references, reference kinds, English/German
slot coverage, language boundaries, objective prerequisite cycles, answer policy,
speaking alternatives, material/rubric limits and assessment separation. Output goes to
`apps/desktop/src-tauri/resources/courses/`; source stays in Git. Structural validation is
not linguistic or pedagogical review.

Before publishing, a language reviewer checks both teaching layers, accepted variants,
Spanish accents, listening output, distractors, feedback and evidence policies. Longer
tasks need useful original source texts and a rubric that matches the instruction.
Time each lesson with a learner and review keyboard/speaking alternatives. Use a Git pull
request with the changed source, review evidence and generated release report.

The current foundation consists of introductions, classroom agreement, timetables,
reflexive routines, completed past events, past background, plans, preferences,
summarising, subjunctive, mediation, digital life, text analysis, argumentation,
perspective comparison and purposeful writing. These are a connected foundation and
examples for extending the system, not an Abitur-specific syllabus or complete CEFR course.

The expanded grammar material uses original school examples. Reference checks used the
[RAE conjugation models](https://www.rae.es/dpd/ayuda/modelos-de-conjugacion-verbal),
[haber](https://www.rae.es/dpd/haber) and
[object pronouns](https://www.rae.es/dpd/pronombres%20personales%20%C3%A1tonos).
Perfecto exercises specify the requested form rather than marking regional uses of
indefinido with “hoy” automatically wrong. Ser/estar is not taught as a permanent/temporary
binary, and subjuntivo is identified as a mood. Human linguistic review is still required
before representing this draft as a complete curriculum.

Publish signed `.fluentacourse` archives using [the release procedure](releases.md).
No authoring server or PostgreSQL instance is needed. Studio edits files; Git carries
history and review; the compiler publishes immutable SQLite data.

## Connected missions

Schema 4 adds topics, lexical occurrences, mission metadata and cross-course grammar-topic links. See [connected learning](connected-learning.md) for the shipped library, annotation format, assessment boundaries and authoring rules. Mission fragments live under `shared/b2/missions`; difficulty belongs to each mission, independently of its topic and storage pack.
