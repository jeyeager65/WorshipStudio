mod commands;
mod domain;
mod models;
mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::songs::list_songs,
            commands::songs::get_song,
            commands::songs::save_song,
            commands::songs::delete_song,
            commands::songs::import_song_opensong_xml,
            commands::services::list_services,
            commands::services::get_service,
            commands::services::save_service,
            commands::services::delete_service,
            commands::services::list_upcoming_services,
            commands::slides::list_slides,
            commands::slides::get_slide,
            commands::slides::save_slide,
            commands::slides::delete_slide,
            commands::settings::get_library_settings,
            commands::settings::save_library_settings,
            commands::settings::get_machine_settings,
            commands::settings::save_machine_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
