use crate::{operations::*, service::Service};
use fluenta_contracts::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path},
    sync::Arc,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

impl From<zip::result::ZipError> for AppError {
    fn from(error: zip::result::ZipError) -> Self {
        eprintln!("Fluenta backup: {error}");
        Self(failure(
            ErrorCode::IntegrityFailure,
            "backup.invalid",
            false,
        ))
    }
}

impl Service {
    fn export_archive(&self, destination: &Path) -> ResultApp<()> {
        let staging = tempfile::tempdir_in(&self.directory)?;
        let backend = lock(&self.backend);
        backend
            .store
            .backup(&staging.path().join("student.sqlite"))?;
        let mut files = vec![(
            "student.sqlite".to_owned(),
            staging.path().join("student.sqlite"),
        )];
        for folder in ["courses", "recordings"] {
            for file in fs::read_dir(backend.store.directory.join(folder))? {
                let file = file?;
                if file.file_type()?.is_file() {
                    files.push((
                        format!("{folder}/{}", file.file_name().to_string_lossy()),
                        file.path(),
                    ));
                }
            }
        }
        drop(backend);
        let temporary = staging.path().join("export.fluenta");
        let mut zip = ZipWriter::new(File::create(&temporary)?);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut hashes = BTreeMap::new();
        for (name, path) in files {
            let bytes = fs::read(path)?;
            hashes.insert(name.clone(), format!("{:x}", Sha256::digest(&bytes)));
            zip.start_file(name, options)?;
            zip.write_all(&bytes)?;
        }
        zip.start_file("manifest.json", options)?;
        zip.write_all(
            serde_json::json!({"format":1,"files":hashes})
                .to_string()
                .as_bytes(),
        )?;
        zip.finish()?.sync_all()?;
        // Persist to a file in the destination directory, preserving any existing backup until completion.
        let mut target = tempfile::NamedTempFile::new_in(
            destination
                .parent()
                .ok_or_else(|| failure(ErrorCode::InvalidRequest, "backup.destination", false))?,
        )?;
        std::io::copy(&mut File::open(temporary)?, target.as_file_mut())?;
        target.as_file().sync_all()?;
        target
            .persist(destination)
            .map_err(|e| AppError::from(e.error))?;
        Ok(())
    }
    pub fn create_backup(self: &Arc<Self>, app: &tauri::AppHandle) -> ResultApp<Success> {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Fluenta backup", &["fluenta"])
            .set_file_name(format!("fluenta-{}.fluenta", fluenta_storage::now_ms()))
            .blocking_save_file()
        else {
            return Ok(Success::Accepted);
        };
        let destination = file
            .into_path()
            .map_err(|_| failure(ErrorCode::InvalidRequest, "backup.destination", false))?;
        let (id, _) = self.operations.begin(Kind::Backup, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = service.export_archive(&destination);
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
    pub fn restore_backup(self: &Arc<Self>, app: &tauri::AppHandle) -> ResultApp<Success> {
        for kind in [
            Kind::Recording,
            Kind::Playback,
            Kind::Tutor,
            Kind::Download,
            Kind::Backup,
        ] {
            if self.operations.current(kind).is_some() {
                return Err(failure(ErrorCode::Conflict, "operation.busy", true).into());
            }
        }
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Fluenta backup", &["fluenta"])
            .blocking_pick_file()
        else {
            return Ok(Success::Accepted);
        };
        let path = file
            .into_path()
            .map_err(|_| failure(ErrorCode::InvalidRequest, "backup.source", false))?;
        let locale = lock(&self.backend).store.settings()?.ui_language;
        let message = if locale == SourceLanguage::De {
            "Diese Sicherung ersetzt deinen Lernfortschritt und deine Einstellungen. Dein jetziger Stand wird vorher als recovery.fluenta gesichert. Fortfahren?"
        } else {
            "This backup will replace your progress and settings. Your current data will first be saved as recovery.fluenta. Continue?"
        };
        if !app
            .dialog()
            .message(message)
            .title("Fluenta")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
        {
            return Ok(Success::Accepted);
        }
        let (id, _) = self.operations.begin(Kind::Backup, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let staging = tempfile::tempdir_in(&service.directory)?;
                unpack(&path, staging.path())?;
                fluenta_storage::Store::validate_backup(&staging.path().join("student.sqlite"))?;
                // Validate the complete replacement before changing progress, adding any
                // courses bundled with a newer app to this temporary copy first.
                let replacement = crate::service::Backend::open(&service.resources, staging.path())
                    .map_err(|_| failure(ErrorCode::IntegrityFailure, "backup.invalid", false))?;
                service.export_archive(&service.directory.join("recovery.fluenta"))?;
                let mut backend = lock(&service.backend);
                for folder in ["courses", "recordings"] {
                    for entry in fs::read_dir(staging.path().join(folder))? {
                        let entry = entry?;
                        let target = backend.store.directory.join(folder).join(entry.file_name());
                        if target.exists() {
                            if Sha256::digest(fs::read(&target)?)
                                != Sha256::digest(fs::read(entry.path())?)
                            {
                                return Err(failure(
                                    ErrorCode::IntegrityFailure,
                                    "backup.file_collision",
                                    false,
                                )
                                .into());
                            }
                        } else {
                            fs::copy(entry.path(), target)?;
                        }
                    }
                }
                let mut catalog = replacement.catalog;
                drop(replacement.store);
                for pack in &mut catalog.packs {
                    pack.path = backend.store.directory.join("courses").join(
                        pack.path.file_name().ok_or_else(|| {
                            failure(ErrorCode::IntegrityFailure, "backup.invalid", false)
                        })?,
                    );
                }
                backend
                    .store
                    .restore_database(&staging.path().join("student.sqlite"))?;
                backend.catalog = catalog;
                Ok(())
            })();
            service
                .operations
                .finish(&operation, result.map_err(|e| e.0));
        });
        Ok(Success::OperationStarted { operation_id: id })
    }
}

fn unpack(source: &Path, destination: &Path) -> ResultApp<()> {
    for folder in ["courses", "recordings"] {
        fs::create_dir_all(destination.join(folder))?;
    }
    let mut archive = ZipArchive::new(File::open(source)?)?;
    if archive.len() > 10_000 {
        return Err(failure(ErrorCode::IntegrityFailure, "backup.too_large", false).into());
    }
    let mut total = 0_u64;
    let mut hashes = BTreeMap::new();
    let mut manifest = None;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name().to_owned();
        let path = Path::new(&name);
        let valid = match path.components().collect::<Vec<_>>().as_slice() {
            [Component::Normal(value)] => *value == "student.sqlite" || *value == "manifest.json",
            [Component::Normal(folder), Component::Normal(_)] => {
                (*folder == "courses" && path.extension().is_some_and(|e| e == "sqlite"))
                    || (*folder == "recordings" && path.extension().is_some_and(|e| e == "wav"))
            }
            _ => false,
        };
        total = total.saturating_add(file.size());
        if !valid
            || file.is_symlink()
            || file.is_dir()
            || total > 2 * 1024 * 1024 * 1024
            || file.size() > 512 * 1024 * 1024
        {
            return Err(failure(ErrorCode::IntegrityFailure, "backup.invalid", false).into());
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(512 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != file.size() {
            return Err(failure(ErrorCode::IntegrityFailure, "backup.invalid", false).into());
        }
        if name == "manifest.json" {
            if manifest.is_some() {
                return Err(failure(ErrorCode::IntegrityFailure, "backup.invalid", false).into());
            }
            manifest = Some(bytes);
            continue;
        }
        if hashes
            .insert(name.clone(), format!("{:x}", Sha256::digest(&bytes)))
            .is_some()
        {
            return Err(failure(ErrorCode::IntegrityFailure, "backup.invalid", false).into());
        }
        let target = destination.join(&name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(target, bytes)?;
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &manifest.ok_or_else(|| failure(ErrorCode::IntegrityFailure, "backup.invalid", false))?,
    )
    .map_err(|_| failure(ErrorCode::IntegrityFailure, "backup.invalid", false))?;
    if manifest["format"] != 1
        || manifest["files"] != serde_json::to_value(hashes).unwrap_or_default()
    {
        return Err(failure(ErrorCode::IntegrityFailure, "backup.invalid", false).into());
    }
    for folder in ["courses", "recordings"] {
        fs::create_dir_all(destination.join(folder))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_backup_preserves_progress_and_rejects_path_traversal() {
        let root = tempfile::tempdir().unwrap();
        let resources = root.path().join("resources");
        fluenta_content::compile_source(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../content/foundation"),
            &resources.join("courses"),
        )
        .unwrap();
        let service = Service::open(resources, root.path().join("original")).unwrap();
        {
            let backend = lock(&service.backend);
            let mut settings = backend.store.settings().unwrap();
            settings.daily_minutes = 45;
            backend.store.save_settings(settings).unwrap();
        }
        let path = root.path().join("archive.fluenta");
        assert!(service.export_archive(&path).is_ok());
        let extracted = root.path().join("extracted");
        assert!(unpack(&path, &extracted).is_ok());
        let mut restored = fluenta_storage::Store::open(&root.path().join("restored")).unwrap();
        restored
            .restore_database(&extracted.join("student.sqlite"))
            .unwrap();
        assert_eq!(restored.settings().unwrap().daily_minutes, 45);
        assert!(extracted.join("recordings").is_dir());
        let bad = root.path().join("bad.fluenta");
        let mut zip = ZipWriter::new(File::create(&bad).unwrap());
        zip.start_file("../outside.sqlite", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"invalid").unwrap();
        zip.finish().unwrap();
        assert!(unpack(&bad, &root.path().join("unsafe")).is_err());
        assert!(!root.path().join("outside.sqlite").exists());
    }
}
