use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::AppHandle;

use crate::domain::{read_json_file, service_templates, write_json_file};
use crate::models::{ServiceTemplate, ServiceTemplateItem};
use crate::paths::library_root;

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Deterministic id derived from the name — same reasoning as `commands::song_collections`'s
/// own `slug`: these files are synced, and two computers could each independently run this
/// migration before ever syncing with each other, so migration-assigned ids must converge
/// rather than fork.
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

/// Reads the legacy `serviceTemplates` array straight out of library-settings.json as raw JSON —
/// it's no longer a `LibrarySettings` struct field.
fn legacy_service_templates(root: &Path) -> std::io::Result<Vec<Value>> {
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    let Some(raw) = read_json_file::<Value>(&settings_path)? else {
        return Ok(Vec::new());
    };
    Ok(raw
        .get("serviceTemplates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
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

/// One-time migration: before service templates had real ids, a template's `serviceType` field
/// (now `name`) was its only identity, and `Service::service_template_id` (was
/// `serviceTemplateName`) held that plain name directly. Runs once, the first time
/// `service-templates.json` doesn't exist yet — lazily, from `list_service_templates`, like
/// `service_types`/`song_collections` (unlike `commands::roles`, nothing else needs this file's
/// contents to already be correct before its own settings finish loading).
///
/// Each legacy template's `items` array is carried through unmodified rather than re-interpreted
/// — by the time this runs, `commands::roles::migrate_if_needed` has already rewritten those
/// items' `role` fields to `roleId` in place inside library-settings.json (that migration runs
/// eagerly on every settings load, so it always has a head start on this lazy one in practice).
///
/// Migration-assigned ids are a deterministic slug of the (trimmed, lowercased) name, not a
/// random UUID — same multi-machine-convergence reasoning as `song_collections::slug`. Templates
/// created normally after migration still get an ordinary random id, matching every other
/// content type.
pub fn migrate_if_needed(root: &Path) -> std::io::Result<()> {
    if service_templates::exists(root) {
        return Ok(());
    }

    // One-off manual escape hatch distinct from write_json_file's own rolling `.backup` --
    // given the stakes of rewriting real library data, this snapshot is never auto-cleaned.
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    if let Ok(bytes) = std::fs::read(&settings_path) {
        let snapshot = root.join("library-settings.pre-service-template-id-migration.json");
        if !snapshot.exists() {
            let _ = std::fs::write(&snapshot, &bytes);
        }
    }

    let mut definitions: Vec<ServiceTemplate> = Vec::new();
    let mut id_by_normalized_name: HashMap<String, String> = HashMap::new();

    for raw in legacy_service_templates(root)? {
        let Some(name) = raw.get("serviceType").and_then(Value::as_str) else {
            continue;
        };
        let key = normalize(name);
        if id_by_normalized_name.contains_key(&key) {
            continue;
        }
        let id = format!("template-{}", slug(name));
        id_by_normalized_name.insert(key, id.clone());
        let description = raw
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string);
        let default_for_service_type_ids = raw
            .get("defaultForServiceTypeIds")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            });
        let items: Vec<ServiceTemplateItem> = match raw.get("items") {
            Some(value) => serde_json::from_value(value.clone()).map_err(std::io::Error::other)?,
            None => Vec::new(),
        };
        definitions.push(ServiceTemplate {
            id,
            name: name.trim().to_string(),
            description,
            default_for_service_type_ids,
            items,
        });
    }

    // Every service's own template reference — rewrite name -> id, auto-creating a definition
    // for anything a service references that the legacy list didn't have (drift between the two
    // is realistic in data entered over months by different people).
    for path in service_json_paths(root)? {
        let Some(mut raw) = read_json_file::<Value>(&path)? else {
            continue;
        };
        let Some(obj) = raw.as_object_mut() else {
            continue;
        };
        let already_migrated = obj
            .get("serviceTemplateId")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty());
        if already_migrated {
            continue;
        }
        let Some(name) = obj
            .get("serviceTemplateName")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }
        let key = normalize(&name);
        let id = if let Some(existing) = id_by_normalized_name.get(&key) {
            existing.clone()
        } else {
            let id = format!("template-{}", slug(&name));
            id_by_normalized_name.insert(key, id.clone());
            definitions.push(ServiceTemplate {
                id: id.clone(),
                name: name.trim().to_string(),
                description: None,
                default_for_service_type_ids: None,
                items: Vec::new(),
            });
            id
        };
        obj.insert("serviceTemplateId".to_string(), Value::String(id));
        write_json_file(&path, &raw)?;
    }

    service_templates::replace_all(root, &definitions)?;
    Ok(())
}

#[tauri::command]
pub fn list_service_templates(app: AppHandle) -> Result<Vec<ServiceTemplate>, String> {
    let root = library_root(&app);
    migrate_if_needed(&root).map_err(|e| e.to_string())?;
    service_templates::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_service_template(
    app: AppHandle,
    service_template: ServiceTemplate,
) -> Result<ServiceTemplate, String> {
    service_templates::save(&library_root(&app), service_template).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service_template(app: AppHandle, id: String) -> Result<(), String> {
    service_templates::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrates_string_shaped_legacy_templates_and_rewrites_service_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTemplates": [{
                "serviceType": "Sunday Worship",
                "description": "The usual order",
                "defaultForServiceTypeIds": ["type-sunday"],
                "items": [{ "id": "t1", "kind": "sermon", "label": "Sermon" }],
            }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "serviceTemplateName": "Sunday Worship" }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_templates::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        let sunday = &definitions[0];
        assert_eq!(sunday.name, "Sunday Worship");
        assert_eq!(sunday.description.as_deref(), Some("The usual order"));
        assert_eq!(
            sunday.default_for_service_type_ids.as_deref(),
            Some(&["type-sunday".to_string()][..])
        );
        assert_eq!(sunday.items.len(), 1);

        let migrated: Value =
            read_json_file(&root.join("services").join("2026").join("svc-1.json"))
                .unwrap()
                .unwrap();
        assert_eq!(migrated["serviceTemplateId"], sunday.id);
    }

    #[test]
    fn name_matching_is_trimmed_and_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTemplates": [{ "serviceType": "Sunday Worship", "items": [] }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "serviceTemplateName": "  sunday worship  " }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        assert_eq!(
            service_templates::list(root).unwrap().len(),
            1,
            "drifted casing/whitespace must not fork a duplicate"
        );
    }

    #[test]
    fn auto_creates_a_definition_for_a_service_referencing_a_name_missing_from_the_legacy_list() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTemplates": [] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "serviceTemplateName": "Orphaned Template" }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_templates::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Orphaned Template");
        let migrated: Value =
            read_json_file(&root.join("services").join("2026").join("svc-1.json"))
                .unwrap()
                .unwrap();
        assert_eq!(migrated["serviceTemplateId"], definitions[0].id);
    }

    #[test]
    fn is_a_no_op_once_service_templates_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        service_templates::save(
            root,
            ServiceTemplate {
                id: "template-existing".to_string(),
                name: "Already Migrated".to_string(),
                description: None,
                default_for_service_type_ids: None,
                items: vec![],
            },
        )
        .unwrap();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "serviceTemplates": [{ "serviceType": "Should Be Ignored", "items": [] }] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = service_templates::list(root).unwrap();
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
                &json!({ "serviceTemplates": [{ "serviceType": "Sunday Worship", "items": [] }] }),
            )
            .unwrap();
            migrate_if_needed(root).unwrap();
        }
        let id_a = service_templates::list(dir_a.path()).unwrap()[0].id.clone();
        let id_b = service_templates::list(dir_b.path()).unwrap()[0].id.clone();
        assert_eq!(id_a, id_b);
    }
}
