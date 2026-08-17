use tauri::AppHandle;

use crate::domain::{read_json_file, write_json_file};
use crate::models::{
    Branding, BulletinSettings, CanvaIntegration, DropboxIntegration, LibrarySettings,
    MachineSettings, OneDriveIntegration,
};
use crate::paths::{self, library_root, load_machine_settings};

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";

// Real, non-fake starting values for a fresh install — there's no Settings UI yet (that's
// milestone M7) to let a church configure these, so an empty list would leave the app
// genuinely unusable (e.g. Create Service's Type dropdown would have nothing to pick).
// Service types now live in their own file (commands::service_types::migrate_if_needed seeds
// the same defaults there for a genuinely fresh library); role_groups/service_templates are
// left empty since there's no reasonable default for church-specific people, roles, or names.
fn default_library_settings() -> LibrarySettings {
    LibrarySettings {
        role_groups: vec![],
        service_templates: vec![],
        branding: Branding {
            church_name: "".to_string(),
            logo_media_id: None,
            primary_color: "#1F3A5F".to_string(),
            secondary_color: "#C9A227".to_string(),
        },
        canva_integration: CanvaIntegration::default(),
        dropbox_integration: DropboxIntegration::default(),
        one_drive_integration: OneDriveIntegration::default(),
        api_bible_translations: vec![],
        esv_api_key: None,
        api_bible_key: None,
        // KJV is bundled and always resolvable with zero configuration, so it's the sensible
        // default for a brand-new library rather than leaving the picker with nothing selected.
        default_translation_code: Some("KJV".to_string()),
        media_max_synced_file_size_mb: 50,
        scripture_min_font_size_px: 72,
        scripture_max_font_size_px: 120,
        song_min_font_size_px: 16,
        song_max_font_size_px: 120,
        slide_header_font_size_px: 48,
        slide_footer_font_size_px: 48,
        wayfinding_min_font_size_px: 56,
        wayfinding_max_font_size_px: 150,
        bulletin: BulletinSettings::default(),
    }
}

/// Moves the pre-0.5 machine-local integration credentials into the synced church settings.
/// Existing shared values win, so opening an older second computer can never overwrite the
/// credentials already selected for the church.
fn migrate_legacy_canva_credentials(
    library: &mut LibrarySettings,
    machine: &mut MachineSettings,
) -> bool {
    // Treat the two values as an inseparable pair. If either shared value is already present,
    // this church has started configuring an integration and an older computer must not combine
    // its credentials with that newer configuration.
    if !library.canva_integration.client_id.trim().is_empty()
        || !library.canva_integration.client_secret.trim().is_empty()
    {
        return false;
    }
    let Some(client_id) = machine
        .canva_client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Some(client_secret) = machine
        .canva_client_secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    library.canva_integration.client_id = client_id.to_string();
    library.canva_integration.client_secret = client_secret.to_string();
    true
}

/// Moves the pre-0.9 machine-local Bible API keys into the synced church settings. Existing
/// shared values win, so opening an older second computer can never overwrite a key already
/// configured for the church. Unlike Canva's paired id+secret, ESV and api.bible are migrated
/// independently — a church may only have configured one of the two.
fn migrate_legacy_bible_api_keys(
    library: &mut LibrarySettings,
    machine: &mut MachineSettings,
) -> bool {
    let mut changed = false;
    if library
        .esv_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        if let Some(key) = machine
            .esv_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            library.esv_api_key = Some(key.to_string());
            changed = true;
        }
    }
    if library
        .api_bible_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        if let Some(key) = machine
            .api_bible_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            library.api_bible_key = Some(key.to_string());
            changed = true;
        }
    }
    changed
}

pub fn load_library_settings(app: &AppHandle) -> Result<LibrarySettings, String> {
    let path = library_root(app).join(LIBRARY_SETTINGS_FILE);
    let mut settings = match read_json_file(&path).map_err(|error| error.to_string())? {
        Some(settings) => settings,
        None => default_library_settings(),
    };
    let mut machine = load_machine_settings(app);
    let had_legacy_canva_credentials =
        machine.canva_client_id.is_some() || machine.canva_client_secret.is_some();
    let had_legacy_bible_api_keys =
        machine.esv_api_key.is_some() || machine.api_bible_key.is_some();
    let canva_migrated = migrate_legacy_canva_credentials(&mut settings, &mut machine);
    let bible_keys_migrated = migrate_legacy_bible_api_keys(&mut settings, &mut machine);
    let library_changed = canva_migrated || bible_keys_migrated;

    if library_changed || !path.is_file() {
        write_json_file(&path, &settings).map_err(|error| error.to_string())?;
    }
    if had_legacy_canva_credentials || had_legacy_bible_api_keys {
        machine.canva_client_id = None;
        machine.canva_client_secret = None;
        machine.esv_api_key = None;
        machine.api_bible_key = None;
        paths::save_machine_settings(app, &machine).map_err(|error| error.to_string())?;
    }
    Ok(settings)
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
pub fn get_machine_settings(app: AppHandle) -> Result<MachineSettings, String> {
    Ok(load_machine_settings(&app))
}

#[tauri::command]
pub fn save_machine_settings(app: AppHandle, mut settings: MachineSettings) -> Result<(), String> {
    // Never restore stale pre-migration credentials sent by an already-open frontend.
    settings.canva_client_id = None;
    settings.canva_client_secret = None;
    settings.esv_api_key = None;
    settings.api_bible_key = None;
    paths::save_machine_settings(&app, &settings).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine_with_legacy_canva() -> MachineSettings {
        MachineSettings {
            this_computer_name: "Booth".to_string(),
            dark_mode: true,
            library_path: String::new(),
            has_completed_setup: true,
            local_media_path: String::new(),
            display_roles: Default::default(),
            esv_api_key: None,
            api_bible_key: None,
            canva_client_id: Some("legacy-id".to_string()),
            canva_client_secret: Some("legacy-secret".to_string()),
            remote_control_port: None,
            remote_control_hostname: None,
            last_remote_control_port: None,
            canva_callback_port: None,
            tablet_media_max_cached_file_size_mb: None,
            tablet_cloud_provider: None,
            tablet_cloud_library_folder_path: None,
            tablet_cloud_client_id: None,
        }
    }

    fn machine_with_legacy_bible_keys() -> MachineSettings {
        MachineSettings {
            this_computer_name: "Booth".to_string(),
            dark_mode: true,
            library_path: String::new(),
            has_completed_setup: true,
            local_media_path: String::new(),
            display_roles: Default::default(),
            esv_api_key: Some("legacy-esv-key".to_string()),
            api_bible_key: Some("legacy-api-bible-key".to_string()),
            canva_client_id: None,
            canva_client_secret: None,
            remote_control_port: None,
            remote_control_hostname: None,
            last_remote_control_port: None,
            canva_callback_port: None,
            tablet_media_max_cached_file_size_mb: None,
            tablet_cloud_provider: None,
            tablet_cloud_library_folder_path: None,
            tablet_cloud_client_id: None,
        }
    }

    #[test]
    fn legacy_canva_credentials_fill_empty_church_settings() {
        let mut library = default_library_settings();
        let mut machine = machine_with_legacy_canva();
        assert!(migrate_legacy_canva_credentials(&mut library, &mut machine));
        assert_eq!(library.canva_integration.client_id, "legacy-id");
        assert_eq!(library.canva_integration.client_secret, "legacy-secret");
    }

    #[test]
    fn legacy_bible_api_keys_fill_empty_church_settings() {
        let mut library = default_library_settings();
        let mut machine = machine_with_legacy_bible_keys();
        assert!(migrate_legacy_bible_api_keys(&mut library, &mut machine));
        assert_eq!(library.esv_api_key.as_deref(), Some("legacy-esv-key"));
        assert_eq!(
            library.api_bible_key.as_deref(),
            Some("legacy-api-bible-key")
        );
    }

    #[test]
    fn existing_church_bible_api_keys_are_never_overwritten() {
        let mut library = default_library_settings();
        library.esv_api_key = Some("church-esv-key".to_string());
        library.api_bible_key = Some("church-api-bible-key".to_string());
        let mut machine = machine_with_legacy_bible_keys();
        assert!(!migrate_legacy_bible_api_keys(&mut library, &mut machine));
        assert_eq!(library.esv_api_key.as_deref(), Some("church-esv-key"));
        assert_eq!(
            library.api_bible_key.as_deref(),
            Some("church-api-bible-key")
        );
    }

    #[test]
    fn bible_api_keys_migrate_independently_unlike_canvas_paired_credentials() {
        let mut library = default_library_settings();
        // The church already configured api.bible (e.g. from a previous device), but never ESV.
        library.api_bible_key = Some("church-api-bible-key".to_string());
        let mut machine = machine_with_legacy_bible_keys();
        assert!(migrate_legacy_bible_api_keys(&mut library, &mut machine));
        assert_eq!(library.esv_api_key.as_deref(), Some("legacy-esv-key"));
        assert_eq!(
            library.api_bible_key.as_deref(),
            Some("church-api-bible-key")
        );
    }

    #[test]
    fn existing_church_canva_credentials_are_never_overwritten() {
        let mut library = default_library_settings();
        library.canva_integration.client_id = "church-id".to_string();
        library.canva_integration.client_secret = "church-secret".to_string();
        let mut machine = machine_with_legacy_canva();
        assert!(!migrate_legacy_canva_credentials(
            &mut library,
            &mut machine
        ));
        assert_eq!(library.canva_integration.client_id, "church-id");
        assert_eq!(library.canva_integration.client_secret, "church-secret");
    }

    #[test]
    fn partial_church_configuration_is_not_mixed_with_legacy_credentials() {
        let mut library = default_library_settings();
        library.canva_integration.client_id = "new-church-id".to_string();
        let mut machine = machine_with_legacy_canva();
        assert!(!migrate_legacy_canva_credentials(
            &mut library,
            &mut machine
        ));
        assert_eq!(library.canva_integration.client_id, "new-church-id");
        assert!(library.canva_integration.client_secret.is_empty());
    }
}
