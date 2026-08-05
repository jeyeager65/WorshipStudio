mod commands;
mod domain;
mod models;
mod paths;
mod remote_server;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Local-dev convenience only (e.g. ESV_API_KEY — see docs/release-process.md and
    // commands::scripture) — silently no-ops if missing, which is the normal case for a
    // packaged build. CWD differs between `cargo run` (src-tauri/) and other invocations, so
    // both the repo root and one level up are tried; whichever exists wins, and dotenvy never
    // overwrites a variable that's already set in the real environment.
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../.env");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::external_apps::EngagedExternalApp::default())
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .max_file_size(500_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(4))
                    .build(),
            )?;

            // Remote Control's local HTTP server (design/feature-spec.md section 4) — started
            // once here rather than lazily on first use, so it's already reachable by the
            // time an operator opens Settings > Remote Control to provision a device.
            let remote_handle = remote_server::RemoteServerHandle::new(app.handle().clone());
            app.manage(remote_handle.clone());
            remote_server::start(remote_handle);

            // E2E-only builds (see e2e/package.json's build:app, which sets this at compile
            // time) skip creating the splash window at all, rather than creating-then-hiding
            // it: the WebdriverIO harness's session attaches to whichever native window's
            // webview finishes its own startup first, and splash's much smaller page reliably
            // wins that race regardless of OS-level visibility/focus — hiding it after the
            // fact (tried first) didn't help, since the race is over before setup() even runs.
            // Not creating a second webview at all removes the race entirely.
            if option_env!("WORSHIP_STUDIO_E2E_BUILD").is_none() {
                tauri::WebviewWindowBuilder::new(
                    app,
                    "splash",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("Worship Studio")
                // Sized to the logo + progress bar + status text (SplashScreen.vue) plus a
                // small margin, not an arbitrary round window size — a taller window just
                // centers that same content in more empty black space. The version line sits
                // in its own corner (see .version-credit) rather than in this centered column,
                // so it doesn't factor into this sizing at all.
                .inner_size(700.0, 360.0)
                .resizable(false)
                .decorations(false)
                .center()
                .always_on_top(true)
                .skip_taskbar(true)
                // Matches SplashScreen.vue's .splash-bg — without this, the OS paints the
                // window's default (white) background for the moment between window creation
                // and the webview's own content finishing its first paint.
                .background_color(tauri::window::Color(21, 27, 35, 255))
                .build()?;
            } else if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::write_binary_file,
            commands::files::open_file,
            commands::diagnostics::get_diagnostic_summary,
            commands::diagnostics::create_diagnostic_bundle,
            commands::diagnostics::open_logs_folder,
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
            commands::services::migrate_legacy_sermon_fields,
            commands::slides::list_slides,
            commands::slides::get_slide,
            commands::slides::save_slide,
            commands::slides::delete_slide,
            commands::slides::generate_qr_code,
            commands::settings::get_library_settings,
            commands::settings::save_library_settings,
            commands::settings::get_machine_settings,
            commands::settings::save_machine_settings,
            commands::canva::get_canva_status,
            commands::canva::connect_canva,
            commands::canva::disconnect_canva,
            commands::canva::list_canva_designs,
            commands::canva::create_canva_design,
            commands::canva::open_canva_design,
            commands::canva::import_canva_design,
            commands::scripture::resolve_scripture,
            commands::scripture::get_scripture_book_list,
            commands::scripture::list_scripture_translations,
            commands::scripture::list_api_bible_catalog,
            commands::opensong::import_opensong_sets,
            commands::media::list_media,
            commands::media::save_media,
            commands::media::delete_media,
            commands::media::stage_media_import,
            commands::media::commit_media_import,
            commands::media::detect_media_duplicates,
            commands::media::get_media_file_path,
            commands::themes::list_themes,
            commands::themes::save_theme,
            commands::themes::delete_theme,
            commands::people::list_people,
            commands::people::save_person,
            commands::people::delete_person,
            commands::announcements::list_announcements,
            commands::announcements::save_announcement,
            commands::announcements::delete_announcement,
            commands::sync::get_sync_status,
            commands::sync::list_recovery_issues,
            commands::sync::recover_library_file,
            commands::sync::quarantine_library_file,
            commands::sync::list_sync_conflicts,
            commands::sync::resolve_sync_conflict,
            commands::external_apps::list_external_app_profiles,
            commands::external_apps::save_external_app_profile,
            commands::external_apps::delete_external_app_profile,
            commands::external_apps::launch_external_app,
            commands::external_apps::prelaunch_external_app,
            commands::external_apps::restore_self,
            commands::external_apps::close_current_external_app,
            commands::external_apps::close_all_external_apps,
            commands::external_apps::verify_external_app_item,
            commands::external_apps::send_external_app_keystroke,
            commands::remote::list_remote_devices,
            commands::remote::provision_remote_device,
            commands::remote::repair_remote_device,
            commands::remote::revoke_remote_device,
            commands::remote::get_remote_server_info,
            commands::remote::update_remote_live_state,
            commands::remote::update_remote_service_outline,
            commands::remote::update_remote_service_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
