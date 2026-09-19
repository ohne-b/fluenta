//! Synthetic round trip: no microphone access or ambient recording.
use fluenta_runtime::Cancellation;
use fluenta_speech::{Speech, read_wav};
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src-tauri/resources")
        });
    let cache = tempfile::tempdir()?;
    let speech = Speech::new(root, cache.path().to_path_buf())?;
    let token = Cancellation::default();
    let start = Instant::now();
    let path = speech.synthesize("Hoy tengo clase de español a las nueve.", false, &token)?;
    println!("Piper: {:?}", start.elapsed());
    let samples = read_wav(&std::fs::read(&path)?)?;
    let start = Instant::now();
    let transcript = speech.transcribe(&samples, &token)?;
    println!("Whisper: {:?}; transcript: {transcript}", start.elapsed());
    let lower = transcript.to_lowercase();
    assert!(
        lower.contains("español") && lower.contains("clase"),
        "synthetic speech round trip lost its key meaning"
    );
    Ok(())
}
