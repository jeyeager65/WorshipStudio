use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::models::MachineSettings;

const MACHINE_SETTINGS_FILE: &str = "machine-settings.json";

pub fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir should be resolvable on a supported platform")
}

fn machine_settings_path(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join(MACHINE_SETTINGS_FILE)
}

fn default_machine_settings(app: &AppHandle) -> MachineSettings {
    MachineSettings {
        this_computer_name: gethostname::gethostname().to_string_lossy().to_string(),
        dark_mode: true,
        // Points inside app-data by default so the app runs with no setup; a real
        // deployment repoints this at a Dropbox-synced folder via Settings (M7).
        library_path: app_data_dir(app)
            .join("Library")
            .to_string_lossy()
            .to_string(),
    }
}

/// Loads machine-settings.json (per-machine, never synced), creating it with
/// sensible defaults on first run.
pub fn load_machine_settings(app: &AppHandle) -> MachineSettings {
    let path = machine_settings_path(app);
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(settings) = serde_json::from_slice(&bytes) {
            return settings;
        }
    }
    let defaults = default_machine_settings(app);
    let _ = save_machine_settings(app, &defaults);
    defaults
}

pub fn save_machine_settings(app: &AppHandle, settings: &MachineSettings) -> std::io::Result<()> {
    let dir = app_data_dir(app);
    fs::create_dir_all(&dir)?;
    fs::write(
        machine_settings_path(app),
        serde_json::to_vec_pretty(settings)?,
    )
}

/// The synced library root — where songs/services/slides/settings live.
pub fn library_root(app: &AppHandle) -> PathBuf {
    PathBuf::from(load_machine_settings(app).library_path)
}

pub fn this_device_name(app: &AppHandle) -> String {
    load_machine_settings(app).this_computer_name
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
