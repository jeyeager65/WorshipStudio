use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::{read_json_file, restore_json_backup, write_json_file};
use crate::models::MachineSettings;

const MACHINE_SETTINGS_FILE: &str = "machine-settings.json";
pub const INSTALLED_CANVA_CALLBACK_PORT: u16 = 47823;
pub const PORTABLE_CANVA_CALLBACK_PORT: u16 = 47824;

pub fn default_canva_callback_port(portable: bool) -> u16 {
    if portable {
        PORTABLE_CANVA_CALLBACK_PORT
    } else {
        INSTALLED_CANVA_CALLBACK_PORT
    }
}

pub fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir should be resolvable on a supported platform")
}

/// Folder containing the running executable. Portable installations can keep their library
/// beside the app by saving a relative path such as `./Library` in machine settings.
fn executable_dir(app: &AppHandle) -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| app_data_dir(app))
}

fn portable_machine_settings_path(app: &AppHandle) -> PathBuf {
    executable_dir(app).join(MACHINE_SETTINGS_FILE)
}

pub fn is_portable(app: &AppHandle) -> bool {
    portable_machine_settings_path(app).is_file()
}

/// Per-instance state lives beside the executable in portable mode. This keeps Canva tokens,
/// paired remote devices, and external-app profiles independent from an installed copy using
/// the same application identifier on the same computer.
fn machine_data_dir(app: &AppHandle) -> PathBuf {
    if is_portable(app) {
        executable_dir(app)
    } else {
        app_data_dir(app)
    }
}

fn resolve_configured_path(base: &Path, configured: &str) -> PathBuf {
    let path = PathBuf::from(configured);
    if path.is_absolute() {
        path
    } else {
        base.join(path)
    }
}

fn machine_settings_path(app: &AppHandle) -> PathBuf {
    if is_portable(app) {
        portable_machine_settings_path(app)
    } else {
        app_data_dir(app).join(MACHINE_SETTINGS_FILE)
    }
}

fn default_machine_settings(app: &AppHandle) -> MachineSettings {
    let portable = is_portable(app);
    MachineSettings {
        this_computer_name: gethostname::gethostname().to_string_lossy().to_string(),
        dark_mode: true,
        // Points inside app-data by default so the app runs with no setup; a real
        // deployment repoints this at a Dropbox-synced folder via Settings (M7).
        library_path: if portable {
            "./Library".to_string()
        } else {
            app_data_dir(app)
                .join("Library")
                .to_string_lossy()
                .to_string()
        },
        has_completed_setup: false,
        local_media_path: if portable {
            String::new()
        } else {
            app_data_dir(app)
                .join("LocalMedia")
                .to_string_lossy()
                .to_string()
        },
        display_roles: std::collections::HashMap::new(),
        esv_api_key: None,
        api_bible_key: None,
        canva_client_id: None,
        canva_client_secret: None,
        remote_control_port: None,
        remote_control_hostname: None,
        last_remote_control_port: None,
        canva_callback_port: Some(default_canva_callback_port(portable)),
        tablet_media_max_cached_file_size_mb: None,
        tablet_cloud_provider: None,
        tablet_cloud_library_folder_path: None,
        tablet_cloud_client_id: None,
    }
}

/// Loads machine-settings.json (per-machine, never synced), creating it with
/// sensible defaults on first run.
pub fn load_machine_settings(app: &AppHandle) -> MachineSettings {
    let path = machine_settings_path(app);
    match read_json_file::<MachineSettings>(&path) {
        Ok(Some(mut settings)) => {
            if settings.canva_callback_port.is_none() {
                settings.canva_callback_port = Some(default_canva_callback_port(is_portable(app)));
                let _ = save_machine_settings(app, &settings);
            }
            return settings;
        }
        Ok(None) => {}
        Err(error) => {
            log::error!("Could not load machine settings: {error}");
            if restore_json_backup(&path).unwrap_or(false) {
                if let Ok(Some(settings)) = read_json_file(&path) {
                    log::warn!("Restored machine settings from {}", path.display());
                    return settings;
                }
            }
            // Preserve the damaged bytes when recovery is unavailable. Defaults let the UI
            // open without turning a readable corruption problem into silent data loss.
            return default_machine_settings(app);
        }
    }
    let defaults = default_machine_settings(app);
    let _ = save_machine_settings(app, &defaults);
    defaults
}

pub fn save_machine_settings(app: &AppHandle, settings: &MachineSettings) -> std::io::Result<()> {
    let path = machine_settings_path(app);
    write_json_file(&path, settings)
}

/// The synced library root — where songs/services/slides/settings live.
pub fn library_root(app: &AppHandle) -> PathBuf {
    let configured = load_machine_settings(app).library_path;
    if configured.trim().is_empty() {
        machine_data_dir(app).join("Library")
    } else {
        resolve_configured_path(&executable_dir(app), &configured)
    }
}

pub fn this_device_name(app: &AppHandle) -> String {
    load_machine_settings(app).this_computer_name
}

/// The local-only media folder (never synced) — falls back to a default location for
/// machine-settings.json files written before this field existed (empty string).
pub fn local_media_root(app: &AppHandle) -> PathBuf {
    let configured = load_machine_settings(app).local_media_path;
    if configured.is_empty() {
        machine_data_dir(app).join("LocalMedia")
    } else {
        PathBuf::from(configured)
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// External App Profiles (see domain::external_apps) — per-machine, never synced, since
/// executable paths are local to that computer.
pub fn external_apps_path(app: &AppHandle) -> PathBuf {
    machine_data_dir(app).join("external-apps.json")
}

/// Paired Remote Control devices (see domain::remote) — per-machine, never synced, since a
/// paired phone only makes sense against the HTTP server running on this specific computer.
pub fn remote_devices_path(app: &AppHandle) -> PathBuf {
    machine_data_dir(app).join("remote-devices.json")
}

pub fn canva_auth_path(app: &AppHandle) -> PathBuf {
    machine_data_dir(app).join("canva-auth.json")
}

#[cfg(test)]
mod tests {
    use super::{default_canva_callback_port, resolve_configured_path};
    use std::path::Path;

    #[test]
    fn relative_configured_paths_resolve_from_the_executable_folder() {
        let resolved = resolve_configured_path(Path::new("portable-app"), "Library/services");
        assert_eq!(resolved, Path::new("portable-app/Library/services"));
    }

    #[test]
    fn absolute_configured_paths_are_unchanged() {
        let absolute = std::env::temp_dir().join("worship-studio-library");
        assert_eq!(
            resolve_configured_path(Path::new("portable-app"), absolute.to_str().unwrap()),
            absolute
        );
    }

    #[test]
    fn canva_callback_defaults_keep_installed_and_portable_instances_distinct() {
        assert_eq!(default_canva_callback_port(false), 47823);
        assert_eq!(default_canva_callback_port(true), 47824);
    }
}
