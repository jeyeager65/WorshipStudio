use std::path::Path;

use tauri::AppHandle;

use crate::domain::{delete_file_if_exists, read_json_file, write_json_file};
use crate::models::{
    Branding, BulletinSettings, LibraryCredentials, LibrarySettings, MachineSettings,
};
use crate::paths::{self, library_root, load_machine_settings};

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";
const CREDENTIALS_FILE: &str = "credentials.json";

// Real, non-fake starting values for a fresh install — there's no Settings UI yet (that's
// milestone M7) to let a church configure these, so an empty list would leave the app
// genuinely unusable (e.g. Create Service's Type dropdown would have nothing to pick).
// Service types now live in their own file (commands::service_types::migrate_if_needed seeds
// the same defaults there for a genuinely fresh library), as do role groups/roles
// (commands::roles::migrate_if_needed), service templates (commands::service_templates, left
// empty there since there's no reasonable default for church-specific names), and credentials
// (commands::settings::LibraryCredentials, also left empty — LibraryCredentials::default()
// covers a fresh install with no separate constructor needed here).
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

/// One-time migration off the old nested-in-`library-settings.json` shape: `canvaIntegration`,
/// `dropboxIntegration`, `oneDriveIntegration`, `esvApiKey`, and `apiBibleKey` used to live
/// directly on `LibrarySettings` — see `LibraryCredentials`'s own doc comment for why they moved.
/// Runs once, the first time `credentials.json` doesn't exist yet; reads the legacy fields as raw
/// JSON (not through the now-fields-removed `LibrarySettings` struct, which would just silently
/// ignore them) and, having captured them, strips them from `library-settings.json` too — leaving
/// real church credentials sitting in plaintext in a file nothing reads them from anymore isn't
/// an acceptable steady state, even though nothing is actively broken by their presence there.
fn migrate_credentials_into_own_file(root: &Path) -> std::io::Result<()> {
    let credentials_path = root.join(CREDENTIALS_FILE);
    if credentials_path.is_file() {
        return Ok(());
    }
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    let Some(raw) = read_json_file::<serde_json::Value>(&settings_path)? else {
        // No settings file yet at all — a genuinely fresh library, nothing to migrate.
        // credentials.json is created the first time something actually saves to it.
        return Ok(());
    };
    const LEGACY_KEYS: [&str; 5] = [
        "canvaIntegration",
        "dropboxIntegration",
        "oneDriveIntegration",
        "esvApiKey",
        "apiBibleKey",
    ];
    let credentials = LibraryCredentials {
        canva_integration: raw
            .get("canvaIntegration")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        dropbox_integration: raw
            .get("dropboxIntegration")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        one_drive_integration: raw
            .get("oneDriveIntegration")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        esv_api_key: raw
            .get("esvApiKey")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        api_bible_key: raw
            .get("apiBibleKey")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    };
    write_json_file(&credentials_path, &credentials)?;
    if let serde_json::Value::Object(mut obj) = raw {
        // Not `.any()` — every key must actually be removed, not just checked until the first
        // match (`.any()` short-circuits, which would silently leave the rest of the legacy
        // credentials sitting in library-settings.json).
        let mut changed = false;
        for key in LEGACY_KEYS {
            if obj.remove(key).is_some() {
                changed = true;
            }
        }
        if changed {
            write_json_file(&settings_path, &serde_json::Value::Object(obj))?;
        }
    }
    Ok(())
}

/// Moves the pre-0.5 machine-local integration credentials into the synced church credentials.
/// Existing shared values win, so opening an older second computer can never overwrite the
/// credentials already selected for the church.
fn migrate_legacy_canva_credentials(
    credentials: &mut LibraryCredentials,
    machine: &mut MachineSettings,
) -> bool {
    // Treat the two values as an inseparable pair. If either shared value is already present,
    // this church has started configuring an integration and an older computer must not combine
    // its credentials with that newer configuration.
    if !credentials.canva_integration.client_id.trim().is_empty()
        || !credentials
            .canva_integration
            .client_secret
            .trim()
            .is_empty()
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
    credentials.canva_integration.client_id = client_id.to_string();
    credentials.canva_integration.client_secret = client_secret.to_string();
    true
}

/// Moves the pre-0.9 machine-local Bible API keys into the synced church credentials. Existing
/// shared values win, so opening an older second computer can never overwrite a key already
/// configured for the church. Unlike Canva's paired id+secret, ESV and api.bible are migrated
/// independently — a church may only have configured one of the two.
fn migrate_legacy_bible_api_keys(
    credentials: &mut LibraryCredentials,
    machine: &mut MachineSettings,
) -> bool {
    let mut changed = false;
    if credentials
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
            credentials.esv_api_key = Some(key.to_string());
            changed = true;
        }
    }
    if credentials
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
            credentials.api_bible_key = Some(key.to_string());
            changed = true;
        }
    }
    changed
}

pub fn load_library_settings(app: &AppHandle) -> Result<LibrarySettings, String> {
    let root = library_root(app);
    let path = root.join(LIBRARY_SETTINGS_FILE);
    // Eager, unlike service_types/song_collections (which only migrate when their own list
    // command runs) — ServiceTemplateItem.role_id and BulletinSettings.serving_schedule_role_ids
    // stay nested inside LibrarySettings, so they need to be correct as soon as anything reads
    // settings at all, not only once someone happens to open Settings > Roles first. See
    // commands::roles::migrate_if_needed's own doc comment.
    crate::commands::roles::migrate_if_needed(&root).map_err(|error| error.to_string())?;
    // Also eager, same reasoning — commands::canva/commands::scripture read credentials.json
    // directly and early. Harmless to call unconditionally: gated on credentials.json not
    // existing yet, and load_library_credentials below calls it again just as cheaply.
    migrate_credentials_into_own_file(&root).map_err(|error| error.to_string())?;
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
/// see `LibraryCredentials`'s own doc comment. Handles both the one-time
/// nested-in-settings-shape migration and the older pre-0.5/pre-0.9 machine-local migrations,
/// which now target this file instead of `LibrarySettings`.
pub fn load_library_credentials(app: &AppHandle) -> Result<LibraryCredentials, String> {
    let root = library_root(app);
    let path = root.join(CREDENTIALS_FILE);
    migrate_credentials_into_own_file(&root).map_err(|error| error.to_string())?;
    let mut credentials = read_json_file(&path)
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let mut machine = load_machine_settings(app);
    let had_legacy_canva_credentials =
        machine.canva_client_id.is_some() || machine.canva_client_secret.is_some();
    let had_legacy_bible_api_keys =
        machine.esv_api_key.is_some() || machine.api_bible_key.is_some();
    let canva_migrated = migrate_legacy_canva_credentials(&mut credentials, &mut machine);
    let bible_keys_migrated = migrate_legacy_bible_api_keys(&mut credentials, &mut machine);
    let credentials_changed = canva_migrated || bible_keys_migrated;

    if credentials_changed || !path.is_file() {
        write_json_file(&path, &credentials).map_err(|error| error.to_string())?;
    }
    if had_legacy_canva_credentials || had_legacy_bible_api_keys {
        machine.canva_client_id = None;
        machine.canva_client_secret = None;
        machine.esv_api_key = None;
        machine.api_bible_key = None;
        paths::save_machine_settings(app, &machine).map_err(|error| error.to_string())?;
    }
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
pub fn save_machine_settings(app: AppHandle, mut settings: MachineSettings) -> Result<(), String> {
    // Never restore stale pre-migration credentials sent by an already-open frontend.
    settings.canva_client_id = None;
    settings.canva_client_secret = None;
    settings.esv_api_key = None;
    settings.api_bible_key = None;
    paths::save_machine_settings(&app, &settings).map_err(|e| e.to_string())
}

/// Deletes the "library-settings.pre-*-id-migration.json" snapshots that
/// `commands::{roles,service_types,song_collections,service_templates}::migrate_if_needed` each
/// write once, right before their own one-time id migration, as a manual recovery escape hatch —
/// normally never auto-cleaned. Offered from Settings > Library & Sync's "Clear Existing Data"
/// only, since that's the one action that already deletes every other piece of real library
/// content: at that point there's nothing left for these snapshots to help recover back to.
fn clear_migration_snapshots_at(root: &Path) -> std::io::Result<()> {
    for filename in [
        crate::commands::song_collections::MIGRATION_SNAPSHOT_FILE,
        crate::commands::service_types::MIGRATION_SNAPSHOT_FILE,
        crate::commands::roles::MIGRATION_SNAPSHOT_FILE,
        crate::commands::service_templates::MIGRATION_SNAPSHOT_FILE,
    ] {
        delete_file_if_exists(&root.join(filename))?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_migration_snapshots(app: AppHandle) -> Result<(), String> {
    clear_migration_snapshots_at(&library_root(&app)).map_err(|e| e.to_string())
}

/// Deletes the `.backup` sibling `write_json_file` keeps beside each of the five normalized
/// settings-list files (service-types.json, song-collections.json, role-groups.json, roles.json,
/// service-templates.json). Ordinary deletes only ever shrink these lists — they never delete the
/// file itself, even once empty — so `write_json_file`'s own backup-of-the-previous-version keeps
/// holding real, church-specific content indefinitely otherwise. `library-settings.json.backup`
/// and `credentials.json.backup` are deliberately excluded: unlike the five above, neither file is
/// ever touched by Clear Existing Data (branding/tuning fields and church credentials both survive
/// a content wipe), so neither backup should be swept away either.
fn clear_settings_list_backups_at(root: &Path) -> std::io::Result<()> {
    for backup_path in [
        crate::domain::song_collections::backup_path(root),
        crate::domain::service_types::backup_path(root),
        crate::domain::role_groups::backup_path(root),
        crate::domain::roles::backup_path(root),
        crate::domain::service_templates::backup_path(root),
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
    fn legacy_canva_credentials_fill_empty_church_credentials() {
        let mut credentials = LibraryCredentials::default();
        let mut machine = machine_with_legacy_canva();
        assert!(migrate_legacy_canva_credentials(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.canva_integration.client_id, "legacy-id");
        assert_eq!(credentials.canva_integration.client_secret, "legacy-secret");
    }

    #[test]
    fn legacy_bible_api_keys_fill_empty_church_credentials() {
        let mut credentials = LibraryCredentials::default();
        let mut machine = machine_with_legacy_bible_keys();
        assert!(migrate_legacy_bible_api_keys(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.esv_api_key.as_deref(), Some("legacy-esv-key"));
        assert_eq!(
            credentials.api_bible_key.as_deref(),
            Some("legacy-api-bible-key")
        );
    }

    #[test]
    fn existing_church_bible_api_keys_are_never_overwritten() {
        let mut credentials = LibraryCredentials {
            esv_api_key: Some("church-esv-key".to_string()),
            api_bible_key: Some("church-api-bible-key".to_string()),
            ..Default::default()
        };
        let mut machine = machine_with_legacy_bible_keys();
        assert!(!migrate_legacy_bible_api_keys(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.esv_api_key.as_deref(), Some("church-esv-key"));
        assert_eq!(
            credentials.api_bible_key.as_deref(),
            Some("church-api-bible-key")
        );
    }

    #[test]
    fn bible_api_keys_migrate_independently_unlike_canvas_paired_credentials() {
        // The church already configured api.bible (e.g. from a previous device), but never ESV.
        let mut credentials = LibraryCredentials {
            api_bible_key: Some("church-api-bible-key".to_string()),
            ..Default::default()
        };
        let mut machine = machine_with_legacy_bible_keys();
        assert!(migrate_legacy_bible_api_keys(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.esv_api_key.as_deref(), Some("legacy-esv-key"));
        assert_eq!(
            credentials.api_bible_key.as_deref(),
            Some("church-api-bible-key")
        );
    }

    #[test]
    fn existing_church_canva_credentials_are_never_overwritten() {
        let mut credentials = LibraryCredentials::default();
        credentials.canva_integration.client_id = "church-id".to_string();
        credentials.canva_integration.client_secret = "church-secret".to_string();
        let mut machine = machine_with_legacy_canva();
        assert!(!migrate_legacy_canva_credentials(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.canva_integration.client_id, "church-id");
        assert_eq!(credentials.canva_integration.client_secret, "church-secret");
    }

    #[test]
    fn partial_church_configuration_is_not_mixed_with_legacy_credentials() {
        let mut credentials = LibraryCredentials::default();
        credentials.canva_integration.client_id = "new-church-id".to_string();
        let mut machine = machine_with_legacy_canva();
        assert!(!migrate_legacy_canva_credentials(
            &mut credentials,
            &mut machine
        ));
        assert_eq!(credentials.canva_integration.client_id, "new-church-id");
        assert!(credentials.canva_integration.client_secret.is_empty());
    }

    #[test]
    fn migrates_legacy_nested_credentials_out_of_library_settings_and_strips_them() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join(LIBRARY_SETTINGS_FILE),
            &serde_json::json!({
                "branding": { "churchName": "Hope Church", "primaryColor": "#000", "secondaryColor": "#000" },
                "canvaIntegration": { "clientId": "old-id", "clientSecret": "old-secret" },
                "dropboxIntegration": { "appKey": "old-app-key" },
                "oneDriveIntegration": { "clientId": "old-onedrive-id" },
                "esvApiKey": "old-esv-key",
                "apiBibleKey": "old-api-bible-key",
                "apiBibleTranslations": [],
                "mediaMaxSyncedFileSizeMb": 50,
            }),
        )
        .unwrap();

        migrate_credentials_into_own_file(root).unwrap();

        let credentials: LibraryCredentials = read_json_file(&root.join(CREDENTIALS_FILE))
            .unwrap()
            .unwrap();
        assert_eq!(credentials.canva_integration.client_id, "old-id");
        assert_eq!(credentials.canva_integration.client_secret, "old-secret");
        assert_eq!(credentials.dropbox_integration.app_key, "old-app-key");
        assert_eq!(
            credentials.one_drive_integration.client_id,
            "old-onedrive-id"
        );
        assert_eq!(credentials.esv_api_key.as_deref(), Some("old-esv-key"));
        assert_eq!(
            credentials.api_bible_key.as_deref(),
            Some("old-api-bible-key")
        );

        // Stripped from library-settings.json — no plaintext credentials left behind there.
        let remaining: serde_json::Value = read_json_file(&root.join(LIBRARY_SETTINGS_FILE))
            .unwrap()
            .unwrap();
        assert!(remaining.get("canvaIntegration").is_none());
        assert!(remaining.get("dropboxIntegration").is_none());
        assert!(remaining.get("oneDriveIntegration").is_none());
        assert!(remaining.get("esvApiKey").is_none());
        assert!(remaining.get("apiBibleKey").is_none());
        assert_eq!(remaining["branding"]["churchName"], "Hope Church");
    }

    #[test]
    fn migrate_credentials_is_a_no_op_once_credentials_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut existing = LibraryCredentials::default();
        existing.canva_integration.client_id = "already-migrated".to_string();
        write_json_file(&root.join(CREDENTIALS_FILE), &existing).unwrap();
        write_json_file(
            &root.join(LIBRARY_SETTINGS_FILE),
            &serde_json::json!({ "canvaIntegration": { "clientId": "should-be-ignored", "clientSecret": "" } }),
        )
        .unwrap();

        migrate_credentials_into_own_file(root).unwrap();

        let credentials: LibraryCredentials = read_json_file(&root.join(CREDENTIALS_FILE))
            .unwrap()
            .unwrap();
        assert_eq!(credentials.canva_integration.client_id, "already-migrated");
    }

    #[test]
    fn migrate_credentials_is_a_no_op_on_a_genuinely_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        assert!(migrate_credentials_into_own_file(dir.path()).is_ok());
        assert!(!dir.path().join(CREDENTIALS_FILE).exists());
    }

    #[test]
    fn clear_migration_snapshots_removes_every_known_pre_migration_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let filenames = [
            crate::commands::song_collections::MIGRATION_SNAPSHOT_FILE,
            crate::commands::service_types::MIGRATION_SNAPSHOT_FILE,
            crate::commands::roles::MIGRATION_SNAPSHOT_FILE,
            crate::commands::service_templates::MIGRATION_SNAPSHOT_FILE,
        ];
        for filename in filenames {
            std::fs::write(root.join(filename), "{}").unwrap();
        }
        // An unrelated file must survive untouched.
        std::fs::write(root.join(LIBRARY_SETTINGS_FILE), "{}").unwrap();

        clear_migration_snapshots_at(root).unwrap();

        for filename in filenames {
            assert!(!root.join(filename).exists(), "{filename} should be gone");
        }
        assert!(root.join(LIBRARY_SETTINGS_FILE).exists());
    }

    #[test]
    fn clear_migration_snapshots_is_a_no_op_when_none_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(clear_migration_snapshots_at(dir.path()).is_ok());
    }

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
