//! Standard offline speech: native capture/playback, Piper and whisper.cpp.
use fluenta_runtime::{Cancellation, is_cancelled};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc,
    time::Duration,
};

mod capture;
pub use capture::Capture;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("speech.device_unavailable")]
    Device,
    #[error("speech.no_speech")]
    NoSpeech,
    #[error("speech.invalid_audio")]
    Audio,
    #[error(transparent)]
    Worker(#[from] fluenta_runtime::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Wav(#[from] hound::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone)]
pub struct Speech {
    pub resources: PathBuf,
    pub cache: PathBuf,
}
impl Speech {
    pub fn new(resources: PathBuf, cache: PathBuf) -> Result<Self> {
        fs::create_dir_all(&cache)?;
        Ok(Self { resources, cache })
    }
    pub fn available(&self) -> (bool, bool) {
        (
            fluenta_runtime::executable(
                &fluenta_runtime::runtime_directory(&self.resources, "piper"),
                "piper_exe",
            )
            .is_ok()
                && self
                    .resources
                    .join("models/es_ES-davefx-medium.onnx")
                    .is_file(),
            fluenta_runtime::executable(
                &fluenta_runtime::runtime_directory(&self.resources, "whisper"),
                "whisper-cli",
            )
            .is_ok()
                && self.resources.join("models/ggml-small-q5_1.bin").is_file(),
        )
    }
    pub fn synthesize(&self, text: &str, slow: bool, token: &Cancellation) -> Result<PathBuf> {
        if text.trim().is_empty() || text.len() > 8000 {
            return Err(Error::Audio);
        }
        let key = format!(
            "{:x}",
            Sha256::digest(format!(
                "piper-1.8.0-wav2:6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917:{slow}:{text}"
            ))
        );
        let target = self.cache.join(format!("{key}.wav"));
        if target.is_file() {
            return Ok(target);
        }
        let staging = tempfile::tempdir_in(&self.cache)?;
        let wave = staging.path().join("speech.wav");
        let runtime = fluenta_runtime::runtime_directory(&self.resources, "piper");
        let executable = fluenta_runtime::executable(&runtime, "piper_exe")?;
        let mut command = Command::new(executable);
        command
            .arg("--model")
            .arg(self.resources.join("models/es_ES-davefx-medium.onnx"))
            .arg("--espeak_data")
            .arg(runtime.join("share/espeak-ng-data"))
            .arg("--output_file")
            .arg(&wave)
            .arg("--json-input")
            .arg("--length_scale")
            .arg(if slow { "1.25" } else { "1.0" });
        library_path(&mut command, &runtime);
        let input = format!(
            "{}\n",
            serde_json::to_string(&serde_json::json!({"text":text}))?
        );
        fluenta_runtime::run(
            &mut command,
            Some(input.as_bytes()),
            None,
            token,
            Duration::from_secs(90),
        )?;
        finalize_piper_wave(&wave)?;
        let reader = hound::WavReader::open(&wave)?;
        if reader.duration() == 0 {
            return Err(Error::Audio);
        }
        drop(reader);
        if !target.exists() {
            fs::rename(wave, &target)?;
        }
        self.prune_cache(512 * 1024 * 1024)?;
        Ok(target)
    }
    pub fn transcribe(&self, audio: &[f32], token: &Cancellation) -> Result<String> {
        if audio.len() < 1600 || !audio.iter().any(|x| x.abs() > 0.008) {
            return Err(Error::NoSpeech);
        }
        let directory = tempfile::tempdir_in(&self.cache)?;
        let input = directory.path().join("answer.wav");
        write_wav(&input, audio)?;
        let output = directory.path().join("transcript");
        let runtime = fluenta_runtime::runtime_directory(&self.resources, "whisper");
        let mut command = Command::new(fluenta_runtime::executable(&runtime, "whisper-cli")?);
        command
            .arg("-m")
            .arg(self.resources.join("models/ggml-small-q5_1.bin"))
            .arg("-f")
            .arg(&input)
            .args(["-l", "es", "-otxt", "-nt", "-ng", "-t"])
            .arg(fluenta_runtime::inference_threads().to_string())
            .arg("-of")
            .arg(&output);
        library_path(&mut command, &runtime);
        fluenta_runtime::run(&mut command, None, None, token, Duration::from_secs(180))?;
        let text = fs::read_to_string(output.with_extension("txt"))?
            .trim()
            .to_owned();
        if text.is_empty() || text.starts_with("[BLANK_AUDIO]") {
            return Err(Error::NoSpeech);
        }
        Ok(text)
    }
    pub fn play(&self, path: &Path, token: &Cancellation) -> Result<()> {
        let stream =
            rodio::OutputStreamBuilder::open_default_stream().map_err(|_| Error::Device)?;
        let sink = rodio::Sink::connect_new(stream.mixer());
        let source = rodio::Decoder::try_from(fs::File::open(path)?).map_err(|_| Error::Audio)?;
        sink.append(source);
        while !sink.empty() {
            if is_cancelled(token) {
                sink.stop();
                return Err(fluenta_runtime::Error::Cancelled.into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        Ok(())
    }
    fn prune_cache(&self, budget: u64) -> Result<()> {
        let mut entries = Vec::new();
        let mut total = 0;
        for entry in fs::read_dir(&self.cache)? {
            let entry = entry?;
            if entry.path().extension().is_none_or(|e| e != "wav") {
                continue;
            }
            let metadata = entry.metadata()?;
            total += metadata.len();
            entries.push((metadata.modified()?, metadata.len(), entry.path()));
        }
        entries.sort_by_key(|e| e.0);
        for (_, bytes, path) in entries {
            if total <= budget {
                break;
            }
            fs::remove_file(path)?;
            total = total.saturating_sub(bytes);
        }
        Ok(())
    }
}

// Piper 1.8's native CLI emits an IEEE-float stream with unknown RIFF/data
// lengths even when writing a file. Finalize only that pinned, exact format.
fn finalize_piper_wave(path: &Path) -> Result<()> {
    let mut file = fs::OpenOptions::new().read(true).write(true).open(path)?;
    let length = file.metadata()?.len();
    let mut header = [0_u8; 44];
    file.read_exact(&mut header)?;
    if !(48..=64 * 1024 * 1024).contains(&length)
        || &header[..4] != b"RIFF"
        || &header[8..16] != b"WAVEfmt "
        || &header[36..40] != b"data"
        || u16::from_le_bytes([header[20], header[21]]) != 3
        || u16::from_le_bytes([header[22], header[23]]) != 1
        || (length - 44) % 4 != 0
    {
        return Err(Error::Audio);
    }
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&((length - 8) as u32).to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write_all(&((length - 44) as u32).to_le_bytes())?;
    file.sync_all()?;
    Ok(())
}

pub fn write_wav(path: &Path, audio: &[f32]) -> Result<()> {
    let mut writer = hound::WavWriter::create(
        path,
        hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )?;
    for sample in audio {
        writer.write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
    }
    writer.finalize()?;
    Ok(())
}
pub fn read_wav(bytes: &[u8]) -> Result<Vec<f32>> {
    let reader = hound::WavReader::new(Cursor::new(bytes))?;
    let spec = reader.spec();
    if spec.channels != 1 || !(8000..=192000).contains(&spec.sample_rate) {
        return Err(Error::Audio);
    }
    let data = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 16) => reader
            .into_samples::<i16>()
            .map(|s| s.map(|s| s as f32 / i16::MAX as f32))
            .collect::<std::result::Result<Vec<_>, _>>()?,
        (hound::SampleFormat::Float, 32) => reader
            .into_samples::<f32>()
            .collect::<std::result::Result<Vec<_>, _>>()?,
        _ => return Err(Error::Audio),
    };
    if data.iter().any(|v| !v.is_finite()) {
        return Err(Error::Audio);
    }
    capture::resample(data, spec.sample_rate)
}
fn library_path(command: &mut Command, root: &Path) {
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", root.join("lib"));
    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", root.join("lib"));
    #[cfg(windows)]
    {
        let _ = (command, root);
    }
}
