//! Produces review evidence through the production runtime, not a synthetic accuracy score.
use fluenta_contracts::*;
use std::{fs, path::PathBuf, time::Instant};

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    source_language: SourceLanguage,
    band: Band,
    mode: TutorMode,
    message: String,
    review: String,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cases: Vec<Case> = serde_json::from_str(include_str!("../../../evals/tutor/cases.json"))?;
    let model = fluenta_tutor::Tutor::new(
        fluenta_runtime::runtime_directory(&root.join("apps/desktop/src-tauri/resources"), "llama"),
        root.join(".cache/evaluation"),
    )?;
    let mut results = Vec::new();
    for case in cases {
        let context = TutorContext {
            source_language: case.source_language,
            band: case.band,
            mode: case.mode,
            objective: None,
            visible_task: None,
            submitted_answer: None,
            references: vec![],
            solution_revealed: false,
        };
        let start = Instant::now();
        let reply = model.generate(
            &context,
            &[],
            &case.message,
            &fluenta_runtime::cancellation(),
        );
        let result = serde_json::json!({
            "case": case.name, "message": case.message, "review_criteria": case.review,
            "seconds": start.elapsed().as_secs_f64(), "reply": reply.as_ref().ok(),
            "error": reply.err().map(|error| error.to_string()),
        });
        println!("{}", serde_json::to_string(&result)?);
        results.push(result);
    }
    fs::create_dir_all(root.join("artifacts"))?;
    fs::write(
        root.join("artifacts/tutor-evaluation.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "model": fluenta_tutor::MODEL.id, "sha256": fluenta_tutor::MODEL.sha256,
            "runtime": "llama.cpp b10956 CPU", "results": results,
            "notice": "Schema validity and latency are measured. Teaching accuracy requires human review."
        }))?,
    )?;
    Ok(())
}
