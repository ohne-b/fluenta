//! An explicit model smoke test. Never downloads or installs a model implicitly.
use fluenta_contracts::*;
use fluenta_runtime::Cancellation;
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let directory = root.join(".cache/evaluation");
    let model = fluenta_tutor::Tutor::new(
        fluenta_runtime::runtime_directory(&root.join("apps/desktop/src-tauri/resources"), "llama"),
        directory,
    )?;
    let context = TutorContext {
        source_language: SourceLanguage::De,
        band: Band::A2,
        mode: TutorMode::Explain,
        objective: None,
        visible_task: None,
        submitted_answer: None,
        references: vec![],
        solution_revealed: false,
    };
    let start = Instant::now();
    let prompt=std::env::args().nth(1).unwrap_or_else(||"¿Es correcta la frase «Me gustan los idiomas»? Explica brevemente por qué en alemán y hazme una pregunta sencilla en español.".into());
    let response = model.generate(&context, &[], &prompt, &Cancellation::default())?;
    println!(
        "Latency: {:?}\n{}",
        start.elapsed(),
        serde_json::to_string_pretty(&response)?
    );
    Ok(())
}
