use super::*;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::Resampler;
use std::{
    sync::{Arc, Mutex},
    thread,
};

pub struct Capture {
    stop: mpsc::Sender<()>,
    result: mpsc::Receiver<Result<Vec<f32>>>,
}
impl Capture {
    pub fn start(max_seconds: u32) -> Result<Self> {
        let (stop_tx, stop_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let result = (|| {
                let device = cpal::default_host()
                    .default_input_device()
                    .ok_or(Error::Device)?;
                let supported = device.default_input_config().map_err(|_| Error::Device)?;
                let rate = supported.sample_rate().0;
                let channels = usize::from(supported.channels());
                if rate > 192000 || channels == 0 {
                    return Err(Error::Device);
                }
                let limit = rate as usize * max_seconds.clamp(1, 300) as usize;
                let mut samples = Vec::new();
                samples.try_reserve_exact(limit).map_err(|_| Error::Audio)?;
                let samples = Arc::new(Mutex::new(samples));
                let failed = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let config = supported.config();
                let stream = match supported.sample_format() {
                    cpal::SampleFormat::F32 => input::<f32>(
                        &device,
                        &config,
                        samples.clone(),
                        failed.clone(),
                        channels,
                        limit,
                    ),
                    cpal::SampleFormat::I16 => input::<i16>(
                        &device,
                        &config,
                        samples.clone(),
                        failed.clone(),
                        channels,
                        limit,
                    ),
                    cpal::SampleFormat::U16 => input::<u16>(
                        &device,
                        &config,
                        samples.clone(),
                        failed.clone(),
                        channels,
                        limit,
                    ),
                    _ => return Err(Error::Device),
                }?;
                stream.play().map_err(|_| Error::Device)?;
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv_timeout(Duration::from_secs(u64::from(max_seconds)));
                drop(stream);
                if failed.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err(Error::Device);
                }
                let samples = std::mem::take(&mut *samples.lock().map_err(|_| Error::Audio)?);
                resample(samples, rate)
            })();
            if result.is_err() {
                let _ = ready_tx.send(Err(Error::Device));
            }
            let _ = result_tx.send(result);
        });
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| Error::Device)??;
        Ok(Self {
            stop: stop_tx,
            result: result_rx,
        })
    }
    pub fn stop(self) -> Result<Vec<f32>> {
        let _ = self.stop.send(());
        self.result
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| Error::Device)?
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

fn input<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    failed: Arc<std::sync::atomic::AtomicBool>,
    channels: usize,
    limit: usize,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    use cpal::Sample;
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if let Ok(mut buffer) = samples.lock() {
                    for frame in data.chunks_exact(channels) {
                        if buffer.len() >= limit {
                            break;
                        }
                        let mono = frame
                            .iter()
                            .map(|value| f32::from_sample(*value))
                            .sum::<f32>()
                            / channels as f32;
                        buffer.push(if mono.is_finite() {
                            mono.clamp(-1.0, 1.0)
                        } else {
                            0.0
                        });
                    }
                }
            },
            move |_| failed.store(true, std::sync::atomic::Ordering::Relaxed),
            None,
        )
        .map_err(|_| Error::Device)
}

pub(crate) fn resample(input: Vec<f32>, rate: u32) -> Result<Vec<f32>> {
    if rate == 16000 {
        return Ok(input);
    }
    if !(8000..=192000).contains(&rate) {
        return Err(Error::Audio);
    }
    let expected = input.len() * 16000 / rate as usize;
    let mut resampler = rubato::FftFixedInOut::<f32>::new(rate as usize, 16000, 1024, 1)
        .map_err(|_| Error::Audio)?;
    let chunk_size = resampler.input_frames_next();
    let delay = resampler.output_delay();
    let mut result = Vec::new();
    for chunk in input.chunks(chunk_size) {
        let mut padded = chunk.to_vec();
        padded.resize(chunk_size, 0.0);
        let output = resampler
            .process(&[padded], None)
            .map_err(|_| Error::Audio)?;
        result.extend_from_slice(&output[0]);
    }
    let tail = resampler
        .process(&[vec![0.0; chunk_size]], None)
        .map_err(|_| Error::Audio)?;
    result.extend_from_slice(&tail[0]);
    if result.len() < delay + expected {
        return Err(Error::Audio);
    }
    Ok(result[delay..delay + expected].to_vec())
}

#[cfg(test)]
mod tests {
    #[test]
    fn resampling_preserves_duration_and_silence() {
        let output = super::resample(vec![0.0; 48000], 48000).unwrap();
        assert_eq!(output.len(), 16000);
        assert!(output.iter().all(|x| x.abs() < 0.0001));
    }
}
