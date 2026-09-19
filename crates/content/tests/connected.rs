use fluenta_content::{Catalog, compile_source, reference, validate};
use fluenta_contracts::*;
use std::path::Path;

fn pack(catalog: &Catalog, locale: SourceLanguage) -> CoursePack {
    let p = catalog
        .locate(locale, &reference("mission.migration.1"))
        .unwrap();
    CoursePack {
        schema_version: 4.try_into().unwrap(),
        release_id: p.release_id.clone(),
        course: p.course.clone(),
        units: catalog.list(&p.release_id, "unit").unwrap(),
        lessons: catalog.list(&p.release_id, "lesson").unwrap(),
        objectives: catalog.list(&p.release_id, "objective").unwrap(),
        activities: catalog.list(&p.release_id, "activity").unwrap(),
        materials: catalog.list(&p.release_id, "material").unwrap(),
        speech: catalog.list(&p.release_id, "speech").unwrap(),
        vocabulary: catalog.list(&p.release_id, "vocabulary").unwrap(),
        rubrics: catalog.list(&p.release_id, "rubric").unwrap(),
        assessments: catalog.list(&p.release_id, "assessment").unwrap(),
        grammar: catalog.list(&p.release_id, "grammar").unwrap(),
        topics: catalog.list(&p.release_id, "topic").unwrap(),
        missions: catalog.list(&p.release_id, "mission").unwrap(),
        occurrences: catalog.list(&p.release_id, "occurrence").unwrap(),
    }
}
#[test]
fn connected_library_is_bilingual_referenced_and_held_out() {
    let root = tempfile::tempdir().unwrap();
    compile_source(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation"),
        root.path(),
    )
    .unwrap();
    let catalog = Catalog::open(root.path()).unwrap();
    for locale in [SourceLanguage::De, SourceLanguage::En] {
        let p = pack(&catalog, locale);
        validate(&p).unwrap();
        assert_eq!(p.topics.len(), 8);
        assert_eq!(p.missions.len(), 13);
        let migration = p
            .topics
            .iter()
            .find(|t| t.content.id.as_str() == "topic.migration")
            .unwrap();
        assert_eq!(migration.missions.len(), 6);
        assert_eq!(
            p.vocabulary
                .iter()
                .filter(|w| w.content.id.as_str().starts_with("lex."))
                .count(),
            60
        );
        assert!(
            p.vocabulary
                .iter()
                .all(|w| w.gloss.language == locale.language())
        );
        for mission in &p.missions {
            let lesson = p
                .lessons
                .iter()
                .find(|l| l.content == mission.lesson)
                .unwrap();
            assert!(lesson.activities.len() >= 7);
            assert!(!mission.sources.is_empty());
        }
        for activity in &p.activities {
            if !activity.content.id.as_str().starts_with("mission.") {
                continue;
            }
            if let Task::Writing {
                min_words,
                max_words,
                rubric,
                ..
            } = &activity.task
            {
                // The displayed range, native submission gate and complete model agree.
                assert!(
                    activity
                        .instruction
                        .text
                        .contains(&format!("{min_words}–{} palabras", max_words.get()))
                );
                let rubric = p.rubrics.iter().find(|r| r.content == *rubric).unwrap();
                for model in &rubric.model_answers {
                    let material = p.materials.iter().find(|m| m.content == *model).unwrap();
                    let words: usize = material
                        .blocks
                        .iter()
                        .filter_map(|b| match b {
                            Block::Paragraph { spans } => Some(
                                spans
                                    .iter()
                                    .map(|s| s.text.split_whitespace().count())
                                    .sum::<usize>(),
                            ),
                            _ => None,
                        })
                        .sum();
                    assert!(
                        words >= *min_words as usize && words <= max_words.get() as usize,
                        "{}: {words} model words",
                        activity.content.id
                    );
                }
                // General production must not imply use of every word in a passage.
                assert!(activity.lexical.is_empty());
            }
        }
        let grammar = catalog
            .grammar_help(&p.release_id, &reference("mission.migration.1.write"))
            .unwrap();
        assert!(
            grammar
                .iter()
                .any(|m| m.content.id.as_str().starts_with("es.a1."))
        );
        assert!(p.materials.iter().any(|m| m.blocks.iter().any(|b| matches!(
            b,
            Block::SourceText {
                language: Language::De,
                ..
            }
        ))));
        assert!(
            p.materials
                .iter()
                .any(|m| m.blocks.iter().any(|b| matches!(b, Block::Image { .. })))
        );
        let mut broken = p.clone();
        broken.occurrences[0].surface = "not the annotated expression".into();
        assert!(validate(&broken).is_err());
        let mut exposed = p.clone();
        exposed
            .materials
            .iter_mut()
            .find(|m| m.content.id.as_str() == "mission.migration.1.unseen")
            .unwrap()
            .searchable = true;
        assert!(validate(&exposed).is_err());
        let mut dangling = p.clone();
        dangling.missions[0].challenge = reference("missing.challenge");
        assert!(validate(&dangling).is_err());
        let mut crossed = p.clone();
        crossed
            .activities
            .iter_mut()
            .find(|a| !a.lexical.is_empty())
            .unwrap()
            .lexical[0]
            .sense = reference("lex.coste");
        assert!(validate(&crossed).is_err());
        let mut unbounded_audio = p.clone();
        // This is a foundation checkpoint, outside the mission-specific validator.
        let assessment = unbounded_audio
            .assessments
            .iter()
            .find(|a| !a.content.id.as_str().starts_with("mission."))
            .unwrap();
        let input = unbounded_audio
            .activities
            .iter()
            .find(|a| assessment.activities.contains(&a.content) && !a.materials.is_empty())
            .unwrap()
            .materials[0]
            .clone();
        let mut wav = vec![0; 44];
        wav[..4].copy_from_slice(b"RIFF");
        wav[8..12].copy_from_slice(b"WAVE");
        unbounded_audio
            .materials
            .iter_mut()
            .find(|m| m.content == input)
            .unwrap()
            .blocks
            .push(Block::RecordedAudio {
                wav,
                caption: Text {
                    language: locale.language(),
                    text: "Recorded source".into(),
                    annotations: Vec::new(),
                },
                synthetic: false,
            });
        assert!(
            validate(&unbounded_audio)
                .unwrap_err()
                .to_string()
                .contains("recorded assessment audio needs native replay controls")
        );
    }
}
