use std::path::{Path, PathBuf};

use crate::models::ServiceType;

use super::{read_json_file, write_json_file};

/// A peer of `library-settings.json`, not nested inside it — one small file holding the whole
/// list, not one-file-per-item like songs/services/etc. (low-cardinality taxonomy data, not
/// worth the per-item conflict-reduction machinery). See `commands::service_types` for the
/// one-time migration off the old nested-in-settings shape.
fn service_types_path(root: &Path) -> PathBuf {
    root.join("service-types.json")
}

pub fn list(root: &Path) -> std::io::Result<Vec<ServiceType>> {
    Ok(read_json_file(&service_types_path(root))?.unwrap_or_default())
}

/// Upserts by id into the whole-list file — there's no per-item file to target individually.
pub fn save(root: &Path, item: ServiceType) -> std::io::Result<ServiceType> {
    let mut items = list(root)?;
    match items.iter_mut().find(|existing| existing.id == item.id) {
        Some(existing) => *existing = item.clone(),
        None => items.push(item.clone()),
    }
    write_json_file(&service_types_path(root), &items)?;
    Ok(item)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    let mut items = list(root)?;
    items.retain(|item| item.id != id);
    write_json_file(&service_types_path(root), &items)
}

/// Writes the whole list directly — used by the one-time migration (`commands::service_types`)
/// to commit the freshly-assigned-id definitions in one shot, rather than one `save()` call
/// per item.
pub fn replace_all(root: &Path, items: &Vec<ServiceType>) -> std::io::Result<()> {
    write_json_file(&service_types_path(root), items)
}

pub fn exists(root: &Path) -> bool {
    service_types_path(root).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str) -> ServiceType {
        ServiceType {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("type-1", "Sunday Worship")).unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].name, "Sunday Worship");
    }

    #[test]
    fn save_updates_an_existing_item_in_place_rather_than_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("type-1", "Sunday Worship")).unwrap();
        save(dir.path(), sample("type-1", "Sunday Service")).unwrap();
        let items = list(dir.path()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Sunday Service");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("type-1", "Sunday Worship")).unwrap();
        delete(dir.path(), "type-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_on_a_fresh_library_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
        assert!(!exists(dir.path()));
    }
}
