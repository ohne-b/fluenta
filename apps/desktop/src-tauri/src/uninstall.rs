use std::path::PathBuf;
use tauri::Manager;

fn uninstaller(app: &tauri::AppHandle) -> Option<PathBuf> {
    // A portable or development copy must never uninstall a separate installation.
    if !cfg!(target_os = "windows")
        || cfg!(debug_assertions)
        || cfg!(feature = "studio")
        || std::env::var_os("FLUENTA_DATA_DIR").is_some()
        || app.config().identifier != "org.fluenta.desktop"
    {
        return None;
    }
    let executable = std::env::current_exe().ok()?.canonicalize().ok()?;
    let candidate = executable.parent()?.join("uninstall.exe");
    candidate.is_file().then_some(candidate)
}

#[tauri::command]
pub fn can_uninstall(app: tauri::AppHandle) -> bool {
    uninstaller(&app).is_some()
}

#[tauri::command]
pub fn uninstall_app(app: tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    let executable = uninstaller(&app)
        .ok_or("Uninstall is only available in the Windows Setup installation.")?;
    let service = app.state::<std::sync::Arc<crate::service::Service>>();
    use crate::operations::Kind;
    if [
        Kind::Playback,
        Kind::Recording,
        Kind::Tutor,
        Kind::Download,
        Kind::Backup,
    ]
    .iter()
    .any(|kind| service.operations.current(*kind).is_some())
    {
        return Err("uninstall.busy".into());
    }
    let mut command = std::process::Command::new(executable);
    command.arg("/P").arg("/FLUENTA_FROM_APP");
    if remove_data {
        command.arg("/FLUENTA_REMOVE_DATA");
    }
    command.spawn().map_err(|error| error.to_string())?;
    service.operations.cancel_all();
    app.exit(0);
    Ok(())
}
