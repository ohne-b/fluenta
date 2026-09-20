mod backup;
mod courses;
mod operations;
mod service;
#[cfg(feature = "studio")]
mod studio;
mod uninstall;
mod workers;

use fluenta_contracts::*;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

fn open_service(
    app: &tauri::App,
    resources: std::path::PathBuf,
    directory: std::path::PathBuf,
) -> Result<service::Service, Box<dyn std::error::Error>> {
    match service::Service::open(resources.clone(), directory.clone()) {
        Ok(service) => Ok(service),
        Err(error) => {
            eprintln!("Fluenta startup failed: {error}");
            if cfg!(debug_assertions) && std::env::var_os("FLUENTA_HEADLESS").is_some() {
                return Err(error);
            }
            let learner = directory.join("learner");
            if fluenta_storage::Store::validate_backup(&learner.join("student.sqlite")).is_err()
                && let Ok(Some(snapshot)) = fluenta_storage::Store::latest_snapshot(&learner)
                && app.dialog().message("Fluenta cannot read its progress database. Restore the latest healthy daily snapshot? Recent progress may be missing. The current database will be kept in a recovery folder.\n\nFluenta kann den Lernfortschritt nicht lesen. Die letzte intakte tägliche Sicherung wiederherstellen? Neuere Fortschritte können fehlen. Die aktuelle Datenbank bleibt in einem Wiederherstellungsordner erhalten.")
                    .title("Fluenta · Recovery / Wiederherstellung").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancel).blocking_show() {
                    fluenta_storage::Store::recover_snapshot(&learner, &snapshot)?;
                    return service::Service::open(resources, directory);
                }
            app.dialog().message(format!("Fluenta could not open. Your local files have been kept.\nFluenta konnte nicht geöffnet werden. Deine lokalen Dateien bleiben erhalten.\n\n{}\n\n{error}", directory.display()))
                .title("Fluenta").kind(MessageDialogKind::Error).blocking_show();
            Err(error)
        }
    }
}

#[tauri::command]
async fn dispatch(
    request: Request,
    state: tauri::State<'_, Arc<service::Service>>,
    app: tauri::AppHandle,
) -> Result<Response, String> {
    let service = state.inner().clone();
    let id = request.request_id.clone();
    Ok(
        match tauri::async_runtime::spawn_blocking(move || service.handle(app, request)).await {
            Ok(response) => response,
            Err(error) => {
                eprintln!("Fluenta dispatcher: {error}");
                Response {
                    protocol_version: 1.try_into().unwrap(),
                    request_id: id,
                    result: ResponseResult::Error(operations::failure(
                        ErrorCode::StorageFailure,
                        "app.unexpected_error",
                        true,
                    )),
                }
            }
        },
    )
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            if std::env::var_os("FLUENTA_HEADLESS").is_some()
                && let Some(window) = app.get_webview_window("main")
            {
                window.hide()?;
            }
            let resources = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?
            };
            let directory = std::env::var_os("FLUENTA_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let service = Arc::new(open_service(app, resources, directory)?);
            #[cfg(feature = "studio")]
            {
                app.manage(studio::Workspace::from_args());
                let backend = operations::lock(&service.backend);
                let mut settings = backend.store.settings()?;
                settings.onboarding_complete = true;
                backend.store.save_settings(settings)?;
            }
            app.manage(service);
            Ok(())
        });
    #[cfg(feature = "studio")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        dispatch,
        studio::studio_dispatch,
        uninstall::can_uninstall,
        uninstall::uninstall_app
    ]);
    #[cfg(not(feature = "studio"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        dispatch,
        uninstall::can_uninstall,
        uninstall::uninstall_app
    ]);
    let app = builder.build(tauri::generate_context!()).expect(
        "Fluenta could not initialize. Check its local data directory and bundled resources.",
    );
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            app.state::<Arc<service::Service>>().operations.cancel_all();
        }
    });
}
