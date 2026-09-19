use fluenta_contracts::*;
use fluenta_runtime::{Cancellation, cancel};
use std::{
    collections::VecDeque,
    sync::{Mutex, MutexGuard},
};

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
pub fn failure(code: ErrorCode, key: &str, retryable: bool) -> Failure {
    Failure {
        code,
        message_key: key.into(),
        retryable,
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Playback,
    Recording,
    Tutor,
    Download,
    Backup,
}
struct Operation {
    id: Id,
    kind: Kind,
    session: Option<Id>,
    token: Cancellation,
    events: VecDeque<Event>,
    sequence: u32,
    terminal: bool,
}
#[derive(Default)]
pub struct Operations(Mutex<VecDeque<Operation>>);
impl Operations {
    pub fn begin(&self, kind: Kind, session: Option<Id>) -> Result<(Id, Cancellation), Failure> {
        let mut entries = lock(&self.0);
        if entries.iter().any(|v| v.kind == kind && !v.terminal) {
            return Err(failure(ErrorCode::Conflict, "operation.busy", true));
        }
        if entries.len() >= 128
            && let Some(index) = entries.iter().position(|v| v.terminal)
        {
            entries.remove(index);
        }
        let id = fluenta_storage::new_id();
        let token = Cancellation::default();
        entries.push_back(Operation {
            id: id.clone(),
            kind,
            session,
            token: token.clone(),
            events: VecDeque::new(),
            sequence: 0,
            terminal: false,
        });
        Ok((id, token))
    }
    pub fn emit(&self, id: &Id, event: OperationEvent) {
        let mut entries = lock(&self.0);
        if let Some(op) = entries.iter_mut().find(|v| v.id == *id) {
            if op.terminal {
                return;
            }
            op.terminal = matches!(
                event,
                OperationEvent::Finished | OperationEvent::Failed(_) | OperationEvent::Cancelled
            );
            op.sequence += 1;
            op.events.push_back(Event {
                operation_id: id.clone(),
                sequence: op.sequence,
                session_id: op.session.clone(),
                event,
            });
            if op.events.len() > 256 {
                op.events.pop_front();
            }
        }
    }
    pub fn finish(&self, id: &Id, result: Result<(), Failure>) {
        self.emit(
            id,
            match result {
                Ok(()) => OperationEvent::Finished,
                Err(e) if e.code == ErrorCode::Cancelled => OperationEvent::Cancelled,
                Err(e) => OperationEvent::Failed(e),
            },
        );
    }
    pub fn read(&self, id: &Id, after: u32) -> Result<Success, Failure> {
        let entries = lock(&self.0);
        let op = entries
            .iter()
            .find(|v| v.id == *id)
            .ok_or_else(|| failure(ErrorCode::NotFound, "operation.not_found", false))?;
        Ok(Success::OperationEvents {
            items: op
                .events
                .iter()
                .filter(|v| v.sequence > after)
                .cloned()
                .collect(),
            last_sequence: op.sequence,
            terminal: op.terminal,
        })
    }
    pub fn cancel(&self, id: &Id) {
        if let Some(op) = lock(&self.0).iter().find(|v| v.id == *id) {
            cancel(&op.token);
        }
    }
    pub fn cancel_kind(&self, kind: Kind) {
        for op in lock(&self.0)
            .iter()
            .filter(|v| v.kind == kind && !v.terminal)
        {
            cancel(&op.token);
        }
    }
    pub fn current(&self, kind: Kind) -> Option<Id> {
        lock(&self.0)
            .iter()
            .find(|v| v.kind == kind && !v.terminal)
            .map(|v| v.id.clone())
    }
    pub fn cancel_all(&self) {
        for op in lock(&self.0).iter() {
            cancel(&op.token);
        }
    }
}

impl From<fluenta_storage::Error> for AppError {
    fn from(error: fluenta_storage::Error) -> Self {
        use fluenta_storage::Error as E;
        let value = match &error {
            E::Invalid(key) => failure(ErrorCode::InvalidRequest, key, false),
            E::Conflict => failure(ErrorCode::Conflict, "state.conflict", true),
            E::Policy(key) => failure(ErrorCode::PolicyDenied, key, false),
            E::NotFound => failure(ErrorCode::NotFound, "content.not_found", false),
            _ => failure(ErrorCode::StorageFailure, "storage.failure", true),
        };
        eprintln!("Fluenta storage: {error}");
        Self(value)
    }
}
impl From<fluenta_content::Error> for AppError {
    fn from(error: fluenta_content::Error) -> Self {
        eprintln!("Fluenta content: {error}");
        Self(failure(ErrorCode::NotFound, "content.not_found", false))
    }
}
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        eprintln!("Fluenta filesystem: {error}");
        Self(failure(ErrorCode::StorageFailure, "storage.failure", true))
    }
}
impl From<fluenta_speech::Error> for AppError {
    fn from(error: fluenta_speech::Error) -> Self {
        use fluenta_speech::Error as E;
        let result = match error {
            E::Device => failure(
                ErrorCode::DeviceUnavailable,
                "speech.device_unavailable",
                true,
            ),
            E::NoSpeech => failure(ErrorCode::NoSpeech, "speech.no_speech", true),
            E::Worker(fluenta_runtime::Error::Cancelled) => {
                failure(ErrorCode::Cancelled, "operation.cancelled", true)
            }
            _ => failure(ErrorCode::WorkerUnavailable, "speech.failed", true),
        };
        eprintln!("Fluenta speech: {error}");
        Self(result)
    }
}
impl From<fluenta_tutor::Error> for AppError {
    fn from(error: fluenta_tutor::Error) -> Self {
        use fluenta_tutor::Error as E;
        let result = match error {
            E::NotInstalled => failure(ErrorCode::WorkerUnavailable, "tutor.not_installed", false),
            E::ContextTooLong => {
                failure(ErrorCode::InvalidRequest, "tutor.context_too_long", false)
            }
            E::InvalidResponse => {
                failure(ErrorCode::WorkerUnavailable, "tutor.invalid_response", true)
            }
            E::DiskSpace => failure(
                ErrorCode::InsufficientSpace,
                "download.insufficient_space",
                true,
            ),
            E::Integrity => failure(ErrorCode::IntegrityFailure, "download.integrity", true),
            E::Http(_) => failure(ErrorCode::DownloadFailure, "download.failed", true),
            E::Worker(fluenta_runtime::Error::Cancelled) => {
                failure(ErrorCode::Cancelled, "operation.cancelled", true)
            }
            _ => failure(ErrorCode::WorkerUnavailable, "tutor.failed", true),
        };
        eprintln!("Fluenta tutor: {error}");
        Self(result)
    }
}
pub struct AppError(pub Failure);
impl From<Failure> for AppError {
    fn from(value: Failure) -> Self {
        Self(value)
    }
}
pub type ResultApp<T> = Result<T, AppError>;
