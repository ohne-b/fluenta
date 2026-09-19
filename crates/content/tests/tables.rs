use fluenta_content::{Catalog, compile_source, validate, write_pack};
use fluenta_contracts::*;
use std::path::Path;

#[test]
fn bilingual_tables_roundtrip_and_reject_incompatible_or_ragged_content() {
    let temporary = tempfile::tempdir().unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation");
    let compiled = temporary.path().join("compiled");
    compile_source(&source, &compiled).unwrap();
    let catalog = Catalog::open(&compiled).unwrap();
    for language in [SourceLanguage::En, SourceLanguage::De] {
        let topics = catalog.grammar(language).unwrap();
        assert_eq!(topics.len(), 17);
        assert_eq!(
            topics.iter().filter(|topic| topic.group.is_some()).count(),
            3
        );
        let hits = catalog.related_references(language, "Explícame la diferencia entre el indefinido y el imperfecto con un ejemplo escolar.").unwrap();
        assert!(
            hits.iter()
                .any(|hit| hit.content.id.as_str() == "es.a2.past-events.guide")
        );
        assert!(
            hits.iter()
                .any(|hit| hit.content.id.as_str() == "es.a2.past-background.guide")
        );
    }
    for info in &catalog.packs {
        let mut pack = CoursePack {
            topics: catalog.list(&info.release_id, "topic").unwrap(),
            missions: catalog.list(&info.release_id, "mission").unwrap(),
            occurrences: catalog.list(&info.release_id, "occurrence").unwrap(),
            schema_version: 4.try_into().unwrap(),
            release_id: info.release_id.clone(),
            course: info.course.clone(),
            units: catalog.list(&info.release_id, "unit").unwrap(),
            lessons: catalog.list(&info.release_id, "lesson").unwrap(),
            objectives: catalog.list(&info.release_id, "objective").unwrap(),
            activities: catalog.list(&info.release_id, "activity").unwrap(),
            materials: catalog.list(&info.release_id, "material").unwrap(),
            speech: catalog.list(&info.release_id, "speech").unwrap(),
            vocabulary: catalog.list(&info.release_id, "vocabulary").unwrap(),
            rubrics: catalog.list(&info.release_id, "rubric").unwrap(),
            assessments: catalog.list(&info.release_id, "assessment").unwrap(),
            grammar: catalog.list(&info.release_id, "grammar").unwrap(),
        };
        validate(&pack).unwrap();
        for topic in &pack.grammar {
            if topic.order <= 80 {
                assert!(topic.lessons.len() >= 2);
                for reference in topic.lessons.iter().take(2) {
                    let lesson = pack
                        .lessons
                        .iter()
                        .find(|lesson| lesson.content == *reference)
                        .unwrap();
                    assert!(lesson.activities.len() >= 10);
                }
                let first = pack
                    .lessons
                    .iter()
                    .find(|lesson| lesson.content == topic.lessons[0])
                    .unwrap();
                assert!(first.activities.iter().take(8).all(|reference| {
                    pack.activities.iter().any(|activity| {
                        activity.content == *reference
                            && matches!(activity.task, Task::Choice { .. })
                    })
                }));
            }
            for reference in &topic.lessons {
                let lesson = pack
                    .lessons
                    .iter()
                    .find(|lesson| lesson.content == *reference)
                    .unwrap();
                for activity in &lesson.activities {
                    let help = catalog.grammar_help(&info.release_id, activity).unwrap();
                    assert!(
                        help.iter()
                            .any(|material| topic.explanations.contains(&material.content))
                    );
                }
            }
        }
        let mut invalid = pack.clone();
        invalid.grammar[0].explanations[0] = invalid.activities[0].content.clone();
        assert!(
            validate(&invalid).is_err(),
            "grammar must not expose an activity/answer as an explanation"
        );
        let table = pack
            .materials
            .iter()
            .find(|m| m.blocks.iter().any(|b| matches!(b, Block::Table { .. })))
            .unwrap();
        let expected = table.clone();
        let roundtrip = temporary.path().join(info.release_id.as_str());
        std::fs::create_dir(&roundtrip).unwrap();
        write_pack(&pack, &roundtrip.join("pack.sqlite")).unwrap();
        let restored = Catalog::open(&roundtrip).unwrap();
        let materials: Vec<Material> = restored.list(&info.release_id, "material").unwrap();
        let actual = materials
            .iter()
            .find(|m| m.content == expected.content)
            .unwrap();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        pack.schema_version = 1.try_into().unwrap();
        assert!(
            validate(&pack).is_err(),
            "old apps must not accept table packs"
        );
        pack.schema_version = 2.try_into().unwrap();
        assert!(validate(&pack).is_err(), "topic ordering requires schema 3");
        pack.schema_version = 3.try_into().unwrap();
        for material in &mut pack.materials {
            for block in &mut material.blocks {
                if let Block::Table { rows, .. } = block {
                    rows[0].pop();
                }
            }
        }
        assert!(
            validate(&pack).is_err(),
            "a table row must match its column headings"
        );
    }
}
