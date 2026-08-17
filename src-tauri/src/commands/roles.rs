use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::AppHandle;

use crate::domain::{read_json_file, role_groups, roles, write_json_file};
use crate::models::{RoleDefinition, RoleGroupDefinition};
use crate::paths::library_root;

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";
/// Shared with `commands::settings::clear_migration_snapshots` so the one-off cleanup command
/// can never drift from the filename this migration actually writes.
pub const MIGRATION_SNAPSHOT_FILE: &str = "library-settings.pre-role-id-migration.json";

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

/// Reads the legacy `roleGroups` array straight out of library-settings.json as raw JSON —
/// it's no longer a `LibrarySettings` struct field. Returns `(group name, member role names)`
/// pairs, mirroring the old nested shape (`RoleGroup { name, roles: Vec<String> }`).
fn legacy_role_groups(root: &Path) -> std::io::Result<Vec<(String, Vec<String>)>> {
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    let Some(raw) = read_json_file::<Value>(&settings_path)? else {
        return Ok(Vec::new());
    };
    let Some(groups) = raw.get("roleGroups").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    Ok(groups
        .iter()
        .filter_map(|group| {
            let name = group.get("name")?.as_str()?.to_string();
            let role_names = group
                .get("roles")
                .and_then(Value::as_array)
                .map(|roles| {
                    roles
                        .iter()
                        .filter_map(|r| r.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some((name, role_names))
        })
        .collect())
}

/// Lazily creates (at most once) a catch-all group for a role name discovered only via a
/// reference (a service/person/template) rather than the legacy `roleGroups` list itself —
/// unlike `ServiceType`/`SongCollectionDefinition`, a `RoleDefinition` requires a `groupId`, so
/// an orphaned reference needs *some* group to land in rather than being dropped.
fn ensure_uncategorized_group(
    group_definitions: &mut Vec<RoleGroupDefinition>,
    uncategorized_group_id: &mut Option<String>,
) -> String {
    if let Some(id) = uncategorized_group_id {
        return id.clone();
    }
    let id = "group-uncategorized".to_string();
    group_definitions.push(RoleGroupDefinition {
        id: id.clone(),
        name: "Uncategorized".to_string(),
    });
    *uncategorized_group_id = Some(id.clone());
    id
}

/// Resolves a role name to its id against the definitions built so far, auto-creating one
/// (in the Uncategorized group) for a name nothing already knows about — never drops or nulls
/// a historical reference. Shared by every reference site below (service items/assignments,
/// people's preferred roles, bulletin serving-schedule roles, service template items).
#[allow(clippy::too_many_arguments)]
fn resolve_or_create_role(
    name: &str,
    role_definitions: &mut Vec<RoleDefinition>,
    role_id_by_normalized_name: &mut HashMap<String, String>,
    group_definitions: &mut Vec<RoleGroupDefinition>,
    uncategorized_group_id: &mut Option<String>,
) -> String {
    let key = normalize(name);
    if let Some(existing) = role_id_by_normalized_name.get(&key) {
        return existing.clone();
    }
    let group_id = ensure_uncategorized_group(group_definitions, uncategorized_group_id);
    let id = format!("role-{}", slug(name));
    role_id_by_normalized_name.insert(key, id.clone());
    role_definitions.push(RoleDefinition {
        id: id.clone(),
        name: name.trim().to_string(),
        group_id,
    });
    id
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

fn people_json_paths(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let base = root.join("people");
    let mut paths = Vec::new();
    if !base.exists() {
        return Ok(paths);
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && entry.path().extension().and_then(|e| e.to_str()) == Some("json")
        {
            paths.push(entry.path());
        }
    }
    Ok(paths)
}

/// One-time migration: before roles had real ids, a role was just a bare string living inside
/// whichever `RoleGroup.roles` array contained it (itself nested inside library-settings.json's
/// `roleGroups` field), and every reference site (`RoleAssignment.role`, `ServiceItem.role`,
/// `ServiceTemplateItem.role`, `Person.preferredRoles`, `BulletinSettings.servingScheduleRoles`)
/// held the role's plain name directly. Runs once, the first time `roles.json` doesn't exist
/// yet — unlike `service_types`/`song_collections`, this is called eagerly from
/// `commands::settings::load_library_settings` (not just from `list_roles`/`list_role_groups`),
/// since `ServiceTemplateItem.role_id` and `BulletinSettings.serving_schedule_role_ids` stay
/// nested inside `LibrarySettings` (a future phase splits `ServiceTemplate` into its own file)
/// and need to be correct as soon as anything reads settings at all, not only once someone
/// happens to open Settings > Roles first.
///
/// Migration-assigned ids are a deterministic slug of the (trimmed, lowercased) name, not a
/// random UUID — same multi-machine-convergence reasoning as `song_collections::slug`. Roles
/// created normally after migration still get an ordinary random id, matching every other
/// content type.
///
/// Like `song_collections`'s migration, this isn't independently crash-atomic across every step
/// (writing `role-groups.json`/`roles.json` happens last, after every reference site has been
/// rewritten) — a crash in that narrow window is a real but very unlikely edge case, and its
/// failure mode is graceful (a not-yet-committed auto-created role's `roleId` won't resolve to
/// any definition until the library is re-migrated or the record is re-saved) rather than data
/// loss, an acceptable trade against full crash-atomicity for a fast, synchronous, local
/// operation — see that migration's own doc comment for the fuller reasoning.
pub fn migrate_if_needed(root: &Path) -> std::io::Result<()> {
    if roles::exists(root) {
        return Ok(());
    }

    // One-off manual escape hatch distinct from write_json_file's own rolling `.backup` --
    // given the stakes of rewriting real library data, this snapshot is never auto-cleaned.
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    if let Ok(bytes) = std::fs::read(&settings_path) {
        let snapshot = root.join(MIGRATION_SNAPSHOT_FILE);
        if !snapshot.exists() {
            let _ = std::fs::write(&snapshot, &bytes);
        }
    }

    let mut group_definitions: Vec<RoleGroupDefinition> = Vec::new();
    let mut group_id_by_normalized_name: HashMap<String, String> = HashMap::new();
    let mut role_definitions: Vec<RoleDefinition> = Vec::new();
    let mut role_id_by_normalized_name: HashMap<String, String> = HashMap::new();
    let mut uncategorized_group_id: Option<String> = None;

    for (group_name, role_names) in legacy_role_groups(root)? {
        let group_key = normalize(&group_name);
        let group_id = if let Some(existing) = group_id_by_normalized_name.get(&group_key) {
            existing.clone()
        } else {
            let id = format!("group-{}", slug(&group_name));
            group_id_by_normalized_name.insert(group_key, id.clone());
            group_definitions.push(RoleGroupDefinition {
                id: id.clone(),
                name: group_name.trim().to_string(),
            });
            id
        };
        for role_name in role_names {
            let role_key = normalize(&role_name);
            // A role belongs to exactly one group under the new model — first occurrence (its
            // originally-nested group) wins if the same role name somehow appeared under more
            // than one legacy group.
            if role_id_by_normalized_name.contains_key(&role_key) {
                continue;
            }
            let role_id = format!("role-{}", slug(&role_name));
            role_id_by_normalized_name.insert(role_key, role_id.clone());
            role_definitions.push(RoleDefinition {
                id: role_id,
                name: role_name.trim().to_string(),
                group_id: group_id.clone(),
            });
        }
    }

    for path in service_json_paths(root)? {
        let Some(mut raw) = read_json_file::<Value>(&path)? else {
            continue;
        };
        let Some(obj) = raw.as_object_mut() else {
            continue;
        };
        let mut changed = false;

        if let Some(items) = obj.get_mut("items").and_then(Value::as_array_mut) {
            for item in items.iter_mut() {
                let Some(item_obj) = item.as_object_mut() else {
                    continue;
                };
                let already_migrated = item_obj
                    .get("roleId")
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty());
                if already_migrated {
                    continue;
                }
                let Some(name) = item_obj
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                else {
                    continue;
                };
                if name.trim().is_empty() {
                    continue;
                }
                let id = resolve_or_create_role(
                    &name,
                    &mut role_definitions,
                    &mut role_id_by_normalized_name,
                    &mut group_definitions,
                    &mut uncategorized_group_id,
                );
                item_obj.insert("roleId".to_string(), Value::String(id));
                changed = true;
            }
        }

        if let Some(assignments) = obj.get_mut("assignments").and_then(Value::as_array_mut) {
            for assignment in assignments.iter_mut() {
                let Some(a_obj) = assignment.as_object_mut() else {
                    continue;
                };
                let already_migrated = a_obj
                    .get("roleId")
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty());
                if already_migrated {
                    continue;
                }
                let Some(name) = a_obj
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                else {
                    continue;
                };
                if name.trim().is_empty() {
                    continue;
                }
                let id = resolve_or_create_role(
                    &name,
                    &mut role_definitions,
                    &mut role_id_by_normalized_name,
                    &mut group_definitions,
                    &mut uncategorized_group_id,
                );
                a_obj.insert("roleId".to_string(), Value::String(id));
                changed = true;
            }
        }

        if changed {
            write_json_file(&path, &raw)?;
        }
    }

    for path in people_json_paths(root)? {
        let Some(mut raw) = read_json_file::<Value>(&path)? else {
            continue;
        };
        let Some(obj) = raw.as_object_mut() else {
            continue;
        };
        if obj.get("preferredRoleIds").is_some() {
            continue;
        }
        let Some(names) = obj.get("preferredRoles").and_then(Value::as_array) else {
            continue;
        };
        let ids: Vec<Value> = names
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .map(|name| {
                Value::String(resolve_or_create_role(
                    name,
                    &mut role_definitions,
                    &mut role_id_by_normalized_name,
                    &mut group_definitions,
                    &mut uncategorized_group_id,
                ))
            })
            .collect();
        obj.insert("preferredRoleIds".to_string(), Value::Array(ids));
        write_json_file(&path, &raw)?;
    }

    // library-settings.json itself: bulletin.servingScheduleRoles -> servingScheduleRoleIds,
    // and serviceTemplates[].items[].role -> roleId — both fields stay nested inside
    // LibrarySettings (a future phase splits ServiceTemplate out into its own file), so unlike
    // service_types/song_collections this migration also has to rewrite library-settings.json
    // itself, not just read from it.
    if let Some(mut raw) = read_json_file::<Value>(&settings_path)? {
        let mut changed = false;
        if let Some(obj) = raw.as_object_mut() {
            if let Some(bulletin) = obj.get_mut("bulletin").and_then(Value::as_object_mut) {
                if bulletin.get("servingScheduleRoleIds").is_none() {
                    if let Some(names) = bulletin
                        .get("servingScheduleRoles")
                        .and_then(Value::as_array)
                    {
                        let ids: Vec<Value> = names
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|name| !name.trim().is_empty())
                            .map(|name| {
                                Value::String(resolve_or_create_role(
                                    name,
                                    &mut role_definitions,
                                    &mut role_id_by_normalized_name,
                                    &mut group_definitions,
                                    &mut uncategorized_group_id,
                                ))
                            })
                            .collect();
                        bulletin.insert("servingScheduleRoleIds".to_string(), Value::Array(ids));
                        changed = true;
                    }
                }
            }
            if let Some(templates) = obj
                .get_mut("serviceTemplates")
                .and_then(Value::as_array_mut)
            {
                for template in templates.iter_mut() {
                    let Some(items) = template.get_mut("items").and_then(Value::as_array_mut)
                    else {
                        continue;
                    };
                    for item in items.iter_mut() {
                        let Some(item_obj) = item.as_object_mut() else {
                            continue;
                        };
                        let already_migrated = item_obj
                            .get("roleId")
                            .and_then(Value::as_str)
                            .is_some_and(|v| !v.is_empty());
                        if already_migrated {
                            continue;
                        }
                        let Some(name) = item_obj
                            .get("role")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                        else {
                            continue;
                        };
                        if name.trim().is_empty() {
                            continue;
                        }
                        let id = resolve_or_create_role(
                            &name,
                            &mut role_definitions,
                            &mut role_id_by_normalized_name,
                            &mut group_definitions,
                            &mut uncategorized_group_id,
                        );
                        item_obj.insert("roleId".to_string(), Value::String(id));
                        changed = true;
                    }
                }
            }
        }
        if changed {
            write_json_file(&settings_path, &raw)?;
        }
    }

    role_groups::replace_all(root, &group_definitions)?;
    roles::replace_all(root, &role_definitions)?;
    Ok(())
}

#[tauri::command]
pub fn list_role_groups(app: AppHandle) -> Result<Vec<RoleGroupDefinition>, String> {
    let root = library_root(&app);
    migrate_if_needed(&root).map_err(|e| e.to_string())?;
    role_groups::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_role_group(
    app: AppHandle,
    role_group: RoleGroupDefinition,
) -> Result<RoleGroupDefinition, String> {
    role_groups::save(&library_root(&app), role_group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_role_group(app: AppHandle, id: String) -> Result<(), String> {
    role_groups::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_roles(app: AppHandle) -> Result<Vec<RoleDefinition>, String> {
    let root = library_root(&app);
    migrate_if_needed(&root).map_err(|e| e.to_string())?;
    roles::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_role(app: AppHandle, role: RoleDefinition) -> Result<RoleDefinition, String> {
    roles::save(&library_root(&app), role).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_role(app: AppHandle, id: String) -> Result<(), String> {
    roles::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrates_string_shaped_legacy_role_groups_and_rewrites_service_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "roleGroups": [{ "name": "Praise Team", "roles": ["Guitar", "Vocals"] }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({
                "id": "svc-1",
                "date": "2026-08-16",
                "items": [{ "id": "item-1", "type": "sermon", "role": "Guitar" }],
                "assignments": [{ "role": "Vocals", "tentative": false }],
            }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let groups = role_groups::list(root).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Praise Team");

        let definitions = roles::list(root).unwrap();
        assert_eq!(definitions.len(), 2);
        let guitar = definitions.iter().find(|r| r.name == "Guitar").unwrap();
        let vocals = definitions.iter().find(|r| r.name == "Vocals").unwrap();
        assert_eq!(guitar.group_id, groups[0].id);
        assert_eq!(vocals.group_id, groups[0].id);

        let migrated: Value =
            read_json_file(&root.join("services").join("2026").join("svc-1.json"))
                .unwrap()
                .unwrap();
        assert_eq!(migrated["items"][0]["roleId"], guitar.id);
        assert_eq!(migrated["assignments"][0]["roleId"], vocals.id);
    }

    #[test]
    fn name_matching_is_trimmed_and_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "roleGroups": [{ "name": "Praise Team", "roles": ["Guitar"] }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "assignments": [{ "role": "  guitar  ", "tentative": false }] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        assert_eq!(
            roles::list(root).unwrap().len(),
            1,
            "drifted casing/whitespace must not fork a duplicate"
        );
    }

    #[test]
    fn auto_creates_an_uncategorized_role_for_a_reference_missing_from_the_legacy_list() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "roleGroups": [] }),
        )
        .unwrap();
        write_json_file(
            &root.join("services").join("2026").join("svc-1.json"),
            &json!({ "id": "svc-1", "date": "2026-08-16", "assignments": [{ "role": "Orphaned Role", "tentative": false }] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = roles::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Orphaned Role");
        let groups = role_groups::list(root).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Uncategorized");
        assert_eq!(definitions[0].group_id, groups[0].id);
    }

    #[test]
    fn migrates_a_persons_preferred_roles() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "roleGroups": [{ "name": "Praise Team", "roles": ["Vocals"] }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("people").join("person-1.json"),
            &json!({ "id": "person-1", "firstName": "A", "lastName": "B", "preferredRoles": ["Vocals"] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let vocals = roles::list(root).unwrap().into_iter().next().unwrap();
        let migrated: Value = read_json_file(&root.join("people").join("person-1.json"))
            .unwrap()
            .unwrap();
        assert_eq!(migrated["preferredRoleIds"][0], vocals.id);
    }

    #[test]
    fn migrates_bulletin_serving_schedule_roles_and_service_template_items() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({
                "roleGroups": [{ "name": "Support", "roles": ["Nursery"] }],
                "bulletin": { "servingScheduleRoles": ["Nursery"] },
                "serviceTemplates": [{
                    "serviceType": "Sunday Morning Worship",
                    "items": [{ "id": "t1", "kind": "role-only", "label": "Nursery", "role": "Nursery" }],
                }],
            }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let nursery = roles::list(root).unwrap().into_iter().next().unwrap();
        let migrated: Value = read_json_file(&root.join("library-settings.json"))
            .unwrap()
            .unwrap();
        assert_eq!(
            migrated["bulletin"]["servingScheduleRoleIds"][0],
            nursery.id
        );
        assert_eq!(
            migrated["serviceTemplates"][0]["items"][0]["roleId"],
            nursery.id
        );
    }

    #[test]
    fn is_a_no_op_once_roles_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        role_groups::save(
            root,
            RoleGroupDefinition {
                id: "group-existing".to_string(),
                name: "Already Migrated".to_string(),
            },
        )
        .unwrap();
        roles::save(
            root,
            RoleDefinition {
                id: "role-existing".to_string(),
                name: "Already Migrated".to_string(),
                group_id: "group-existing".to_string(),
            },
        )
        .unwrap();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "roleGroups": [{ "name": "Should Be Ignored", "roles": [] }] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let groups = role_groups::list(root).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Already Migrated");
        let definitions = roles::list(root).unwrap();
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
                &json!({ "roleGroups": [{ "name": "Praise Team", "roles": ["Guitar"] }] }),
            )
            .unwrap();
            migrate_if_needed(root).unwrap();
        }
        let group_a = &role_groups::list(dir_a.path()).unwrap()[0];
        let group_b = &role_groups::list(dir_b.path()).unwrap()[0];
        assert_eq!(group_a.id, group_b.id);
        let role_a = &roles::list(dir_a.path()).unwrap()[0];
        let role_b = &roles::list(dir_b.path()).unwrap()[0];
        assert_eq!(role_a.id, role_b.id);
    }
}
