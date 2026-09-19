use fluenta_content::{Catalog, reference};
use fluenta_contracts::*;
use fluenta_storage::{Store, new_id};
use rusqlite::Connection;
use std::{collections::BTreeMap, path::Path};

const NOW: i64 = 1_800_000_000_000;
fn setup() -> (tempfile::TempDir, Store, Catalog) {
    let root = tempfile::tempdir().unwrap();
    fluenta_content::compile_source(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation"),
        &root.path().join("courses"),
    )
    .unwrap();
    let catalog = Catalog::open(&root.path().join("courses")).unwrap();
    let store = Store::open(&root.path().join("learner")).unwrap();
    (root, store, catalog)
}
fn ctx(s: &SessionSnapshot) -> MutationContext {
    let SessionState::Active { step } = &s.session else {
        panic!("active")
    };
    MutationContext {
        session_id: s.session_id.clone(),
        step_id: step.step_id.clone(),
        expected_step_version: step.version,
    }
}
fn session(r: ConnectedResponse) -> SessionSnapshot {
    let ConnectedResponse::Session(s) = r else {
        panic!("session")
    };
    *s
}
fn word(r: ConnectedResponse) -> WordView {
    let ConnectedResponse::Word(w) = r else {
        panic!("word")
    };
    *w
}
fn words(s: &mut Store, c: &Catalog) -> Vec<WordView> {
    let ConnectedResponse::Words(w) = s.connected(c, ConnectedCommand::Words, NOW).unwrap() else {
        panic!("words")
    };
    w
}
fn occurrence(c: &Catalog, sense: &str, prefix: &str) -> Occurrence {
    let p = c.locate(SourceLanguage::En, &reference(sense)).unwrap();
    c.list::<Occurrence>(&p.release_id, "occurrence")
        .unwrap()
        .into_iter()
        .find(|o| o.sense.id.as_str() == sense && o.owner.id.as_str().starts_with(prefix))
        .unwrap()
}
fn learn(s: &mut Store, c: &Catalog, o: &Occurrence) {
    s.connected(
        c,
        ConnectedCommand::LearnWord {
            occurrence: o.content.clone(),
            context: None,
        },
        NOW,
    )
    .unwrap();
}
fn activity(c: &Catalog, s: &SessionSnapshot) -> Activity {
    let SessionState::Active { step } = &s.session else {
        panic!("active")
    };
    c.get(&s.release_id, &step.activity.content, "activity")
        .unwrap()
}
fn submit(s: &mut Store, c: &Catalog, snap: &SessionSnapshot, now: i64) -> SessionSnapshot {
    let a = activity(c, snap);
    let answer = match a.task {
        Task::Explanation { .. } => Answer::Acknowledged,
        Task::Choice { correct_ids, .. } => Answer::Choice {
            selected_ids: correct_ids,
        },
        Task::ShortAnswer { accepted, .. } => Answer::Typed {
            text: accepted[0].clone(),
        },
        Task::Writing { min_words, .. } => Answer::Writing {
            text: vec!["palabra"; min_words.max(65) as usize].join(" "),
        },
        _ => panic!("fixture task"),
    };
    s.submit(
        c,
        &SubmitAnswer {
            context: ctx(snap),
            submission_id: new_id(),
            answer,
        },
        now,
    )
    .unwrap()
}
fn complete(s: &mut Store, c: &Catalog, mut snap: SessionSnapshot, now: i64) -> SessionSnapshot {
    while matches!(snap.session, SessionState::Active { .. }) {
        snap = submit(s, c, &snap, now);
        snap = s.advance(&ctx(&snap), &new_id(), now).unwrap();
    }
    snap
}

#[test]
fn lookups_are_not_enrolment_saves_deduplicate_and_survive_restart_and_backup() {
    let (root, mut store, catalog) = setup();
    let first = occurrence(&catalog, "lex.echar", "mission.migration.1.reading");
    let second = occurrence(&catalog, "lex.echar", "mission.arts.1.reading");
    store
        .connected(
            &catalog,
            ConnectedCommand::Lookup {
                occurrence: first.content.clone(),
                context: None,
                opened: false,
            },
            NOW,
        )
        .unwrap();
    assert!(words(&mut store, &catalog).is_empty());
    let recent = word(
        store
            .connected(
                &catalog,
                ConnectedCommand::Lookup {
                    occurrence: first.content.clone(),
                    context: None,
                    opened: true,
                },
                NOW,
            )
            .unwrap(),
    );
    assert_eq!(recent.status, WordStatus::Recent);
    assert_eq!(recent.independent_recall, 0);
    learn(&mut store, &catalog, &first);
    learn(&mut store, &catalog, &second);
    learn(&mut store, &catalog, &first);
    store
        .connected(
            &catalog,
            ConnectedCommand::UpdateWord {
                sense: first.sense.clone(),
                status: WordStatus::Active,
                notes: "echar de menos a mi familia".into(),
            },
            NOW,
        )
        .unwrap();
    let backup = root.path().join("connected.sqlite");
    store.backup(&backup).unwrap();
    drop(store);
    let mut store = Store::open(&root.path().join("learner")).unwrap();
    let saved = words(&mut store, &catalog);
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].contexts.len(), 2);
    assert_eq!(saved[0].notes, "echar de menos a mi familia");
    assert_eq!(saved[0].independent_recall, 0);
    store
        .connected(
            &catalog,
            ConnectedCommand::UpdateWord {
                sense: first.sense,
                status: WordStatus::Archived,
                notes: String::new(),
            },
            NOW,
        )
        .unwrap();
    store.restore_database(&backup).unwrap();
    assert_eq!(words(&mut store, &catalog)[0].status, WordStatus::Active);
}

#[test]
fn lexical_fsrs_follows_meaning_across_contexts_and_records_assistance() {
    let (root, mut store, catalog) = setup();
    let o = occurrence(&catalog, "lex.echar", "mission.migration.1.reading");
    learn(&mut store, &catalog, &o);
    let first = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::ReviewWords {
                    sense: Some(o.sense.clone()),
                    production: false,
                },
                NOW,
            )
            .unwrap(),
    );
    let first_activity = activity(&catalog, &first);
    complete(&mut store, &catalog, first, NOW);
    assert_eq!(words(&mut store, &catalog)[0].independent_recall, 1);
    let later = NOW + 86_400_000;
    let second = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::ReviewWords {
                    sense: Some(o.sense.clone()),
                    production: false,
                },
                later,
            )
            .unwrap(),
    );
    assert_ne!(first_activity.content, activity(&catalog, &second).content);
    assert_ne!(
        first_activity.lexical[0].occurrence,
        activity(&catalog, &second).lexical[0].occurrence
    );
    // Omitting the mutation context is not a way to hide help from the evaluator.
    store
        .connected(
            &catalog,
            ConnectedCommand::Lookup {
                occurrence: o.content.clone(),
                context: None,
                opened: false,
            },
            later,
        )
        .unwrap();
    complete(&mut store, &catalog, second, later);
    let result = &words(&mut store, &catalog)[0];
    assert_eq!(result.independent_recall, 1);
    assert_eq!(result.assisted_recall, 1);
    let db = Connection::open(root.path().join("learner/student.sqlite")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM reviews WHERE sense_id='lex.echar'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM review_history", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        2
    );
    store
        .connected(
            &catalog,
            ConnectedCommand::UpdateWord {
                sense: o.sense,
                status: WordStatus::Paused,
                notes: String::new(),
            },
            later,
        )
        .unwrap();
    assert_eq!(
        store
            .daily_plan(&catalog, later + 100 * 86_400_000)
            .unwrap()
            .due,
        0
    );
}

#[test]
fn missions_preserve_drafts_outputs_revisions_and_reject_hidden_material() {
    let (root, mut store, catalog) = setup();
    let mission = reference("mission.migration.1");
    let snap = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::StartMission {
                    mission: mission.clone(),
                    support: SupportLevel::Independent,
                },
                NOW,
            )
            .unwrap(),
    );
    assert_eq!(snap.step_count.get(), 6); // independent practice omits the optional planning step
    assert!(
        store
            .reference(
                &catalog,
                SourceLanguage::En,
                &reference("mission.migration.1.unseen")
            )
            .is_err()
    );
    assert!(
        store
            .reference(
                &catalog,
                SourceLanguage::En,
                &reference("mission.migration.1.rubric.model")
            )
            .is_err()
    );
    let again = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::StartMission {
                    mission,
                    support: SupportLevel::Independent,
                },
                NOW,
            )
            .unwrap(),
    );
    assert_eq!(again.session_id, snap.session_id);
    let mut snap = snap;
    while !matches!(activity(&catalog, &snap).task, Task::Writing { .. }) {
        let marked = submit(&mut store, &catalog, &snap, NOW);
        snap = store.advance(&ctx(&marked), &new_id(), NOW).unwrap();
    }
    let draft = Answer::Writing {
        text: "Lucía necesita apoyo para conocer los horarios.".into(),
    };
    store.save_draft(&ctx(&snap), 1, &draft, NOW).unwrap();
    let id = snap.session_id.clone();
    drop(store);
    let mut store = Store::open(&root.path().join("learner")).unwrap();
    let resumed = store.resume(&id, NOW).unwrap();
    let SessionState::Active { step } = &resumed.session else {
        panic!("active")
    };
    assert!(matches!(&step.draft,Some(Answer::Writing{text}) if text.contains("horarios")));
    let done = complete(&mut store, &catalog, resumed, NOW);
    let ConnectedResponse::Recap(recap) = store
        .connected(
            &catalog,
            ConnectedCommand::Recap {
                session_id: done.session_id.clone(),
            },
            NOW,
        )
        .unwrap()
    else {
        panic!("recap")
    };
    assert_eq!(recap.productions.len(), 1);
    assert!(!recap.suggestions.is_empty());
    let record = &recap.productions[0];
    let revised = "La propuesta debe tener en cuenta los horarios y los intereses de Lucía. Una compañera puede mostrarle dónde consultar la información sin hablar siempre por ella.";
    store
        .connected(
            &catalog,
            ConnectedCommand::Revise {
                step_id: record.step_id.clone(),
                answer: Answer::Writing {
                    text: revised.into(),
                },
                criteria: BTreeMap::from([(
                    "task".to_string().try_into().unwrap(),
                    SelfReview::Met,
                )]),
            },
            NOW + 1,
        )
        .unwrap();
    assert!(
        store
            .reference(
                &catalog,
                SourceLanguage::En,
                &reference("mission.migration.1.rubric.model")
            )
            .is_ok()
    );
    store
        .connected(
            &catalog,
            ConnectedCommand::SaveArgument {
                id: None,
                source: reference("mission.migration.1.reading"),
                text: "Ask what help is needed, using Lucía's timetable difficulty.".into(),
                counterargument: "A guide cannot replace personal contact.".into(),
            },
            NOW,
        )
        .unwrap();
    let backup = root.path().join("outputs.sqlite");
    store.backup(&backup).unwrap();
    store.restore_database(&backup).unwrap();
    let ConnectedResponse::Productions(productions) = store
        .connected(&catalog, ConnectedCommand::Productions, NOW)
        .unwrap()
    else {
        panic!("productions")
    };
    assert_eq!(productions[0].revisions.len(), 1);
    assert!(
        matches!(&productions[0].original,Answer::Writing{text} if text.starts_with("palabra"))
    );
    assert!(matches!(&productions[0].revisions[0].answer,Answer::Writing{text} if text==revised));
    let ConnectedResponse::Notebook(entries) = store
        .connected(&catalog, ConnectedCommand::Notebook, NOW)
        .unwrap()
    else {
        panic!("notebook")
    };
    assert_eq!(entries.len(), 1);
}

#[test]
fn rehearsal_blocks_all_help_paths_and_only_first_encounter_is_unseen() {
    let (_root, mut store, catalog) = setup();
    let o = occurrence(&catalog, "lex.echar", "mission.migration.1.reading");
    learn(&mut store, &catalog, &o);
    let snap = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::StartMission {
                    mission: reference("mission.migration.1"),
                    support: SupportLevel::Rehearsal,
                },
                NOW,
            )
            .unwrap(),
    );
    for command in [
        ConnectedCommand::Lookup {
            occurrence: o.content.clone(),
            context: None,
            opened: false,
        },
        ConnectedCommand::LearnWord {
            occurrence: o.content.clone(),
            context: Some(ctx(&snap)),
        },
        ConnectedCommand::Words,
        ConnectedCommand::Notebook,
        ConnectedCommand::Productions,
    ] {
        assert!(store.connected(&catalog, command, NOW).is_err());
    }
    assert!(
        store
            .speech_release(&catalog, o.speech.as_ref().unwrap(), None, NOW)
            .is_err()
    );
    assert!(
        store
            .reference(
                &catalog,
                SourceLanguage::En,
                &reference("mission.migration.1.unseen.rubric.model")
            )
            .is_err()
    );
    let marked = submit(&mut store, &catalog, &snap, NOW);
    let SessionState::Active { step } = &marked.session else {
        panic!("active")
    };
    assert!(matches!(
        step.feedback.as_ref().unwrap().outcome,
        Outcome::DeferredUntilRecap
    ));
    assert!(step.feedback.as_ref().unwrap().rubric.is_none());
    store.advance(&ctx(&marked), &new_id(), NOW).unwrap();
    assert_eq!(store.daily_plan(&catalog, NOW).unwrap().unseen_tasks, 1);
    let repeat = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::StartMission {
                    mission: reference("mission.migration.1"),
                    support: SupportLevel::Rehearsal,
                },
                NOW + 1,
            )
            .unwrap(),
    );
    complete(&mut store, &catalog, repeat, NOW + 2);
    assert_eq!(store.daily_plan(&catalog, NOW).unwrap().unseen_tasks, 1);
    // Even a previously installed pack must not introduce a browser player that
    // bypasses the native assessment replay policy.
    let source = reference("mission.migration.1.unseen");
    let pack = catalog.locate(SourceLanguage::En, &source).unwrap();
    let mut material: Material = catalog.get(&pack.release_id, &source, "material").unwrap();
    material.blocks.push(Block::RecordedAudio {
        wav: vec![0; 44],
        caption: Text {
            language: Language::En,
            text: "Recorded source".into(),
            annotations: Vec::new(),
        },
        synthetic: false,
    });
    let db = Connection::open(&pack.path).unwrap();
    db.execute(
        "UPDATE entities SET payload=?1 WHERE id=?2",
        rusqlite::params![
            serde_json::to_string(&material).unwrap(),
            source.id.as_str()
        ],
    )
    .unwrap();
    assert!(
        matches!(store.connected(&catalog, ConnectedCommand::StartMission {
        mission: reference("mission.migration.1"), support: SupportLevel::Rehearsal,
    }, NOW + 3), Err(fluenta_storage::Error::Policy(message)) if message == "speech.input_not_allowed")
    );
}

#[test]
fn speaking_revisions_keep_the_original_and_reject_unrelated_recordings() {
    let (_root, mut store, catalog) = setup();
    let mut snap = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::StartMission {
                    mission: reference("mission.migration.2"),
                    support: SupportLevel::Independent,
                },
                NOW,
            )
            .unwrap(),
    );
    while !matches!(activity(&catalog, &snap).task, Task::Speaking { .. }) {
        let marked = submit(&mut store, &catalog, &snap, NOW);
        snap = store.advance(&ctx(&marked), &new_id(), NOW).unwrap();
    }
    let initial_context = ctx(&snap);
    let original_id = store
        .register_recording(&initial_context, Path::new("first.wav"), 15_000)
        .unwrap();
    let marked = store
        .submit(
            &catalog,
            &SubmitAnswer {
                context: initial_context.clone(),
                submission_id: new_id(),
                answer: Answer::Recording {
                    recording_id: original_id.clone(),
                },
            },
            NOW,
        )
        .unwrap();
    store.advance(&ctx(&marked), &new_id(), NOW).unwrap();
    assert!(
        store.validate_recording_context(&initial_context).is_err(),
        "stale recording context"
    );
    let ConnectedResponse::Productions(records) = store
        .connected(&catalog, ConnectedCommand::Productions, NOW)
        .unwrap()
    else {
        panic!("productions");
    };
    let record = &records[0];
    let revised_id = store
        .register_recording(&record.context, Path::new("revised.wav"), 18_000)
        .unwrap();
    assert!(
        store
            .connected(
                &catalog,
                ConnectedCommand::Revise {
                    step_id: record.step_id.clone(),
                    answer: Answer::Recording {
                        recording_id: new_id()
                    },
                    criteria: BTreeMap::new(),
                },
                NOW
            )
            .is_err()
    );
    let ConnectedResponse::Productions(records) = store
        .connected(
            &catalog,
            ConnectedCommand::Revise {
                step_id: record.step_id.clone(),
                answer: Answer::Recording {
                    recording_id: revised_id.clone(),
                },
                criteria: BTreeMap::new(),
            },
            NOW,
        )
        .unwrap()
    else {
        panic!("productions");
    };
    assert!(
        matches!(&records[0].original, Answer::Recording { recording_id } if *recording_id == original_id)
    );
    assert!(
        matches!(&records[0].revisions[0].answer, Answer::Recording { recording_id } if *recording_id == revised_id)
    );
    store
        .connected(
            &catalog,
            ConnectedCommand::StartMission {
                mission: reference("mission.migration.1"),
                support: SupportLevel::Rehearsal,
            },
            NOW,
        )
        .unwrap();
    assert!(
        store
            .validate_recording_context(&records[0].context)
            .is_err(),
        "rehearsal blocks revising older work"
    );
}

#[test]
fn daily_reviews_stay_bounded_and_backlogs_reduce_new_introductions() {
    let (_root, mut store, catalog) = setup();
    for sense in [
        "llegar",
        "barrio",
        "acogida",
        "mudarse",
        "echar",
        "tramite",
        "apoyo",
        "quedarse",
        "confianza",
        "acostumbrarse",
    ] {
        let occurrence = occurrence(
            &catalog,
            &format!("lex.{sense}"),
            "mission.migration.1.reading",
        );
        learn(&mut store, &catalog, &occurrence);
    }
    let plan = store.daily_plan(&catalog, NOW).unwrap();
    assert_eq!(
        (plan.due, plan.review_limit, plan.new_word_limit),
        (10, 3, 0)
    );
    assert_eq!(plan.topics[0].topic.content.id.as_str(), "topic.migration");
    let review = session(
        store
            .connected(
                &catalog,
                ConnectedCommand::ReviewWords {
                    sense: None,
                    production: false,
                },
                NOW,
            )
            .unwrap(),
    );
    let mut snap = review;
    let mut count = 0;
    while matches!(snap.session, SessionState::Active { .. }) {
        let marked = submit(&mut store, &catalog, &snap, NOW);
        snap = store.advance(&ctx(&marked), &new_id(), NOW).unwrap();
        count += 1;
    }
    assert_eq!(count, 3);
    let plan = store.daily_plan(&catalog, NOW).unwrap();
    assert_eq!(plan.due, 7, "unreviewed items remain due");
    assert_eq!(plan.new_word_limit, 3);
    let mut settings = store.settings().unwrap();
    settings.daily_minutes = 20;
    store.save_settings(settings).unwrap();
    let plan = store.daily_plan(&catalog, NOW).unwrap();
    assert_eq!((plan.review_limit, plan.new_word_limit), (6, 5));
}

#[test]
fn version_one_data_and_backups_migrate_without_resetting_reviews() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("learner");
    std::fs::create_dir(&directory).unwrap();
    let db = Connection::open(directory.join("student.sqlite")).unwrap();
    db.execute_batch(include_str!("../src/schema.sql")).unwrap();
    db.execute("INSERT INTO reviews VALUES('en:old','old.activity','en','old.release',1,4.5,6.2,1700000000000,1699990000000)",[]).unwrap();
    let original = root.path().join("old.sqlite");
    db.backup("main", &original, None).unwrap();
    drop(db);
    let mut store = Store::open(&directory).unwrap();
    store.restore_database(&original).unwrap();
    drop(store);
    let db = Connection::open(directory.join("student.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT stability FROM reviews WHERE id='en:old'", [], |r| r
            .get::<_, f64>(0))
            .unwrap(),
        4.5
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM vocabulary", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
}
