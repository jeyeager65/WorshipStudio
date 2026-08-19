use std::path::{Path, PathBuf};

use crate::models::RoleGroupDefinition;

use super::{read_json_file, write_json_file};

/// A peer of `library-settings.json`, not nested inside it — one small file holding the whole
/// list, not one-file-per-item like songs/services/etc. (low-cardinality taxonomy data, not
/// worth the per-item conflict-reduction machinery).
fn role_groups_path(root: &Path) -> PathBuf {
    root.join("role-groups.json")
}

pub fn list(root: &Path) -> std::io::Result<Vec<RoleGroupDefinition>> {
    Ok(read_json_file(&role_groups_path(root))?.unwrap_or_default())
}

/// Upserts by id into the whole-list file — there's no per-item file to target individually.
pub fn save(root: &Path, item: RoleGroupDefinition) -> std::io::Result<RoleGroupDefinition> {
    let mut items = list(root)?;
    match items.iter_mut().find(|existing| existing.id == item.id) {
        Some(existing) => *existing = item.clone(),
        None => items.push(item.clone()),
    }
    write_json_file(&role_groups_path(root), &items)?;
    Ok(item)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    let mut items = list(root)?;
    items.retain(|item| item.id != id);
    write_json_file(&role_groups_path(root), &items)
}

/// The `.backup` sibling `write_json_file` keeps beside this file — never touched by ordinary
/// deletes (which only ever shrink the list, never remove the file itself), so it can still hold
/// church-specific content someone asked Clear Existing Data to erase. See
/// `commands::settings::clear_settings_list_backups`, the one place this is used.
pub fn backup_path(root: &Path) -> PathBuf {
    super::backup_path(&role_groups_path(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str) -> RoleGroupDefinition {
        RoleGroupDefinition {
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("group-1", "Praise Team")).unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].name, "Praise Team");
    }

    #[test]
    fn save_updates_an_existing_item_in_place_rather_than_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("group-1", "Praise Team")).unwrap();
        save(dir.path(), sample("group-1", "Worship Team")).unwrap();
        let items = list(dir.path()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Worship Team");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("group-1", "Praise Team")).unwrap();
        delete(dir.path(), "group-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_on_a_fresh_library_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
}
