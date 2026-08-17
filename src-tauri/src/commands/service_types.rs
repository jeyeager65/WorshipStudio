use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::AppHandle;

use crate::domain::{read_json_file, service_types, write_json_file};
use crate::models::ServiceType;
use crate::paths::library_root;

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Deterministic id derived from the name — same reasoning as
/// `commands::song_collections::slug`: these files are synced, and two computers could each
/// independently run this migration before ever syncing with each other, so migration-assigned
/// ids must converge rather than fork. Not used for service types created normally afterward.
fn slug(name: &str) -> String {
    let normalized = normalize(name);
    let mut result = String::new();
    for ch in normalized.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
        } else if !result.ends_with('-') && !result.is_empty() {
            result.push('-');
        }
    }
    while result.ends_with('-') {
        result.pop();
    }
    if result.is_empty() {
        format!("unnamed-{}", uuid::Uuid::new_v4())
    } else {
        result
    }
}

/// Same starting values a brand-new install has always seeded (previously
/// `commands::settings::default_library_settings`'s own `service_types` field) — used only when
/// a library has neither legacy settings data nor any services to infer names from, i.e. is
/// genuinely fresh rather than mid-migration.
fn default_service_types() -> Vec<(String, Option<String>)> {
    vec![
        ("Sunday Morning Worship".to_string(), None),
        ("Wednesday Bible Study".to_string(), None),
        ("Other".to_string(), None),
    ]
}

/// Reads the legacy `serviceTypes` array straight out of library-settings.json as raw JSON —
/// it's no longer a `LibrarySettings` struct field. Handles both historical shapes a real file
/// could have (plain string, or the `{ name, description }` object the now-removed flexible
/// deserializer already upgraded bare strings to).
fn legacy_service_types(root: &Path) -> std::io::Result<Vec<(String, Option<String>)>> {
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    let Some(raw) = read_json_file::<Value>(&settings_path)? else {
        return Ok(Vec::new());
    };
    let Some(entries) = raw.get("serviceTypes").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    Ok(entries
        .iter()
        .filter_map(|entry| match entry {
            Value::String(name) => Some((name.clone(), None)),
            Value::Object(_) => {
                let name = entry.get("name")?.as_str()?.to_string();
                let description = entry
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                Some((name, description))
            }
            _ => None,
        })
        .collect())
}

fn service_json_paths(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let base = root.join("services");
    let mut paths = Vec::new();
    if !base.exists() {
        return Ok(paths);
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        for file in fs::read_dir(entry.path())? {
            let file = file?;
            if file.file_type()?.is_file()
                && file.path().extension().and_then(|e| e.to_str()) == Some("json")
            {
                paths.push(file.path());
            }
        }
    }
    Ok(paths)
}

/// One-time migration: before service types had real ids, `Service`'s own type field was named
/// `type` (JSON) and held the type's plain *name* directly; the type list itself lived nested
/// inside library-settings.json's own `serviceTypes` field. Runs once, the first time
/// service-types.json doesn't exist yet.
///
/// Unlike `commands::song_collections`'s equivalent migration, this can't read services through
/// the normal typed `Service` struct to recover the legacy value — `Service::service_type_id`
/// is a genuinely renamed field (`type` -> `serviceTypeId`, not just a reinterpreted existing
/// one like `SongCollectionEntry::collection_id` was), so a typed read of an old file simply has
/// nothing to read: the old `type` key doesn't map to any field at all anymore. Each service
/// file is read and rewritten as raw JSON here instead, specifically to still be able to see it.
///
/// Migration-assigned ids are a deterministic slug of the name, not a random UUID — same
/// multi-machine-convergence reasoning as `song_collections::slug`. `ServiceTemplate`'s own
/// `default_for_service_type_ids` (a list of service type ids, formerly names) is deliberately
/// *not* migrated here: on an old file its old-named key (`defaultForServiceTypes`) simply
/// doesn't map to the renamed field and quietly becomes `None`, which is a safe, non-lossy
/// degradation — `None` already means "fall back to matching by `ServiceTemplate.service_type`'s
/// own name" (see that field's doc comment), which is what an explicit list matching the
/// template's own name would have resolved to anyway in the overwhelmingly common case. Doing a
/// full raw-JSON migration of that nested optional list for a low-stakes, already-gracefully-
/// degrading edge case isn't worth the added complexity.
pub fn migrate_if_needed(root: &Path) -> std::io::Result<()> {
    if service_types::exists(root) {
        return Ok(());
    }

    // One-off manual escape hatch distinct from write_json_file's own rolling `.backup` --
    // given the stakes of rewriting real library data, this snapshot is never auto-cleaned.
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    if let Ok(bytes) = std::fs::read(&settings_path) {
        let snapshot = root.join("library-settings.pre-service-type-id-migration.json");
        if !snapshot.exists() {
            let _ = std::fs::write(&snapshot, &bytes);
        }
    }

    let mut definitions: Vec<ServiceType> = Vec::new();
    let mut id_by_normalized_name: HashMap<String, String> = HashMap::new();

    let legacy = legacy_service_types(root)?;
    let service_paths = service_json_paths(root)?;
    let source = if legacy.is_empty() && service_paths.is_empty() {
        default_service_types()
    } else {
        legacy
    };

    for (name, description) in source {
        let key = normalize(&name);
        if id_by_normalized_name.contains_key(&key) {
            continue;
        }
        let id = format!("type-{}", slug(&name));
        id_by_normalized_name.insert(key, id.clone());
        definitions.push(ServiceType {
            id,
            name: name.trim().to_string(),
            description,
        });
    }

    for path in service_paths {
        let Some(mut raw) = read_json_file::<Value>(&path)? else {
            continue;
        };
        let Some(obj) = raw.as_object_mut() else {
            continue;
        };
        let already_migrated = obj
            .get("serviceTypeId")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty());
        if already_migrated {
            continue;
        }
        let legacy_name = obj
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if legacy_name.trim().is_empty() {
            continue;
        }
        let key = normalize(&legacy_name);
        let id = if let Some(existing) = id_by_normalized_name.get(&key) {
            existing.clone()
        } else {
            let id = format!("type-{}", slug(&legacy_name));
            id_by_normalized_name.insert(key, id.clone());
            definitions.push(ServiceType {
                id: id.clone(),
                name: legacy_name.trim().to_string(),
                description: None,
            });
            id
        };
        obj.insert("serviceTypeId".to_string(), Value::String(id));
        write_json_file(&path, &raw)?;
    }

    service_types::replace_all(root, &definitions)?;
    Ok(())
}

#[tauri::command]
pub fn list_service_types(app: AppHandle) -> Result<Vec<ServiceType>, String> {
    let root = library_root(&app);
    migrate_if_needed(&root).map_err(|e| e.to_string())?;
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
    use serde_json::json;

    #[test]
    fn migrates_string_shaped_legacy_types_and_rewrites_service_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTypes": ["Sunday Worship", { "name": "Communion", "description": "Monthly" }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "type": "Sunday Worship" }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_types::list(root).unwrap();
        assert_eq!(definitions.len(), 2);
        let communion = definitions.iter().find(|d| d.name == "Communion").unwrap();
        assert_eq!(communion.description.as_deref(), Some("Monthly"));

        let migrated: Value =
            read_json_file(&root.join("services").join("2026").join("svc-1.json"))
                .unwrap()
                .unwrap();
        let sunday_worship = definitions
            .iter()
            .find(|d| d.name == "Sunday Worship")
            .unwrap();
        assert_eq!(migrated["serviceTypeId"], sunday_worship.id);
    }

    #[test]
    fn name_matching_is_trimmed_and_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTypes": ["Sunday Worship"] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "type": "  sunday worship  " }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        assert_eq!(service_types::list(root).unwrap().len(), 1);
    }

    #[test]
    fn auto_creates_a_definition_for_a_service_referencing_a_name_missing_from_the_legacy_list() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTypes": [] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "type": "Orphaned Type" }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_types::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Orphaned Type");
    }

    #[test]
    fn seeds_sensible_defaults_for_a_genuinely_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        migrate_if_needed(dir.path()).unwrap();
        let definitions = service_types::list(dir.path()).unwrap();
        assert_eq!(definitions.len(), 3);
        assert!(definitions
            .iter()
            .any(|d| d.name == "Sunday Morning Worship"));
    }

    #[test]
    fn does_not_reseed_defaults_when_legacy_data_exists_but_is_empty_and_services_exist() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "type": "Custom Type" }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_types::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Custom Type");
    }

    #[test]
    fn is_a_no_op_once_service_types_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        service_types::save(
            root,
            ServiceType {
                id: "type-existing".to_string(),
                name: "Already Migrated".to_string(),
                description: None,
            },
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_types::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Already Migrated");
    }

    #[test]
    fn two_independent_migrations_of_the_same_name_converge_on_the_same_id() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        for root in [dir_a.path(), dir_b.path()] {
            write_json_file(
                &root.join("library-settings.json"),
                &json!({ "serviceTypes": ["Sunday Worship"] }),
            )
            .unwrap();
            migrate_if_needed(root).unwrap();
        }
        let id_a = service_types::list(dir_a.path()).unwrap()[0].id.clone();
        let id_b = service_types::list(dir_b.path()).unwrap()[0].id.clone();
        assert_eq!(id_a, id_b);
    }
}
