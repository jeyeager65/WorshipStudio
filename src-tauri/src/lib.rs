mod commands;
mod domain;
mod models;
mod paths;
mod remote_server;

use rust_embed::RustEmbed;
use tauri::Manager;

/// The built VitePress help site (docs/, output straight here by docs/.vitepress/config.ts's
/// outDir), embedded at compile time — same pattern as remote_server.rs's `RemoteAssets`.
/// Served through the `help` URI scheme registered below rather than the generic Tauri asset
/// protocol: `convertFileSrc`/the asset protocol percent-encode a whole absolute file path as
/// one opaque blob (confirmed live — every one of the site's own relative CSS/JS/font
/// references 404'd, landing back at the origin root instead of their real subpath), which
/// only works for single-file references, not a multi-file site with internal relative links.
/// A dedicated scheme sidesteps that entirely: requests arrive as ordinary `/`-delimited paths
/// the browser resolves relative links against completely normally.
#[derive(RustEmbed)]
#[folder = "resources/help/"]
struct HelpAssets;

const WEBVIEW_CACHE_VERSION_MARKER: &str = "webview-cache-cleared-for-version.txt";

/// Windows-only: `EBWebView` is WebView2's own internal folder name for its cached content --
/// there's no equivalent to generalize to on macOS (WKWebView) or Linux (WebKitGTK), which are
/// different engines with their own, unrelated cache storage (moot anyway, since macOS was
/// dropped from the release matrix and Linux was never in it -- see notes/release-process.md).
/// Lives at `%LOCALAPPDATA%\{identifier}\EBWebView` -- entirely separate from `app_data_dir`
/// (Roaming, used everywhere else in this app for settings/library paths, see paths.rs) -- and
/// neither a normal Windows uninstall nor tauri-plugin-updater's binary replacement clears it.
/// Confirmed on a real installed build: three consecutive in-app updates, each shipping a
/// genuinely different frontend fix, all rendered identically stale until this folder was deleted
/// by hand. Clearing it here once per version change means every future update -- in-app or a
/// fresh install -- starts its next launch with a clean cache automatically, with no manual step
/// for the operator ever again.
///
/// Must run before any `WebviewWindow` is built in this process: the *current* process's own
/// WebView2 instance holds this folder open for the duration of that process, so it can only be
/// safely cleared at the start of a fresh process, never mid-session (this is why clearing it
/// from the update-apply step itself, right before relaunching, isn't viable -- the still-running
/// old process has the folder locked until it actually exits).
#[cfg(windows)]
fn clear_stale_webview_cache(app: &tauri::AppHandle) {
    let Ok(local_data_dir) = app.path().app_local_data_dir() else {
        return;
    };
    let marker_path = local_data_dir.join(WEBVIEW_CACHE_VERSION_MARKER);
    let current_version = app.package_info().version.to_string();
    if std::fs::read_to_string(&marker_path).ok().as_deref() == Some(current_version.as_str()) {
        return;
    }

    let cache_dir = local_data_dir.join("EBWebView");
    // The previous instance's WebView2 helper process (msedgewebview2.exe) can still hold this
    // folder's files open for a brief moment after the main app process itself has already
    // exited -- silently swallowing remove_dir_all's error here (as an earlier version of this
    // function did) meant a transient lock got permanently recorded as "already cleared for this
    // version" below, so a fresh launch could never retry and the stale cache lived on until an
    // operator manually forced a cache-bypassing reload (Ctrl+F5) inside the app. Retrying a
    // few times rides out that transient lock instead.
    let mut cleared = !cache_dir.exists();
    for _ in 0..10 {
        if cleared {
            break;
        }
        match std::fs::remove_dir_all(&cache_dir) {
            Ok(()) => cleared = true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => cleared = true,
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(300)),
        }
    }
    if !cleared {
        return;
    }

    let _ = std::fs::create_dir_all(&local_data_dir);
    let _ = std::fs::write(&marker_path, &current_version);
}

/// No-op stand-in so the call site in `run()`'s `setup()` needs no `#[cfg]` of its own -- see the
/// Windows version above for what this does and why it's Windows-only.
#[cfg(not(windows))]
fn clear_stale_webview_cache(_app: &tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Local-dev convenience only (e.g. ESV_API_KEY — see notes/release-process.md and
    // commands::scripture) — silently no-ops if missing, which is the normal case for a
    // packaged build. CWD differs between `cargo run` (src-tauri/) and other invocations, so
    // both the repo root and one level up are tried; whichever exists wins, and dotenvy never
    // overwrites a variable that's already set in the real environment.
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../.env");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::external_apps::EngagedExternalApp::default())
        .register_uri_scheme_protocol("help", |_ctx, request| {
            let path = request.uri().path().trim_start_matches('/');
            let path = if path.is_empty() { "index.html" } else { path };
            match HelpAssets::get(path) {
                Some(file) => tauri::http::Response::builder()
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        remote_server::guess_asset_content_type(path),
                    )
                    .body(file.data.into_owned())
                    .unwrap(),
                None => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(|app| {
            clear_stale_webview_cache(app.handle());

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::write_binary_file,
            commands::files::open_file,
            commands::diagnostics::get_diagnostic_summary,
            commands::diagnostics::create_diagnostic_bundle,
            commands::diagnostics::open_logs_folder,
            commands::help::navigate_help_window,
            commands::songs::list_songs,
            commands::songs::get_song,
            commands::songs::save_song,
            commands::songs::delete_song,
            commands::songs::import_song_opensong_xml,
            commands::song_collections::list_song_collections,
            commands::song_collections::save_song_collection,
            commands::song_collections::delete_song_collection,
            commands::service_types::list_service_types,
            commands::service_types::save_service_type,
            commands::service_types::delete_service_type,
            commands::roles::list_role_groups,
            commands::roles::save_role_group,
            commands::roles::delete_role_group,
            commands::roles::list_roles,
            commands::roles::save_role,
            commands::roles::delete_role,
            commands::service_templates::list_service_templates,
            commands::service_templates::save_service_template,
            commands::service_templates::delete_service_template,
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
            commands::settings::get_library_credentials,
            commands::settings::save_library_credentials,
            commands::settings::get_machine_settings,
            commands::settings::save_machine_settings,
            commands::settings::get_data_location,
            commands::settings::save_data_location,
            commands::settings::clear_settings_list_backups,
            commands::canva::get_canva_status,
            commands::canva::connect_canva,
            commands::canva::disconnect_canva,
            commands::canva::list_canva_designs,
            commands::canva::create_canva_design,
            commands::canva::open_canva_design,
            commands::canva::preview_canva_design_export,
            commands::canva::import_canva_pages,
            commands::canva::preview_canva_video_export,
            commands::canva::import_canva_video,
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
            commands::stock_content::import_stock_backgrounds,
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
            commands::sync::get_cloud_sync_client_status,
            commands::sync::list_recovery_issues,
            commands::sync::recover_library_file,
            commands::sync::quarantine_library_file,
            commands::sync::list_sync_conflicts,
            commands::sync::resolve_sync_conflict,
            commands::external_apps::list_external_app_profiles,
            commands::external_apps::save_external_app_profile,
            commands::external_apps::delete_external_app_profile,
            commands::external_apps::import_default_external_app_profiles,
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
