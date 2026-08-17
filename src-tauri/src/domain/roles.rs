use std::path::{Path, PathBuf};

use crate::models::RoleDefinition;

use super::{read_json_file, write_json_file};

/// A peer of `library-settings.json` and `role-groups.json`, not nested inside either — one
/// small file holding the whole list, not one-file-per-item like songs/services/etc.
/// (low-cardinality taxonomy data, not worth the per-item conflict-reduction machinery). See
/// `commands::roles` for the one-time migration off the old nested-in-settings shape.
fn roles_path(root: &Path) -> PathBuf {
    root.join("roles.json")
}

pub fn list(root: &Path) -> std::io::Result<Vec<RoleDefinition>> {
    Ok(read_json_file(&roles_path(root))?.unwrap_or_default())
}

/// Upserts by id into the whole-list file — there's no per-item file to target individually.
pub fn save(root: &Path, item: RoleDefinition) -> std::io::Result<RoleDefinition> {
    let mut items = list(root)?;
    match items.iter_mut().find(|existing| existing.id == item.id) {
        Some(existing) => *existing = item.clone(),
        None => items.push(item.clone()),
    }
    write_json_file(&roles_path(root), &items)?;
    Ok(item)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    let mut items = list(root)?;
    items.retain(|item| item.id != id);
    write_json_file(&roles_path(root), &items)
}

/// Writes the whole list directly — used by the one-time migration (`commands::roles`) to
/// commit the freshly-assigned-id definitions in one shot, rather than one `save()` call per
/// item.
pub fn replace_all(root: &Path, items: &Vec<RoleDefinition>) -> std::io::Result<()> {
    write_json_file(&roles_path(root), items)
}

pub fn exists(root: &Path) -> bool {
    roles_path(root).is_file()
}

/// The `.backup` sibling `write_json_file` keeps beside this file — never touched by ordinary
/// deletes (which only ever shrink the list, never remove the file itself), so it can still hold
/// church-specific content someone asked Clear Existing Data to erase. See
/// `commands::settings::clear_settings_list_backups`, the one place this is used.
pub fn backup_path(root: &Path) -> PathBuf {
    super::backup_path(&roles_path(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str, group_id: &str) -> RoleDefinition {
        RoleDefinition {
            id: id.to_string(),
            name: name.to_string(),
            group_id: group_id.to_string(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("role-1", "Guitar", "group-1")).unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].name, "Guitar");
    }

    #[test]
    fn save_updates_an_existing_item_in_place_rather_than_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("role-1", "Guitar", "group-1")).unwrap();
        save(dir.path(), sample("role-1", "Guitar", "group-2")).unwrap();
        let items = list(dir.path()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].group_id, "group-2");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("role-1", "Guitar", "group-1")).unwrap();
        delete(dir.path(), "role-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_on_a_fresh_library_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
        assert!(!exists(dir.path()));
    }
}
