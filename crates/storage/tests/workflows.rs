use fluenta_content::{Catalog, reference};
use fluenta_contracts::*;
use fluenta_storage::{Error, Store, new_id};
use std::path::Path;

const NOW: i64 = 1_800_000_000_000;
fn setup() -> (tempfile::TempDir, Store, Catalog) {
    let root = tempfile::tempdir().unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation");
    fluenta_content::compile_source(&source, &root.path().join("courses")).unwrap();
    let catalog = Catalog::open(&root.path().join("courses")).unwrap();
    let store = Store::open(&root.path().join("learner")).unwrap();
    (root, store, catalog)
}
fn context(snapshot: &SessionSnapshot) -> MutationContext {
    let SessionState::Active { step } = &snapshot.session else {
        panic!("expected active step")
    };
    MutationContext {
        session_id: snapshot.session_id.clone(),
        step_id: step.step_id.clone(),
        expected_step_version: step.version,
    }
}
fn current(catalog: &Catalog, kind: &str, id: &str) -> ContentRef {
    catalog
        .packs
        .iter()
        .filter(|pack| pack.course.source_language == SourceLanguage::En)
        .flat_map(|pack| {
            catalog
                .list::<serde_json::Value>(&pack.release_id, kind)
                .unwrap()
        })
        .find(|record| record["content"]["id"] == id)
        .map(|record| serde_json::from_value(record["content"].clone()).unwrap())
        .expect("published fixture record")
}
fn start(store: &mut Store, catalog: &Catalog) -> SessionSnapshot {
    store
        .start_session(
            catalog,
            SourceLanguage::En,
            SessionMode::Lesson,
            &current(catalog, "lesson", "es.a1.identities.lesson"),
            NOW,
        )
        .unwrap()
}
fn step(snapshot: &SessionSnapshot) -> &ActiveStep {
    let SessionState::Active { step } = &snapshot.session else {
        panic!("expected active")
    };
    step
}
fn answer_key(catalog: &Catalog, snapshot: &SessionSnapshot) -> Answer {
    let activity: Activity = catalog
        .get(
            &snapshot.release_id,
            &step(snapshot).activity.content,
            "activity",
        )
        .unwrap();
    match activity.task {
        Task::Explanation { .. } => Answer::Acknowledged,
        Task::Choice { correct_ids, .. } => Answer::Choice {
            selected_ids: correct_ids,
        },
        Task::Order {
            accepted_orders, ..
        } => Answer::Order {
            ordered_ids: accepted_orders[0].clone(),
        },
        Task::ShortAnswer { accepted, .. } => Answer::Typed {
            text: accepted[0].clone(),
        },
        Task::Writing { min_words, .. } => Answer::Writing {
            text: vec!["palabra"; min_words as usize].join(" "),
        },
        _ => panic!("unsupported fixture answer"),
    }
}
fn submit(
    store: &mut Store,
    catalog: &Catalog,
    snapshot: &SessionSnapshot,
    answer: Answer,
) -> SessionSnapshot {
    store
        .submit(
            catalog,
            &SubmitAnswer {
                context: context(snapshot),
                submission_id: new_id(),
                answer,
            },
            NOW,
        )
        .unwrap()
}
fn advance(store: &mut Store, snapshot: &SessionSnapshot) -> SessionSnapshot {
    store.advance(&context(snapshot), &new_id(), NOW).unwrap()
}
fn reach_recall(store: &mut Store, catalog: &Catalog) -> SessionSnapshot {
    let mut session = start(store, catalog);
    for _ in 0..3 {
        let answer = answer_key(catalog, &session);
        session = submit(store, catalog, &session, answer);
        session = advance(store, &session);
    }
    session
}

#[test]
fn draft_ordering_restart_and_idempotent_commit_preserve_progress() {
    let (root, mut store, catalog) = setup();
    let session = reach_recall(&mut store, &catalog);
    let ctx = context(&session);
    assert_eq!(
        store
            .save_draft(
                &ctx,
                2,
                &Answer::Typed {
                    text: "Somos estudiantes".into()
                },
                NOW
            )
            .unwrap(),
        2
    );
    assert_eq!(
        store
            .save_draft(
                &ctx,
                1,
                &Answer::Typed {
                    text: "stale".into()
                },
                NOW
            )
            .unwrap(),
        2
    );
    drop(store);
    let mut store = Store::open(&root.path().join("learner")).unwrap();
    let resumed = store.resume(&session.session_id, NOW).unwrap();
    assert!(matches!(&step(&resumed).draft,Some(Answer::Typed{text}) if text=="Somos estudiantes"));
    let submission = SubmitAnswer {
        context: ctx.clone(),
        submission_id: new_id(),
        answer: Answer::Typed {
            text: "Somos estudiantes".into(),
        },
    };
    let first = store.submit(&catalog, &submission, NOW).unwrap();
    let second = store.submit(&catalog, &submission, NOW + 1000).unwrap();
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(second).unwrap()
    );
    assert!(matches!(
        step(&first).feedback.as_ref().unwrap().outcome,
        Outcome::Correct
    ));
    let overview = store.overview(&catalog, false, NOW).unwrap();
    assert_eq!(overview.today_attempts, 4);
    assert!(matches!(
        store.submit(
            &catalog,
            &SubmitAnswer {
                context: ctx,
                submission_id: new_id(),
                answer: Answer::Typed {
                    text: "wrong".into()
                }
            },
            NOW
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(
        store
            .overview(&catalog, false, NOW + 400 * 86_400_000)
            .unwrap()
            .due_reviews,
        1
    );
}

#[test]
fn reference_assistance_applies_only_to_the_current_answer() {
    for assist_recall in [false, true] {
        let (_root, mut store, catalog) = setup();
        let mut session = start(&mut store, &catalog);
        store.mark_assistance(None).unwrap();
        for _ in 0..3 {
            let answer = answer_key(&catalog, &session);
            session = submit(&mut store, &catalog, &session, answer);
            session = advance(&mut store, &session);
        }
        if assist_recall {
            store.mark_assistance(None).unwrap();
        }
        let answer = answer_key(&catalog, &session);
        let marked = submit(&mut store, &catalog, &session, answer);
        assert_eq!(
            step(&marked).feedback.as_ref().unwrap().evidence,
            if assist_recall {
                Evidence::AssistedRecall
            } else {
                Evidence::UnaidedRecall
            }
        );
    }
}

#[test]
fn hints_and_cross_step_voice_handles_cannot_claim_unaided_recall() {
    let (_root, mut store, catalog) = setup();
    let session = reach_recall(&mut store, &catalog);
    let nonce = new_id();
    let (_, hinted) = store
        .hint(&catalog, &context(&session), &nonce, NOW)
        .unwrap();
    assert!(matches!(
        store.save_draft(
            &context(&session),
            9,
            &Answer::Typed {
                text: "old version".into()
            },
            NOW
        ),
        Err(Error::Conflict)
    ));
    let (_, replayed) = store
        .hint(&catalog, &context(&session), &nonce, NOW)
        .unwrap();
    assert_eq!(replayed.version, hinted.version);
    let invalid = SubmitAnswer {
        context: context(&hinted),
        submission_id: new_id(),
        answer: Answer::Voice {
            recognition_id: new_id(),
            confirmed_text: "Somos estudiantes".into(),
        },
    };
    assert!(store.submit(&catalog, &invalid, NOW).is_err());
    let recognition = store
        .register_recognition(&context(&hinted), "Somos estudiantes")
        .unwrap();
    let answer = Answer::Voice {
        recognition_id: recognition.recognition_id,
        confirmed_text: "Somos estudiantes".into(),
    };
    let marked = submit(&mut store, &catalog, &hinted, answer);
    assert_eq!(
        step(&marked).feedback.as_ref().unwrap().evidence,
        Evidence::AssistedRecall
    );
    assert!(
        store
            .register_recognition(&context(&session), "late recognition")
            .is_err()
    );
}

#[test]
fn test_feedback_deadline_reference_access_and_replay_limit_are_backend_policies() {
    let (_root, mut store, catalog) = setup();
    let mut session = store
        .start_session(
            &catalog,
            SourceLanguage::De,
            SessionMode::Test,
            &current(&catalog, "assessment", "es.a1.checkpoint"),
            NOW,
        )
        .unwrap();
    assert!(store.check_reference_access().is_err());
    assert!(store.mark_assistance(None).is_err());
    assert!(
        store
            .hint(&catalog, &context(&session), &new_id(), NOW)
            .is_err()
    );
    for _ in 0..2 {
        let answer = answer_key(&catalog, &session);
        session = submit(&mut store, &catalog, &session, answer);
        let feedback = step(&session).feedback.as_ref().unwrap();
        assert_eq!(feedback.outcome, Outcome::DeferredUntilRecap);
        assert!(feedback.explanation.is_none());
        assert!(store.session_review(&session.session_id).is_err());
        session = advance(&mut store, &session);
    }
    let ctx = context(&session);
    let segment = reference("es.a1.checkpoint.speech");
    assert!(
        store
            .reserve_audio(&ctx, &reference("es.a1.identities.example-audio"), NOW)
            .is_err()
    );
    for _ in 0..3 {
        store.reserve_audio(&ctx, &segment, NOW).unwrap();
    }
    assert!(store.reserve_audio(&ctx, &segment, NOW).is_err());
    let expired = store.resume(&session.session_id, NOW + 601_000).unwrap();
    assert!(matches!(expired.session, SessionState::Completed { .. }));
    store.check_reference_access().unwrap();
    let recap = store.session_review(&session.session_id).unwrap();
    assert_eq!(
        recap.steps[0].feedback.as_ref().unwrap().outcome,
        Outcome::Correct
    );
    assert_eq!(
        store
            .overview(&catalog, false, NOW + 999_999_999)
            .unwrap()
            .due_reviews,
        0,
        "held-out assessment items must not enter recall drills"
    );
}

#[test]
fn backup_uses_committed_wal_and_restore_preserves_a_saved_session() {
    let (root, mut store, catalog) = setup();
    let session = reach_recall(&mut store, &catalog);
    store
        .save_draft(
            &context(&session),
            3,
            &Answer::Typed {
                text: "Mi borrador".into(),
            },
            NOW,
        )
        .unwrap();
    let backup = root.path().join("snapshot.sqlite");
    store.backup(&backup).unwrap();
    Store::validate_backup(&backup).unwrap();
    store.abandon(&session.session_id, NOW).unwrap();
    store.restore_database(&backup).unwrap();
    let restored = store.snapshot(&session.session_id).unwrap();
    assert_eq!(step(&restored).draft_sequence, 3);
    assert!(matches!(&step(&restored).draft,Some(Answer::Typed{text}) if text=="Mi borrador"));
}

#[test]
fn language_switches_keep_pinned_sessions_and_filter_practice_by_authored_skill() {
    let (_root, mut store, catalog) = setup();
    let session = start(&mut store, &catalog);
    let same = start(&mut store, &catalog);
    assert_eq!(same.session_id, session.session_id);
    let mut settings = store.settings().unwrap();
    settings.source_language = SourceLanguage::De;
    store.save_settings(settings).unwrap();
    assert_eq!(
        store.snapshot(&session.session_id).unwrap().source_language,
        SourceLanguage::En
    );
    let focused = store
        .start_filtered_session(
            &catalog,
            SourceLanguage::De,
            SessionMode::FocusedPractice,
            &current(&catalog, "objective", "es.a1.identities.objective"),
            Some(Skill::Listening),
            NOW,
        )
        .unwrap();
    assert_eq!(focused.step_count.get(), 1);
    assert_eq!(
        step(&focused).activity.content.id.as_str(),
        "es.a1.identities.listen"
    );
    let direct = serde_json::to_string(&step(&focused).activity).unwrap();
    assert!(!direct.contains("correct_ids"));
    assert!(!direct.contains("Me llamo Lucía"));
}

#[test]
fn open_speaking_has_a_real_keyboard_alternative_without_fake_grading() {
    let (_root, mut store, catalog) = setup();
    let speaking = store
        .start_filtered_session(
            &catalog,
            SourceLanguage::En,
            SessionMode::FocusedPractice,
            &current(&catalog, "objective", "es.a1.classroom.objective"),
            Some(Skill::Speaking),
            NOW,
        )
        .unwrap();
    let written = store
        .keyboard_alternative(&catalog, &context(&speaking))
        .unwrap();
    assert!(matches!(
        step(&written).activity.task,
        TaskView::Writing { .. }
    ));
    let answer = answer_key(&catalog, &written);
    let marked = submit(&mut store, &catalog, &written, answer);
    assert_eq!(
        step(&marked).feedback.as_ref().unwrap().outcome,
        Outcome::NeedsSelfReview
    );
    assert!(step(&marked).feedback.as_ref().unwrap().rubric.is_some());
}
