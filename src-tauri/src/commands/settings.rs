use std::path::Path;

use tauri::AppHandle;

use crate::domain::{delete_file_if_exists, read_json_file, write_json_file};
use crate::models::{
    Branding, BulletinSettings, FontSizesPx, LibraryCredentials, LibrarySettings, MachineSettings,
};
use crate::paths::{self, library_root, load_machine_settings, DataLocation};

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";
const CREDENTIALS_FILE: &str = "credentials.json";

// Real, non-fake starting values for a fresh install — there's no Settings UI yet (that's
// milestone M7) to let a church configure these, so an empty list would leave the app
// genuinely unusable (e.g. Create Service's Type dropdown would have nothing to pick).
// Service types now live in their own file (commands::service_types::seed_defaults_if_needed
// seeds the same defaults there for a genuinely fresh library), as do role groups/roles
// (left empty there — there's no reasonable default for church-specific role names), service
// templates (commands::service_templates, also left empty there since there's no reasonable
// default for church-specific names), and credentials (commands::settings::LibraryCredentials,
// also left empty — LibraryCredentials::default() covers a fresh install with no separate
// constructor needed here).
fn default_library_settings() -> LibrarySettings {
    LibrarySettings {
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
        font_sizes_px: FontSizesPx::default(),
        bulletin: BulletinSettings::default(),
    }
}

pub fn load_library_settings(app: &AppHandle) -> Result<LibrarySettings, String> {
    let root = library_root(app);
    let path = root.join(LIBRARY_SETTINGS_FILE);
    let settings = match read_json_file(&path).map_err(|error| error.to_string())? {
        Some(settings) => settings,
        None => default_library_settings(),
    };
    if !path.is_file() {
        write_json_file(&path, &settings).map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

/// Counterpart to `load_library_settings` for the credentials that moved into their own file —
/// see `LibraryCredentials`'s own doc comment.
pub fn load_library_credentials(app: &AppHandle) -> Result<LibraryCredentials, String> {
    let root = library_root(app);
    let path = root.join(CREDENTIALS_FILE);
    let credentials = read_json_file(&path)
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(credentials)
}

#[tauri::command]
pub fn get_library_settings(app: AppHandle) -> Result<LibrarySettings, String> {
    load_library_settings(&app)
}

#[tauri::command]
pub fn save_library_settings(app: AppHandle, settings: LibrarySettings) -> Result<(), String> {
    let path = library_root(&app).join(LIBRARY_SETTINGS_FILE);
    write_json_file(&path, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_library_credentials(app: AppHandle) -> Result<LibraryCredentials, String> {
    load_library_credentials(&app)
}

#[tauri::command]
pub fn save_library_credentials(
    app: AppHandle,
    credentials: LibraryCredentials,
) -> Result<(), String> {
    let path = library_root(&app).join(CREDENTIALS_FILE);
    write_json_file(&path, &credentials).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_machine_settings(app: AppHandle) -> Result<MachineSettings, String> {
    Ok(load_machine_settings(&app))
}

#[tauri::command]
pub fn save_machine_settings(app: AppHandle, settings: MachineSettings) -> Result<(), String> {
    paths::save_machine_settings(&app, &settings).map_err(|e| e.to_string())
}

/// What Settings' Local data folder panel shows/edits — the raw configured override (blank if
/// using the default), the actual resolved path (so the UI can show where Local really is even
/// when the override field is blank), and whether this install is portable (Local isn't
/// configurable there, see `paths::local_root`'s own doc comment).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocationInfo {
    pub local_root_path: String,
    pub resolved_path: String,
    pub is_portable: bool,
}

#[tauri::command]
pub fn get_data_location(app: AppHandle) -> Result<DataLocationInfo, String> {
    Ok(DataLocationInfo {
        local_root_path: paths::load_data_location(&app).local_root_path,
        resolved_path: paths::local_root(&app).to_string_lossy().to_string(),
        is_portable: paths::is_portable(&app),
    })
}

#[tauri::command]
pub fn save_data_location(app: AppHandle, local_root_path: String) -> Result<(), String> {
    paths::save_data_location(&app, &DataLocation { local_root_path }).map_err(|e| e.to_string())
}

/// Deletes the `.backup` sibling `write_json_file` keeps beside each of the six normalized
/// settings-list files (service-types.json, song-collections.json, role-groups.json, roles.json,
/// service-templates.json, external-app-profiles.json). Ordinary deletes only ever shrink these
/// lists — they never delete the file itself, even once empty — so `write_json_file`'s own
/// backup-of-the-previous-version keeps holding real, church-specific content indefinitely
/// otherwise. `library-settings.json.backup` and `credentials.json.backup` are deliberately
/// excluded: unlike the six above, neither file is ever touched by Clear Existing Data
/// (branding/tuning fields and church credentials both survive a content wipe), so neither
/// backup should be swept away either.
fn clear_settings_list_backups_at(root: &Path) -> std::io::Result<()> {
    for backup_path in [
        crate::domain::song_collections::backup_path(root),
        crate::domain::service_types::backup_path(root),
        crate::domain::role_groups::backup_path(root),
        crate::domain::roles::backup_path(root),
        crate::domain::service_templates::backup_path(root),
        crate::domain::external_apps::backup_path(root),
    ] {
        delete_file_if_exists(&backup_path)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_settings_list_backups(app: AppHandle) -> Result<(), String> {
    clear_settings_list_backups_at(&library_root(&app)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_settings_list_backups_removes_every_normalized_lists_backup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let backup_paths = [
            crate::domain::song_collections::backup_path(root),
            crate::domain::service_types::backup_path(root),
            crate::domain::role_groups::backup_path(root),
            crate::domain::roles::backup_path(root),
            crate::domain::service_templates::backup_path(root),
            crate::domain::external_apps::backup_path(root),
        ];
        for path in &backup_paths {
            std::fs::write(path, "[]").unwrap();
        }
        // library-settings.json's and credentials.json's own backups must survive — Clear
        // Existing Data never touches either file, so neither backup should be swept away.
        let settings_backup = root.join("library-settings.json.backup");
        std::fs::write(&settings_backup, "{}").unwrap();
        let credentials_backup = root.join("credentials.json.backup");
        std::fs::write(&credentials_backup, "{}").unwrap();

        clear_settings_list_backups_at(root).unwrap();

        for path in &backup_paths {
            assert!(!path.exists(), "{} should be gone", path.display());
        }
        assert!(settings_backup.exists());
        assert!(credentials_backup.exists());
    }

    #[test]
    fn clear_settings_list_backups_is_a_no_op_when_none_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(clear_settings_list_backups_at(dir.path()).is_ok());
    }
}
