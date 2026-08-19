use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::{read_json_file, restore_json_backup, write_json_file};
use crate::models::MachineSettings;

const MACHINE_SETTINGS_FILE: &str = "machine-settings.json";
const PORTABLE_MARKER_FILE: &str = ".portable";
const DATA_LOCATION_FILE: &str = "data-location.json";
const LOCAL_DIR_NAME: &str = "Local";
pub const INSTALLED_CANVA_CALLBACK_PORT: u16 = 47823;
pub const PORTABLE_CANVA_CALLBACK_PORT: u16 = 47824;

/// The fixed-location pointer that lets an installed copy's "Local" folder (machine-settings.json,
/// paired devices, Canva tokens, local-only media) be redirected somewhere other than app-data —
/// e.g. a drive with more free space. Deliberately tiny and single-purpose: it can't live inside
/// the Local folder it points to (that would be circular — the app needs to find this before it
/// can find machine-settings.json), so it always sits directly in app-data, one level up from
/// everything it resolves. Portable installs never read this — Local is always fixed beside the
/// executable there, see `is_portable`.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    /// Absolute path to use as the Local root. Blank (the default) resolves to `<app-data>/Local`.
    #[serde(default)]
    pub local_root_path: String,
}

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

/// Portable-ness is its own explicit signal, independent of where anything is actually stored —
/// an empty marker file beside the executable, checked purely for existence. Deliberately not
/// tied to `machine-settings.json`'s location (as it used to be): that conflated "is this
/// portable" with "where do settings live," which stopped working once settings moved under a
/// `Local` folder that itself has to vary by mode.
pub fn is_portable(app: &AppHandle) -> bool {
    executable_dir(app).join(PORTABLE_MARKER_FILE).is_file()
}

fn resolve_configured_path(base: &Path, configured: &str) -> PathBuf {
    let path = PathBuf::from(configured);
    if path.is_absolute() {
        path
    } else {
        base.join(path)
    }
}

fn data_location_path(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join(DATA_LOCATION_FILE)
}

pub fn load_data_location(app: &AppHandle) -> DataLocation {
    read_json_file(&data_location_path(app))
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub fn save_data_location(app: &AppHandle, location: &DataLocation) -> std::io::Result<()> {
    write_json_file(&data_location_path(app), location)
}

/// Where machine-settings.json, external-apps.json, remote-devices.json, canva-auth.json, and
/// local-only media all live — never synced. Portable installs always use a fixed `Local` folder
/// beside the executable, matching how their library folder is fixed too (running self-contained
/// off a flash drive leaves nothing "this machine" to protect). Installed copies default to
/// app-data but can be redirected via `data-location.json` (see `load_data_location`) — e.g. to a
/// drive with more free space.
pub fn local_root(app: &AppHandle) -> PathBuf {
    let portable = is_portable(app);
    let configured = if portable {
        String::new()
    } else {
        load_data_location(app).local_root_path
    };
    resolve_local_root(
        portable,
        &executable_dir(app),
        &app_data_dir(app),
        &configured,
    )
}

fn resolve_local_root(
    portable: bool,
    exe_dir: &Path,
    app_data_dir: &Path,
    configured: &str,
) -> PathBuf {
    if portable {
        exe_dir.join(LOCAL_DIR_NAME)
    } else if configured.trim().is_empty() {
        app_data_dir.join(LOCAL_DIR_NAME)
    } else {
        PathBuf::from(configured)
    }
}

fn machine_settings_path(app: &AppHandle) -> PathBuf {
    local_root(app).join(MACHINE_SETTINGS_FILE)
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
        display_roles: std::collections::HashMap::new(),
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

/// The synced library root — where songs/services/slides/settings live. Deliberately resolved
/// independently of `local_root` — Library and Local are siblings, never nested under one
/// another, since Local's whole point is guaranteeing it never ends up inside whatever folder a
/// sync client is watching.
pub fn library_root(app: &AppHandle) -> PathBuf {
    let configured = load_machine_settings(app).library_path;
    if configured.trim().is_empty() {
        let base = if is_portable(app) {
            executable_dir(app)
        } else {
            app_data_dir(app)
        };
        base.join("Library")
    } else {
        resolve_configured_path(&executable_dir(app), &configured)
    }
}

pub fn this_device_name(app: &AppHandle) -> String {
    load_machine_settings(app).this_computer_name
}

/// The local-only media folder (never synced) — always a fixed subfolder of `local_root`, not
/// independently configurable; moving Local moves media with it.
pub fn local_media_root(app: &AppHandle) -> PathBuf {
    local_root(app).join("media")
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// External App Profiles (see domain::external_apps) — per-machine, never synced, since
/// executable paths are local to that computer.
pub fn external_apps_path(app: &AppHandle) -> PathBuf {
    local_root(app).join("external-apps.json")
}

/// Paired Remote Control devices (see domain::remote) — per-machine, never synced, since a
/// paired phone only makes sense against the HTTP server running on this specific computer.
pub fn remote_devices_path(app: &AppHandle) -> PathBuf {
    local_root(app).join("remote-devices.json")
}

pub fn canva_auth_path(app: &AppHandle) -> PathBuf {
    local_root(app).join("canva-auth.json")
}

#[cfg(test)]
mod tests {
    use super::{
        default_canva_callback_port, resolve_configured_path, resolve_local_root, DataLocation,
    };
    use crate::domain::{read_json_file, write_json_file};
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

    #[test]
    fn portable_local_root_is_always_beside_the_executable_regardless_of_any_override() {
        let resolved = resolve_local_root(
            true,
            Path::new("portable-app"),
            Path::new("C:/Users/someone/AppData/Roaming/worship-studio"),
            "D:/should-be-ignored",
        );
        assert_eq!(resolved, Path::new("portable-app/Local"));
    }

    #[test]
    fn installed_local_root_defaults_to_app_data_when_unconfigured() {
        let resolved = resolve_local_root(
            false,
            Path::new("portable-app"),
            Path::new("C:/Users/someone/AppData/Roaming/worship-studio"),
            "",
        );
        assert_eq!(
            resolved,
            Path::new("C:/Users/someone/AppData/Roaming/worship-studio/Local")
        );
    }

    #[test]
    fn installed_local_root_honors_a_configured_override() {
        let resolved = resolve_local_root(
            false,
            Path::new("portable-app"),
            Path::new("C:/Users/someone/AppData/Roaming/worship-studio"),
            "D:/WorshipStudio/Local",
        );
        assert_eq!(resolved, Path::new("D:/WorshipStudio/Local"));
    }

    #[test]
    fn data_location_round_trips_through_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data-location.json");
        let location = DataLocation {
            local_root_path: "D:\\WorshipStudio\\Local".to_string(),
        };
        write_json_file(&path, &location).unwrap();
        let loaded: DataLocation = read_json_file(&path).unwrap().unwrap();
        assert_eq!(loaded.local_root_path, "D:\\WorshipStudio\\Local");
    }

    #[test]
    fn missing_data_location_file_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data-location.json");
        let loaded: Option<DataLocation> = read_json_file(&path).unwrap();
        assert!(loaded.is_none());
    }
}
