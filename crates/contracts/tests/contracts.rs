use fluenta_contracts::{Activity, ContentRef, Request, SourceLanguage, TaskView};
use serde_json::{Value, json};

fn typed() -> Value {
    serde_json::from_str(include_str!("../fixtures/typed-answer.json")).unwrap()
}

#[test]
fn language_and_revision_boundaries_are_closed() {
    assert!(serde_json::from_str::<SourceLanguage>("\"es\"").is_err());
    assert!(serde_json::from_value::<ContentRef>(json!({"id":"a", "revision":0})).is_err());
    assert!(serde_json::from_value::<ContentRef>(json!({"id":"../escape", "revision":1})).is_err());
}

#[test]
fn valid_typed_and_voice_tasks_round_trip_without_changing_accents() {
    for source in [
        include_str!("../fixtures/typed-answer.json"),
        include_str!("../fixtures/voice-answer.json"),
    ] {
        let activity: Activity = serde_json::from_str(source).unwrap();
        activity.validate().unwrap();
        assert_eq!(
            serde_json::to_value(activity).unwrap(),
            serde_json::from_str::<Value>(source).unwrap()
        );
    }
}

#[test]
fn voice_cannot_claim_spelling_evidence() {
    let mut value = typed();
    value["task"]["inputs"] = json!(["keyboard", "microphone"]);
    assert!(
        serde_json::from_value::<Activity>(value)
            .unwrap()
            .validate()
            .is_err()
    );
}

#[test]
fn answer_free_projection_does_not_expose_the_solution() {
    let activity: Activity = serde_json::from_value(typed()).unwrap();
    let view = serde_json::to_value(TaskView::from(&activity.task)).unwrap();
    assert_eq!(
        view,
        json!({"kind":"short_answer", "language":"es", "target":"orthography", "inputs":["keyboard"]})
    );
}

#[test]
fn unknown_answer_policies_and_extra_fields_are_rejected() {
    let mut bad = typed();
    bad["task"]["normalization"] = json!(["strip_accents"]);
    assert!(serde_json::from_value::<Activity>(bad).is_err());
    let mut bad = typed();
    bad["execute"] = json!("arbitrary-code");
    assert!(serde_json::from_value::<Activity>(bad).is_err());
}

#[test]
fn choices_and_orders_require_real_unique_options() {
    let mut value = typed();
    value["task"] = json!({
        "kind":"choice", "options":[{"id":"a","label":{"language":"es","text":"Ayer"}}, {"id":"b","label":{"language":"es","text":"Mañana"}}],
        "correct_ids":["missing"], "explanation":{"id":"explanation.a","revision":1}
    });
    assert!(
        serde_json::from_value::<Activity>(value.clone())
            .unwrap()
            .validate()
            .is_err()
    );
    value["task"]["correct_ids"] = json!(["a"]);
    serde_json::from_value::<Activity>(value.clone())
        .unwrap()
        .validate()
        .unwrap();
    value["task"] = json!({
        "kind":"order", "items":[{"id":"a","label":{"language":"es","text":"Ayer"}}, {"id":"b","label":{"language":"es","text":"estudié"}}],
        "accepted_orders":[["a","a"]], "explanation":{"id":"explanation.a","revision":1}
    });
    assert!(
        serde_json::from_value::<Activity>(value)
            .unwrap()
            .validate()
            .is_err()
    );
}

#[test]
fn clients_cannot_supply_their_own_evidence() {
    let base = json!({"protocol_version":1,"request_id":"request.1","command":{"command":"submit_answer","payload":{
        "context":{"session_id":"session.1","step_id":"step.1","expected_step_version":1},
        "submission_id":"submission.1","answer":{"kind":"voice","recognition_id":"recognition.1","confirmed_text":"Ayer estudié"}
    }}});
    serde_json::from_value::<Request>(base.clone()).unwrap();
    let mut tampered = base;
    tampered["command"]["payload"]["answer"]["evidence"] = json!("unaided_recall");
    assert!(serde_json::from_value::<Request>(tampered).is_err());
}

#[test]
fn bilingual_unit_has_resolved_references_and_shared_spanish_content() {
    use fluenta_contracts::CoursePack;
    use std::collections::BTreeSet;

    fn walk(value: &Value, ids: &BTreeSet<(String, u64)>, locale: &str) {
        match value {
            Value::Object(object) => {
                if let (Some(id), Some(revision)) = (object.get("id"), object.get("revision")) {
                    assert!(
                        ids.contains(&(id.as_str().unwrap().into(), revision.as_u64().unwrap())),
                        "unresolved reference: {value}"
                    );
                }
                if let Some(language) = object.get("language") {
                    assert!(
                        language == locale || language == "es",
                        "wrong teaching language: {value}"
                    );
                }
                for child in object.values() {
                    walk(child, ids, locale);
                }
            }
            Value::Array(items) => {
                for child in items {
                    walk(child, ids, locale);
                }
            }
            _ => {}
        }
    }

    let mut definitions = Vec::new();
    let mut spanish = Vec::new();
    for (locale, source) in [
        ("de", include_str!("../fixtures/unit.de.json")),
        ("en", include_str!("../fixtures/unit.en.json")),
    ] {
        let pack: CoursePack = serde_json::from_str(source).unwrap();
        for activity in &pack.activities {
            activity.validate().unwrap();
        }
        let value: Value = serde_json::from_str(source).unwrap();
        let mut records = vec![&value["course"]];
        for key in [
            "units",
            "lessons",
            "objectives",
            "activities",
            "materials",
            "speech",
            "vocabulary",
            "rubrics",
        ] {
            records.extend(value[key].as_array().unwrap());
        }
        let ids: BTreeSet<_> = records
            .iter()
            .map(|record| {
                (
                    record["content"]["id"].as_str().unwrap().to_owned(),
                    record["content"]["revision"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(ids.len(), records.len(), "duplicate content definition");
        walk(&value, &ids, locale);
        definitions.push(ids);
        spanish.push(json!({"speech":value["speech"], "typed":value["activities"][2]["task"], "voice":value["activities"][3]["task"]}));
    }
    assert_eq!(definitions[0], definitions[1]);
    assert_eq!(spanish[0], spanish[1]);
}

#[test]
fn generated_schemas_match_checked_in_contracts() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("schema");
    for (name, schema) in [
        ("activity", schemars::schema_for!(Activity)),
        (
            "course-pack",
            schemars::schema_for!(fluenta_contracts::CoursePack),
        ),
        ("request", schemars::schema_for!(Request)),
        (
            "response",
            schemars::schema_for!(fluenta_contracts::Response),
        ),
        ("event", schemars::schema_for!(fluenta_contracts::Event)),
        (
            "tutor-context",
            schemars::schema_for!(fluenta_contracts::TutorContext),
        ),
    ] {
        let checked_in: Value = serde_json::from_str(
            &std::fs::read_to_string(directory.join(format!("{name}.schema.json"))).unwrap(),
        )
        .unwrap();
        assert_eq!(
            checked_in,
            serde_json::to_value(schema).unwrap(),
            "schema drift: {name}; run cargo run --bin export"
        );
    }
}
