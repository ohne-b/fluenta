use crate::{
    operations::*,
    service::{Backend, Service},
};
use fluenta_content::release::{check_revision_compatibility, decode_key, digest, verify_unpack};
use fluenta_contracts::*;
use std::{fs, sync::Arc};
use tauri_plugin_dialog::DialogExt;

impl Service {
    pub fn import_courses(self: &Arc<Self>, app: &tauri::AppHandle) -> ResultApp<Success> {
        if self.operations.current(Kind::Backup).is_some() {
            return Err(failure(ErrorCode::Conflict, "operation.busy", true).into());
        }
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Fluenta course release", &["fluentacourse"])
            .blocking_pick_file()
        else {
            return Ok(Success::Accepted);
        };
        let path = file
            .into_path()
            .map_err(|_| failure(ErrorCode::InvalidRequest, "courses.invalid", false))?;
        let (id, _) = self.operations.begin(Kind::Backup, None)?;
        let service = self.clone();
        let operation = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| -> ResultApp<()> {
                let staging = tempfile::tempdir_in(&service.directory)?;
                let public = decode_key(include_str!("../../../../config/content-public-key.txt"))?;
                let release = verify_unpack(&path, staging.path(), &public).map_err(|error| {
                    eprintln!("Fluenta content release: {error}");
                    AppError(failure(
                        ErrorCode::IntegrityFailure,
                        "courses.invalid",
                        false,
                    ))
                })?;
                let mut backend = lock(&service.backend);
                let installed = backend.store.installed_courses()?;
                for next in &release.files {
                    for prior in &installed {
                        if prior.files.iter().any(|p| {
                            p.course.content.id == next.course.content.id
                                && p.course.source_language == next.course.source_language
                        }) && release.sequence <= prior.sequence
                        {
                            return Err(failure(
                                ErrorCode::Conflict,
                                "courses.older_release",
                                false,
                            )
                            .into());
                        }
                    }
                    for prior in backend.catalog.packs.iter().filter(|p| {
                        p.course.source_language == next.course.source_language
                            && p.course.content.id == next.course.content.id
                    }) {
                        if prior.active
                            && prior.course.content.revision > next.course.content.revision
                        {
                            return Err(failure(
                                ErrorCode::Conflict,
                                "courses.older_release",
                                false,
                            )
                            .into());
                        }
                        check_revision_compatibility(&prior.path, &staging.path().join(&next.name))
                            .map_err(|_| {
                                failure(
                                    ErrorCode::IntegrityFailure,
                                    "courses.revision_conflict",
                                    false,
                                )
                            })?;
                    }
                }
                for next in &release.files {
                    let target = backend.store.directory.join("courses").join(&next.name);
                    if target.exists() {
                        if digest(&target)? != next.sha256 {
                            return Err(failure(
                                ErrorCode::IntegrityFailure,
                                "courses.invalid",
                                false,
                            )
                            .into());
                        }
                    } else {
                        fs::rename(staging.path().join(&next.name), target)?;
                    }
                }
                let mut candidate = installed;
                for prior in &mut candidate {
                    prior.files.retain(|old| {
                        !release.files.iter().any(|new| {
                            new.course.content.id == old.course.content.id
                                && new.course.source_language == old.course.source_language
                        })
                    });
                }
                candidate.push(release.clone());
                let catalog = Backend::catalog_with_releases(
                    &service.resources,
                    &backend.store.directory,
                    &candidate,
                )
                .map_err(|_| failure(ErrorCode::IntegrityFailure, "courses.invalid", false))?;
                backend.store.activate_courses(release)?;
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
