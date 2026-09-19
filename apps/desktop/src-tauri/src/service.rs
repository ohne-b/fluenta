use crate::operations::*;
use fluenta_content::Catalog;
use fluenta_contracts::*;
use fluenta_storage::{Store, now_ms};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub struct Backend {
    pub store: Store,
    pub catalog: Catalog,
}
pub struct Service {
    pub backend: Mutex<Backend>,
    pub operations: Operations,
    pub speech: fluenta_speech::Speech,
    pub tutor: fluenta_tutor::Tutor,
    pub recording: Mutex<Option<crate::workers::RecordingJob>>,
    pub resources: PathBuf,
    pub directory: PathBuf,
    receipts: Mutex<VecDeque<(String, Response)>>,
}

impl Backend {
    pub fn open(resources: &Path, directory: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(directory.join("courses"))?;
        fs::create_dir_all(directory.join("recordings"))?;
        let mut active = BTreeSet::new();
        let selected: Vec<String> =
            serde_json::from_slice(&fs::read(resources.join("courses/active-releases.json"))?)?;
        for file in fs::read_dir(resources.join("courses"))? {
            let path = file?.path();
            if path.extension().is_none_or(|v| v != "sqlite") {
                continue;
            }
            let name = path.file_name().ok_or("invalid bundled course")?;
            if !selected
                .iter()
                .any(|s| s == name.to_string_lossy().as_ref())
            {
                continue;
            }
            let target = directory.join("courses").join(name);
            let bytes = fs::read(&path)?;
            if !fs::read(&target).is_ok_and(|v| Sha256::digest(v) == Sha256::digest(&bytes)) {
                let staging = target.with_extension("copying");
                fs::write(&staging, &bytes)?;
                // The bundled file is authoritative and never a student's progress database.
                if target.exists() {
                    fs::remove_file(&target)?;
                }
                fs::rename(staging, target)?;
            }
            active.insert(name.to_string_lossy().into_owned());
        }
        if active.is_empty() {
            return Err(
                "No compiled courses. Run npm run content:build before starting Fluenta.".into(),
            );
        }
        let store = Store::open(directory)?;
        let catalog = Self::catalog(resources, &store)?;
        Ok(Self { store, catalog })
    }
    pub fn catalog(resources: &Path, store: &Store) -> Result<Catalog, Box<dyn std::error::Error>> {
        Self::catalog_with_releases(resources, &store.directory, &store.installed_courses()?)
    }
    pub fn catalog_with_releases(
        resources: &Path,
        directory: &Path,
        releases: &[fluenta_content::release::Release],
    ) -> Result<Catalog, Box<dyn std::error::Error>> {
        let selected: Vec<String> =
            serde_json::from_slice(&fs::read(resources.join("courses/active-releases.json"))?)?;
        let mut catalog = Catalog::open(&directory.join("courses"))?;
        let mut active = std::collections::BTreeMap::new();
        for pack in &catalog.packs {
            if pack
                .path
                .file_name()
                .is_some_and(|n| selected.iter().any(|s| s == n.to_string_lossy().as_ref()))
            {
                active.insert(
                    (
                        pack.course.content.id.clone(),
                        pack.course.source_language.code(),
                    ),
                    (pack.course.content.revision, pack.release_id.clone()),
                );
            }
        }
        for installed in releases.iter().flat_map(|r| &r.files) {
            if !catalog.packs.iter().any(|p| {
                p.release_id == installed.release_id
                    && p.course.content == installed.course.content
                    && p.course.source_language == installed.course.source_language
            }) {
                return Err("An installed course is missing or has changed.".into());
            }
            let key = (
                installed.course.content.id.clone(),
                installed.course.source_language.code(),
            );
            if active
                .get(&key)
                .is_none_or(|(revision, _)| *revision <= installed.course.content.revision)
            {
                active.insert(
                    key,
                    (
                        installed.course.content.revision,
                        installed.release_id.clone(),
                    ),
                );
            }
        }
        for pack in &mut catalog.packs {
            pack.active = active
                .get(&(
                    pack.course.content.id.clone(),
                    pack.course.source_language.code(),
                ))
                .is_some_and(|(_, id)| *id == pack.release_id);
        }
        if !catalog.packs.iter().any(|p| p.active) {
            return Err("No active curriculum is available.".into());
        }
        Ok(catalog)
    }
}

impl Service {
    pub fn open(
        resources: PathBuf,
        directory: PathBuf,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&directory)?;
        let backend = Backend::open(&resources, &directory.join("learner"))?;
        if let Err(error) = backend.store.daily_snapshot(now_ms()) {
            eprintln!("Fluenta daily snapshot could not be saved: {error}");
        }
        Ok(Self {
            backend: Mutex::new(backend),
            operations: Operations::default(),
            speech: fluenta_speech::Speech::new(resources.clone(), directory.join("cache/speech"))?,
            tutor: fluenta_tutor::Tutor::new(
                fluenta_runtime::runtime_directory(&resources, "llama"),
                directory.join("models"),
            )?,
            recording: Mutex::new(None),
            resources,
            directory,
            receipts: Mutex::default(),
        })
    }
    pub fn handle(self: &Arc<Self>, app: tauri::AppHandle, request: Request) -> Response {
        let mut receipts = lock(&self.receipts);
        let encoded = serde_json::to_string(&request).unwrap_or_default();
        if let Some((prior, response)) = receipts
            .iter()
            .find(|(_, v)| v.request_id == request.request_id)
        {
            if prior == &encoded {
                return response.clone();
            }
            return Response {
                protocol_version: 1.try_into().unwrap(),
                request_id: request.request_id,
                result: ResponseResult::Error(failure(
                    ErrorCode::InvalidRequest,
                    "request.id_reused",
                    false,
                )),
            };
        }
        let result = if request.protocol_version.get() != 1 {
            Err(AppError(failure(
                ErrorCode::UnsupportedVersion,
                "app.update_required",
                false,
            )))
        } else {
            self.execute(&app, request.command)
        };
        let response = Response {
            protocol_version: 1.try_into().unwrap(),
            request_id: request.request_id,
            result: match result {
                Ok(v) => ResponseResult::Ok(Box::new(v)),
                Err(e) => ResponseResult::Error(e.0),
            },
        };
        if receipts.len() >= 256 {
            receipts.pop_front();
        }
        receipts.push_back((encoded, response.clone()));
        response
    }
    fn execute(self: &Arc<Self>, app: &tauri::AppHandle, command: Command) -> ResultApp<Success> {
        if self.operations.current(Kind::Backup).is_some()
            && !matches!(
                command,
                Command::ReadOperation { .. }
                    | Command::CancelOperation { .. }
                    | Command::StopPlayback
                    | Command::GetDownloads
                    | Command::GetSettings
            )
        {
            return Err(failure(ErrorCode::Conflict, "operation.busy", true).into());
        }
        match command {
            Command::OpenSource { url } => {
                lock(&self.backend).store.mark_assistance(None)?;
                crate::workers::open_source(&url)?;
                Ok(Success::Accepted)
            }
            Command::ReadOperation {
                operation_id,
                after_sequence,
            } => Ok(self.operations.read(&operation_id, after_sequence)?),
            Command::CancelOperation { operation_id } => {
                self.operations.cancel(&operation_id);
                let mut recording = lock(&self.recording);
                if recording.as_ref().is_some_and(|r| r.id == operation_id) {
                    recording.take();
                    self.operations
                        .emit(&operation_id, OperationEvent::Cancelled);
                }
                Ok(Success::Accepted)
            }
            Command::StopPlayback => {
                self.operations.cancel_kind(Kind::Playback);
                Ok(Success::Accepted)
            }
            Command::StartRecording { context } => self.start_recording(context),
            Command::StartTutorRecording => self.start_tutor_recording(),
            Command::StopRecording { operation_id } => self.stop_recording(operation_id),
            Command::Synthesize {
                segment,
                slow,
                context,
            } => self.synthesize(segment, slow, context),
            Command::PlayRecording { recording_id } => self.play_recording(recording_id),
            Command::SpeakTutor {
                thread_id,
                turn_index,
                slow,
            } => self.speak_tutor(thread_id, turn_index, slow),
            Command::StartTutorTurn {
                thread_id,
                mode,
                message,
                session_id,
            } => self.tutor_turn(thread_id, mode, message, session_id),
            Command::InstallPack { release_id } => self.install_model(release_id),
            Command::GetDownloads => Ok(Success::Downloads(self.downloads())),
            Command::RemoveTutor => {
                if self.operations.current(Kind::Download).is_some()
                    || self.operations.current(Kind::Tutor).is_some()
                {
                    return Err(failure(ErrorCode::Conflict, "operation.busy", true).into());
                }
                self.tutor.remove()?;
                Ok(Success::Accepted)
            }
            Command::CreateBackup => self.create_backup(app),
            Command::RestoreBackup => self.restore_backup(app),
            Command::ImportCourses => self.import_courses(app),
            command => {
                let mut backend = lock(&self.backend);
                let Backend { store, catalog } = &mut *backend;
                let now = now_ms();
                Ok(match command {
                    Command::GetOverview => {
                        Success::Overview(store.overview(catalog, self.tutor.installed(), now)?)
                    }
                    Command::GetHome => {
                        let o = store.overview(catalog, self.tutor.installed(), now)?;
                        Success::Home(HomeView {
                            source_language: o.settings.source_language,
                            continue_session_id: o.continue_session,
                            recommended_lesson: o.recommended_lesson,
                            due_reviews: o.due_reviews,
                            tutor_installed: o.tutor_installed,
                        })
                    }
                    Command::GetSettings => Success::Settings(store.settings()?),
                    Command::UpdateSettings { settings } => {
                        Success::Settings(store.save_settings(settings)?)
                    }
                    Command::SelectSourceLanguage { source_language } => {
                        let mut settings = store.settings()?;
                        settings.source_language = source_language;
                        Success::Settings(store.save_settings(settings)?)
                    }
                    Command::ListUnits {
                        source_language,
                        band,
                        cursor,
                    } => {
                        let (items, next_cursor) =
                            catalog.units_page(source_language, band, cursor.as_deref())?;
                        Success::Units { items, next_cursor }
                    }
                    Command::SearchContent {
                        query,
                        source_language,
                        cursor,
                    } => {
                        store.mark_assistance(None)?;
                        let (items, next_cursor) =
                            catalog.search_page(source_language, &query, cursor.as_deref())?;
                        Success::Search { items, next_cursor }
                    }
                    Command::ListGrammar { source_language } => {
                        store.check_reference_access()?;
                        Success::Grammar(catalog.grammar(source_language)?)
                    }
                    Command::GetGrammarHelp { context } => {
                        store.mark_assistance(Some(&context))?;
                        let snapshot = store.snapshot(&context.session_id)?;
                        let SessionState::Active { step } = snapshot.session else {
                            return Err(
                                failure(ErrorCode::Conflict, "session.changed", true).into()
                            );
                        };
                        Success::GrammarHelp(
                            catalog.grammar_help(&snapshot.release_id, &step.activity.content)?,
                        )
                    }
                    Command::GetLesson {
                        content,
                        source_language,
                    } => {
                        let pack = catalog.locate(source_language, &content)?;
                        Success::Lesson(catalog.get(&pack.release_id, &content, "lesson")?)
                    }
                    Command::Connected(command) => {
                        Success::Connected(Box::new(store.connected(catalog, command, now)?))
                    }
                    Command::GetReference {
                        content,
                        source_language,
                    } => Success::Reference(store.reference(catalog, source_language, &content)?),
                    Command::StartSession {
                        source_language,
                        mode,
                        target,
                        skill,
                    } => Success::Session(store.start_filtered_session(
                        catalog,
                        source_language,
                        mode,
                        &target,
                        skill,
                        now,
                    )?),
                    Command::ResumeSession { session_id } => {
                        Success::Session(store.resume(&session_id, now)?)
                    }
                    Command::SaveDraft {
                        context,
                        sequence,
                        answer,
                    } => Success::DraftSaved {
                        accepted_sequence: store.save_draft(&context, sequence, &answer, now)?,
                    },
                    Command::SubmitAnswer(submission) => {
                        Success::Session(store.submit(catalog, &submission, now)?)
                    }
                    Command::AdvanceSession {
                        context,
                        mutation_id,
                    } => Success::Session(store.advance(&context, &mutation_id, now)?),
                    Command::RevealHint {
                        context,
                        mutation_id,
                    } => {
                        let (material, session) =
                            store.hint(catalog, &context, &mutation_id, now)?;
                        Success::Hint { material, session }
                    }
                    Command::KeyboardAlternative { context } => {
                        Success::Session(store.keyboard_alternative(catalog, &context)?)
                    }
                    Command::GetSessionReview { session_id } => {
                        Success::SessionReview(store.session_review(&session_id)?)
                    }
                    Command::AbandonSession { session_id } => {
                        store.abandon(&session_id, now)?;
                        Success::Accepted
                    }
                    Command::ListTutorThreads => {
                        store.check_reference_access()?;
                        Success::TutorThreads(store.tutor_threads()?)
                    }
                    Command::GetTutorThread { thread_id } => {
                        store.mark_assistance(None)?;
                        Success::TutorThread(store.tutor_thread(&thread_id)?)
                    }
                    Command::DeleteTutorThread { thread_id } => {
                        if self.operations.current(Kind::Tutor).is_some() {
                            return Err(failure(ErrorCode::Conflict, "operation.busy", true).into());
                        }
                        store.delete_tutor_thread(&thread_id)?;
                        Success::Accepted
                    }
                    Command::ListBookmarks { source_language } => {
                        store.check_reference_access()?;
                        Success::Bookmarks(store.bookmarks(catalog, source_language)?)
                    }
                    Command::ToggleBookmark {
                        content,
                        source_language,
                    } => {
                        let pack = catalog.locate(source_language, &content)?;
                        let _: Material = catalog.get(&pack.release_id, &content, "material")?;
                        store.toggle_bookmark(source_language, &content)?;
                        Success::Accepted
                    }
                    _ => {
                        return Err(failure(
                            ErrorCode::InvalidRequest,
                            "request.unsupported",
                            false,
                        )
                        .into());
                    }
                })
            }
        }
    }
    fn downloads(&self) -> Downloads {
        let (tts, asr) = self.speech.available();
        Downloads {
            items: vec![
                DownloadItem {
                    id: "piper-es".into(),
                    title: "Spanish voice · Piper".into(),
                    installed: tts,
                    bytes: "63201294".into(),
                    required: true,
                    license: "GPL-3.0-or-later runtime · CC0 voice data".into(),
                },
                DownloadItem {
                    id: "whisper-small".into(),
                    title: "Spanish speech recognition · Whisper Small".into(),
                    installed: asr,
                    bytes: "190085487".into(),
                    required: true,
                    license: "MIT".into(),
                },
                DownloadItem {
                    id: fluenta_tutor::MODEL.id.clone(),
                    title: fluenta_tutor::MODEL.title.clone(),
                    installed: self.tutor.installed(),
                    bytes: fluenta_tutor::MODEL.bytes.to_string(),
                    required: false,
                    license: "Apache-2.0".into(),
                },
            ],
            available_bytes: self.tutor.available_bytes().to_string(),
            tutor_operation: self.operations.current(Kind::Download),
        }
    }
}
