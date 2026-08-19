use std::path::Path;

use tauri::AppHandle;

use crate::domain::service_types;
use crate::models::ServiceType;
use crate::paths::library_root;

/// Real, non-fake starting values for a brand-new library — there's no Settings UI yet to let a
/// church configure these from scratch, so an empty list would leave the app genuinely unusable
/// (e.g. Create Service's Type dropdown would have nothing to pick). Same ids/names a fresh
/// install has always started with.
fn default_service_types() -> Vec<ServiceType> {
    vec![
        ServiceType {
            id: "type-sunday-morning-worship".to_string(),
            name: "Sunday Morning Worship".to_string(),
            description: None,
        },
        ServiceType {
            id: "type-wednesday-bible-study".to_string(),
            name: "Wednesday Bible Study".to_string(),
            description: None,
        },
        ServiceType {
            id: "type-other".to_string(),
            name: "Other".to_string(),
            description: None,
        },
    ]
}

/// Seeds the defaults above the first time service-types.json doesn't exist yet — i.e. a
/// genuinely fresh library, not merely an emptied-out one (Settings > Library & Sync's Clear
/// Existing Data removes every entry but leaves the file itself in place as `[]`, so it's never
/// reseeded afterward).
fn seed_defaults_if_needed(root: &Path) -> std::io::Result<()> {
    if service_types::exists(root) {
        return Ok(());
    }
    service_types::replace_all(root, &default_service_types())
}

#[tauri::command]
pub fn list_service_types(app: AppHandle) -> Result<Vec<ServiceType>, String> {
    let root = library_root(&app);
    seed_defaults_if_needed(&root).map_err(|e| e.to_string())?;
    service_types::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_service_type(app: AppHandle, service_type: ServiceType) -> Result<ServiceType, String> {
    service_types::save(&library_root(&app), service_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service_type(app: AppHandle, id: String) -> Result<(), String> {
    service_types::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_sensible_defaults_for_a_genuinely_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        seed_defaults_if_needed(dir.path()).unwrap();
        let definitions = service_types::list(dir.path()).unwrap();
        assert_eq!(definitions.len(), 3);
        assert!(definitions
            .iter()
            .any(|d| d.name == "Sunday Morning Worship"));
    }

    #[test]
    fn is_a_no_op_once_service_types_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        service_types::save(
            root,
            ServiceType {
                id: "type-existing".to_string(),
                name: "Already Configured".to_string(),
                description: None,
            },
        )
        .unwrap();

        seed_defaults_if_needed(root).unwrap();

        let definitions = service_types::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Already Configured");
    }
}
