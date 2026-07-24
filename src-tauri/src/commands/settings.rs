use tauri::AppHandle;

use crate::domain::{read_json_file, write_json_file};
use crate::models::{Branding, LibrarySettings, MachineSettings};
use crate::paths::{self, library_root, load_machine_settings};

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";

fn default_library_settings() -> LibrarySettings {
    LibrarySettings {
        service_types: vec![],
        preachers: vec![],
        collections: vec![],
        volunteer_roles: vec![],
        branding: Branding {
            church_name: "".to_string(),
            logo_media_id: None,
            primary_color: "#1F3A5F".to_string(),
            secondary_color: "#C9A227".to_string(),
        },
        bible_translations: vec![],
        default_translation_code: None,
        media_max_synced_file_size_mb: 50,
    }
}

#[tauri::command]
pub fn get_library_settings(app: AppHandle) -> Result<LibrarySettings, String> {
    let path = library_root(&app).join(LIBRARY_SETTINGS_FILE);
    Ok(read_json_file(&path).unwrap_or_else(default_library_settings))
}

#[tauri::command]
pub fn save_library_settings(app: AppHandle, settings: LibrarySettings) -> Result<(), String> {
    let path = library_root(&app).join(LIBRARY_SETTINGS_FILE);
    write_json_file(&path, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_machine_settings(app: AppHandle) -> Result<MachineSettings, String> {
    Ok(load_machine_settings(&app))
}

#[tauri::command]
pub fn save_machine_settings(app: AppHandle, settings: MachineSettings) -> Result<(), String> {
    paths::save_machine_settings(&app, &settings).map_err(|e| e.to_string())
}
