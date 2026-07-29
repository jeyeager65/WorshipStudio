use tauri::AppHandle;

use crate::domain::{read_json_file, write_json_file};
use crate::models::{Branding, LibrarySettings, MachineSettings};
use crate::paths::{self, library_root, load_machine_settings};

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";

// Real, non-fake starting values for a fresh install — there's no Settings UI yet (that's
// milestone M7) to let a church configure these, so an empty list would leave the app
// genuinely unusable (e.g. Create Service's Type dropdown would have nothing to pick).
// service_types mirrors the common categories shown in design/sketches/create-service.html;
// collections/role_groups/service_templates are left empty since there's no reasonable
// default for church-specific people, roles, or names.
fn default_library_settings() -> LibrarySettings {
    LibrarySettings {
        service_types: vec![
            "Sunday Morning Worship".to_string(),
            "Wednesday Bible Study".to_string(),
            "Other".to_string(),
        ],
        collections: vec![],
        role_groups: vec![],
        service_templates: vec![],
        branding: Branding {
            church_name: "".to_string(),
            logo_media_id: None,
            primary_color: "#1F3A5F".to_string(),
            secondary_color: "#C9A227".to_string(),
        },
        api_bible_translations: vec![],
        // KJV is bundled and always resolvable with zero configuration, so it's the sensible
        // default for a brand-new library rather than leaving the picker with nothing selected.
        default_translation_code: Some("KJV".to_string()),
        media_max_synced_file_size_mb: 50,
        scripture_min_font_size_px: 28,
        scripture_max_font_size_px: 72,
        song_min_font_size_px: 16,
        song_max_font_size_px: 72,
        slide_header_font_size_px: 24,
        slide_footer_font_size_px: 24,
        wayfinding_min_font_size_px: 56,
        wayfinding_max_font_size_px: 150,
    }
}

#[tauri::command]
pub fn get_library_settings(app: AppHandle) -> Result<LibrarySettings, String> {
    let path = library_root(&app).join(LIBRARY_SETTINGS_FILE);
    match read_json_file(&path) {
        Some(settings) => Ok(settings),
        None => {
            // Persist on first read, same pattern as machine-settings.json (paths.rs) — the
            // file should exist on disk from first run, not be silently recomputed forever.
            let defaults = default_library_settings();
            write_json_file(&path, &defaults).map_err(|e| e.to_string())?;
            Ok(defaults)
        }
    }
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
