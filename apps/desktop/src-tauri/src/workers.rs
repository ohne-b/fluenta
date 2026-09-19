use crate::{operations::*, service::Service};
use fluenta_contracts::*;
use fluenta_runtime::{Cancellation, is_cancelled};
use fluenta_storage::now_ms;
use std::{path::PathBuf, sync::Arc};

fn source_url(value: &str) -> ResultApp<tauri::Url> {
    let url = tauri::Url::parse(value)
        .map_err(|_| failure(ErrorCode::InvalidRequest, "content.invalid_source", false))?;
    if value.len() > 2048
        || value.contains('\0')
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(failure(ErrorCode::InvalidRequest, "content.invalid_source", false).into());
    }
    Ok(url)
}

pub fn open_source(value: &str) -> ResultApp<()> {
    let url = source_url(value)?;
    // Pass a validated HTTPS URL as an argument to the platform handler, never a shell command.
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("rundll32.exe");
        command
            .arg("url.dll,FileProtocolHandler")
            .creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    let mut child = command.arg(url.as_str()).spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

pub struct RecordingJob {
    pub id: Id,
    pub context: Option<MutationContext>,
    pub capture: fluenta_speech::Capture,
    pub open: bool,
    pub token: Cancellation,
}

impl Service {
    pub fn start_recording(self: &Arc<Self>, context: MutationContext) -> ResultApp<Success> {
        let (_, open, seconds) = lock(&self.backend)
            .store
            .validate_recording_context(&context)?;
        self.capture(Some(context), open, seconds)
    }
    pub fn start_tutor_recording(self: &Arc<Self>) -> ResultApp<Success> {
        lock(&self.backend).store.check_reference_access()?;
        self.capture(None, false, 30)
    }
    fn capture(
        self: &Arc<Self>,
        context: Option<MutationContext>,
        open: bool,
        seconds: u32,
    ) -> ResultApp<Success> {
        if lock(&self.recording).is_some() || self.operations.current(Kind::Playback).is_some() {
            return Err(failure(ErrorCode::Conflict, "speech.stop_playback_first", true).into());
        }
        let (id, token) = self.operations.begin(
            Kind::Recording,
            context.as_ref().map(|v| v.session_id.clone()),
        )?;
        match fluenta_speech::Capture::start(seconds) {
            Ok(capture) => {
                *lock(&self.recording) = Some(RecordingJob {
                    id: id.clone(),
                    context,
                    capture,
                    open,
                    token,
                });
                self.operations.emit(&id, OperationEvent::RecordingStarted);
                let service = self.clone();
                let auto_id = id.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(u64::from(seconds))).await;
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        service.stop_recording(auto_id)
                    })
                    .await;
                });
                Ok(Success::OperationStarted { operation_id: id })
            }
            Err(error) => {
                let error = AppError::from(error);
                self.operations.finish(&id, Err(error.0.clone()));
                Err(error)
            }
        }
    }
    pub fn stop_recording(self: &Arc<Self>, id: Id) -> ResultApp<Success> {
        let mut recording = lock(&self.recording);
        if !recording.as_ref().is_some_and(|r| r.id == id) {
            return Err(failure(ErrorCode::NotFound, "recording.not_found", false).into());
        }
        let job = recording
            .take()
            .ok_or_else(|| failure(ErrorCode::NotFound, "recording.not_found", false))?;
        drop(recording);
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let samples = job.capture.stop()?;
                if is_cancelled(&job.token) {
                    return Err(failure(ErrorCode::Cancelled, "operation.cancelled", true).into());
                }
                if job.open {
                    let context = job.context.ok_or_else(|| {
                        failure(
                            ErrorCode::InvalidRequest,
                            "recording.invalid_context",
                            false,
                        )
                    })?;
                    if samples.len() < 1600 {
                        return Err(failure(ErrorCode::NoSpeech, "speech.no_speech", true).into());
                    }
                    let name = format!("{}.wav", fluenta_storage::new_id());
                    let backend = lock(&service.backend);
                    let path = backend.store.directory.join("recordings").join(&name);
                    fluenta_speech::write_wav(&path, &samples)?;
                    let duration =
                        (samples.len() as u64 * 1000 / 16000).min(u64::from(u32::MAX)) as u32;
                    let registered = backend.store.register_recording(
                        &context,
                        std::path::Path::new(&name),
                        duration,
                    );
                    if registered.is_err() {
                        let _ = std::fs::remove_file(path);
                    }
                    let recording_id = registered?;
                    service.operations.emit(
                        &operation,
                        OperationEvent::RecordingReady {
                            recording_id,
                            session_id: context.session_id,
                            step_id: context.step_id,
                            duration_milliseconds: duration,
                        },
                    );
                } else {
                    let text = service.speech.transcribe(&samples, &job.token)?;
                    if is_cancelled(&job.token) {
                        return Err(
                            failure(ErrorCode::Cancelled, "operation.cancelled", true).into()
                        );
                    }
                    if let Some(context) = job.context {
                        let recognition = lock(&service.backend)
                            .store
                            .register_recognition(&context, &text)?;
                        service
                            .operations
                            .emit(&operation, OperationEvent::RecognitionReady(recognition));
                    } else {
                        lock(&service.backend).store.check_reference_access()?;
                        service.operations.emit(
                            &operation,
                            OperationEvent::TranscriptReady { transcript: text },
                        );
                    }
                }
                Ok(())
            })();
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::Accepted)
    }
    pub fn synthesize(
        self: &Arc<Self>,
        segment: ContentRef,
        slow: bool,
        context: Option<MutationContext>,
    ) -> ResultApp<Success> {
        if self.operations.current(Kind::Recording).is_some() {
            return Err(failure(ErrorCode::Conflict, "speech.stop_recording_first", true).into());
        }
        let (id, token) = self.operations.begin(
            Kind::Playback,
            context.as_ref().map(|v| v.session_id.clone()),
        )?;
        let prepared = (|| -> ResultApp<String> {
            let backend = lock(&self.backend);
            if !backend.store.settings()?.audio_enabled {
                return Err(failure(ErrorCode::PolicyDenied, "speech.disabled", false).into());
            }
            let release = backend.store.speech_release(
                &backend.catalog,
                &segment,
                context.as_ref(),
                now_ms(),
            )?;
            let speech: SpeechSegment = backend.catalog.get(&release, &segment, "speech")?;
            Ok(speech.pronunciation_override.unwrap_or(speech.text))
        })();
        let text = match prepared {
            Ok(v) => v,
            Err(error) => {
                self.operations.finish(&id, Err(error.0.clone()));
                return Err(error);
            }
        };
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let path = match service.speech.synthesize(&text, slow, &token) {
                    Ok(path) => path,
                    Err(error) => {
                        if let Some(context) = &context {
                            let _ = lock(&service.backend).store.refund_audio(context);
                        }
                        return Err(error.into());
                    }
                };
                service.speech.play(&path, &token)?;
                Ok(())
            })();
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
    pub fn play_recording(self: &Arc<Self>, recording_id: Id) -> ResultApp<Success> {
        let path = lock(&self.backend).store.recording_path(&recording_id)?;
        self.play_file(path)
    }
    pub fn speak_tutor(
        self: &Arc<Self>,
        thread_id: Id,
        index: u32,
        slow: bool,
    ) -> ResultApp<Success> {
        let text = {
            let backend = lock(&self.backend);
            backend.store.mark_assistance(None)?;
            if !backend.store.settings()?.audio_enabled {
                return Err(failure(ErrorCode::PolicyDenied, "speech.disabled", false).into());
            }
            let detail = backend.store.tutor_thread(&thread_id)?;
            let turn = detail
                .turns
                .get(index as usize)
                .filter(|t| t.role == "assistant")
                .ok_or_else(|| failure(ErrorCode::NotFound, "tutor.turn_missing", false))?;
            turn.text.clone()
        };
        if self.operations.current(Kind::Recording).is_some() {
            return Err(failure(ErrorCode::Conflict, "speech.stop_recording_first", true).into());
        }
        let (id, token) = self.operations.begin(Kind::Playback, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let path = service.speech.synthesize(&text, slow, &token)?;
                service.speech.play(&path, &token)?;
                Ok(())
            })();
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
    fn play_file(self: &Arc<Self>, path: PathBuf) -> ResultApp<Success> {
        if self.operations.current(Kind::Recording).is_some() {
            return Err(failure(ErrorCode::Conflict, "speech.stop_recording_first", true).into());
        }
        let (id, token) = self.operations.begin(Kind::Playback, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            service.operations.finish(
                &operation,
                service
                    .speech
                    .play(&path, &token)
                    .map_err(|e| AppError::from(e).0),
            );
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
    pub fn install_model(self: &Arc<Self>, release: Id) -> ResultApp<Success> {
        if release.as_str() != fluenta_tutor::MODEL.id {
            return Err(failure(ErrorCode::NotFound, "download.unknown_pack", false).into());
        }
        let (id, token) = self.operations.begin(Kind::Download, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn(async move {
            let result = service
                .tutor
                .install(&token, |completed, total| {
                    service.operations.emit(
                        &operation,
                        OperationEvent::Progress {
                            completed_bytes: completed.to_string(),
                            total_bytes: Some(total.to_string()),
                        },
                    )
                })
                .await;
            service
                .operations
                .finish(&operation, result.map_err(|e| AppError::from(e).0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
    pub fn tutor_turn(
        self: &Arc<Self>,
        thread_id: Option<Id>,
        mode: TutorMode,
        message: String,
        session_id: Option<Id>,
    ) -> ResultApp<Success> {
        if !self.tutor.installed() {
            return Err(failure(ErrorCode::WorkerUnavailable, "tutor.not_installed", false).into());
        }
        if message.trim().is_empty() || message.len() > 3000 {
            return Err(failure(ErrorCode::InvalidRequest, "tutor.message_length", false).into());
        }
        let (context, history, mutation) = {
            let backend = lock(&self.backend);
            backend.store.check_reference_access()?;
            let settings = backend.store.settings()?;
            let mut context = TutorContext {
                source_language: settings.source_language,
                band: settings.starting_band,
                mode,
                objective: None,
                visible_task: None,
                submitted_answer: None,
                references: Vec::new(),
                solution_revealed: false,
            };
            let mut mutation = None;
            if let Some(session_id) = &session_id {
                let snapshot = backend.store.snapshot(session_id)?;
                if !snapshot.policy.tutor_allowed {
                    return Err(
                        failure(ErrorCode::PolicyDenied, "test.tutor_unavailable", false).into(),
                    );
                }
                context.source_language = snapshot.source_language;
                context.band = backend.catalog.pack(&snapshot.release_id)?.course.band;
                if let SessionState::Active { step } = snapshot.session {
                    mutation = Some(MutationContext {
                        session_id: session_id.clone(),
                        step_id: step.step_id.clone(),
                        expected_step_version: step.version,
                    });
                    context.solution_revealed = matches!(step.phase, StepPhase::Feedback);
                    if context.solution_revealed {
                        context.submitted_answer = step.draft.clone();
                    }
                    let activity: Activity = backend.catalog.get(
                        &snapshot.release_id,
                        &step.activity.content,
                        "activity",
                    )?;
                    context.objective = activity.objectives.first().cloned();
                    // Context comes from the answer-free persisted projection, never the evaluator's task.
                    context.visible_task = Some(step.activity.clone());
                    for material in &step.activity.visible_materials {
                        let text = fluenta_content::plain_text(
                            &serde_json::to_value(material).unwrap_or_default(),
                        );
                        if !text.is_empty() {
                            context.references.push(ReferenceExcerpt {
                                content: material.content.clone(),
                                text: Text {
                                    annotations: vec![],
                                    language: context.source_language.language(),
                                    text: text.chars().take(450).collect(),
                                },
                            });
                        }
                    }
                }
            }
            if context.references.is_empty() {
                for hit in backend
                    .catalog
                    .related_references(context.source_language, &message)?
                    .into_iter()
                    .take(2)
                {
                    context.references.push(ReferenceExcerpt {
                        content: hit.content,
                        text: hit.excerpt,
                    });
                }
            }
            context.references.truncate(3);
            // Large reading passages stay in the lesson. Excerpts bound RAM and prompt time.
            if let Some(task) = &mut context.visible_task {
                task.visible_materials.clear();
            }
            let history = if let Some(id) = &thread_id {
                let detail = backend.store.tutor_thread(id)?;
                if detail.thread.source_language != context.source_language {
                    return Err(failure(
                        ErrorCode::InvalidRequest,
                        "tutor.language_mismatch",
                        false,
                    )
                    .into());
                }
                detail.turns
            } else {
                Vec::new()
            };
            (context, history, mutation)
        };
        let (id, token) = self.operations.begin(Kind::Tutor, session_id)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let reply = service
                    .tutor
                    .generate(&context, &history, &message, &token)?;
                if is_cancelled(&token) {
                    return Err(failure(ErrorCode::Cancelled, "operation.cancelled", true).into());
                }
                let mut backend = lock(&service.backend);
                backend.store.mark_assistance(mutation.as_ref())?;
                let refs = context
                    .references
                    .iter()
                    .filter(|r| reply.reference_ids.contains(&r.content.id))
                    .map(|r| r.content.clone())
                    .collect();
                let thread_id = backend.store.save_tutor_exchange(
                    thread_id.as_ref(),
                    context.source_language,
                    &message,
                    &reply,
                    refs,
                    now_ms(),
                )?;
                service
                    .operations
                    .emit(&operation, OperationEvent::TutorReady { thread_id, reply });
                Ok(())
            })();
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
}

#[cfg(test)]
mod source_tests {
    #[test]
    fn external_sources_cannot_invoke_local_or_script_protocols() {
        for url in [
            "file:///C:/Windows/system32/calc.exe",
            "javascript:alert(1)",
            "https://user:pass@example.org/",
            "https://example.org/\0",
        ] {
            assert!(super::source_url(url).is_err());
        }
        assert!(super::source_url("https://www.isb.bayern.de/?a=1&b=2").is_ok());
    }
}
