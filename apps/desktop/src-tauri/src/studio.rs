//! Compiled only with --features studio. File access is confined to a picked curriculum.
use crate::{operations::lock, service::Service};
use fluenta_contracts::{SourceLanguage, StudioRequest, StudioResponse};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct Workspace(Mutex<Option<PathBuf>>);
impl Workspace {
    pub fn from_args() -> Self {
        let args: Vec<_> = std::env::args_os().collect();
        let source = args
            .windows(2)
            .find(|pair| pair[0] == "--curriculum")
            .map(|pair| PathBuf::from(&pair[1]));
        Self(Mutex::new(source))
    }
}
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn inventory(root: &Path, directory: &Path, files: &mut Vec<String>, depth: usize) -> Result<()> {
    if depth > 5 || files.len() > 10_000 {
        return Err("Curriculum exceeds the editor's file/depth limit.".into());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err("Curriculum files cannot be symbolic links.".into());
        }
        if kind.is_dir() {
            inventory(root, &entry.path(), files, depth + 1)?;
        } else if entry.path().extension().is_some_and(|v| v == "json") {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}
fn document_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if relative.len() > 512
        || !path.components().all(|c| matches!(c, Component::Normal(_)))
        || path.extension().is_none_or(|v| v != "json")
    {
        return Err("Choose a JSON file from the curriculum.".into());
    }
    let target = root.join(path).canonicalize()?;
    if !target.starts_with(root)
        || (!target.starts_with(root.join("shared")) && !target.starts_with(root.join("locales")))
        || target.metadata()?.len() > 2 * 1024 * 1024
    {
        return Err("File is outside the curriculum or too large.".into());
    }
    Ok(target)
}
fn read_document(root: &Path, path: &str) -> Result<StudioResponse> {
    let file = document_path(root, path)?;
    Ok(StudioResponse::Document {
        path: path.into(),
        sha256: fluenta_content::release::digest(&file)?,
        text: fs::read_to_string(file)?,
    })
}

fn execute(app: tauri::AppHandle, request: StudioRequest) -> Result<StudioResponse> {
    let workspace = app.state::<Workspace>();
    let service = app.state::<Arc<Service>>();
    let mut source = lock(&workspace.0);
    if matches!(request, StudioRequest::Open | StudioRequest::Current) {
        let root = if matches!(request, StudioRequest::Current) {
            let Some(root) = source.as_ref() else {
                return Ok(StudioResponse::Cancelled);
            };
            root.canonicalize()?
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .set_title("Open a Fluenta curriculum folder")
                .blocking_pick_folder()
            else {
                return Ok(StudioResponse::Cancelled);
            };
            file.into_path()
                .map_err(|_| "Invalid folder")?
                .canonicalize()?
        };
        if !root.join("shared").is_dir()
            || !root.join("locales/en.json").is_file()
            || !root.join("locales/de.json").is_file()
        {
            return Err("Choose a curriculum folder containing shared/, locales/en.json and locales/de.json.".into());
        }
        let mut files = Vec::new();
        for folder in ["shared", "locales"] {
            inventory(&root, &root.join(folder), &mut files, 0)?;
        }
        files.sort();
        let result = StudioResponse::Workspace {
            root: root.to_string_lossy().into_owned(),
            files,
        };
        *source = Some(root);
        return Ok(result);
    }
    let root = source.as_ref().ok_or("Open a curriculum first.")?;
    match request {
        StudioRequest::Read { path } => read_document(root, &path),
        StudioRequest::Save {
            path,
            text,
            expected_sha256,
        } => {
            if text.len() > 2 * 1024 * 1024 {
                return Err("File exceeds 2 MiB.".into());
            }
            let _: serde_json::Value = serde_json::from_str(&text)?;
            let file = document_path(root, &path)?;
            if fluenta_content::release::digest(&file)? != expected_sha256 {
                return Err("This file changed in another editor. Reopen it before saving; your draft has been kept.".into());
            }
            let mut temporary =
                tempfile::NamedTempFile::new_in(file.parent().ok_or("Invalid file")?)?;
            temporary.write_all(text.as_bytes())?;
            temporary.as_file().sync_all()?;
            temporary.persist(file)?;
            read_document(root, &path)
        }
        StudioRequest::Validate => {
            let staging = tempfile::tempdir_in(&service.directory)?;
            let files = fluenta_content::compile_source(root, staging.path())?;
            let mut backend = lock(&service.backend);
            let mut active = std::collections::BTreeSet::new();
            for file in &files {
                let name = file.file_name().ok_or("Missing pack filename")?;
                active.insert(name.to_string_lossy().into_owned());
                let target = backend.store.directory.join("courses").join(name);
                if !target.exists() {
                    fs::copy(file, target)?;
                }
            }
            let mut catalog =
                fluenta_content::Catalog::open(&backend.store.directory.join("courses"))?;
            for pack in &mut catalog.packs {
                pack.active = pack
                    .path
                    .file_name()
                    .is_some_and(|n| active.contains(n.to_string_lossy().as_ref()));
            }
            let mut units = catalog.unit_overviews(SourceLanguage::De)?;
            units.extend(catalog.unit_overviews(SourceLanguage::En)?);
            backend
                .store
                .abandon_active_sessions(fluenta_storage::now_ms())?;
            backend.catalog = catalog;
            Ok(StudioResponse::Validated {
                packs: files.len() as u32,
                units,
            })
        }
        StudioRequest::Open | StudioRequest::Current => unreachable!(),
    }
}

#[tauri::command]
pub async fn studio_dispatch(
    app: tauri::AppHandle,
    request: StudioRequest,
) -> std::result::Result<StudioResponse, String> {
    tauri::async_runtime::spawn_blocking(move || execute(app, request).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_access_stays_inside_selected_source() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        fs::create_dir(root.join("shared")).unwrap();
        fs::write(root.join("shared/test.json"), "{}").unwrap();
        assert!(document_path(&root, "shared/test.json").is_ok());
        assert!(document_path(&root, "../secret.json").is_err());
        assert!(document_path(&root, "shared/../secret.json").is_err());
    }
}
