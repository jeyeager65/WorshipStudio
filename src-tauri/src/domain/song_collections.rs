use std::path::{Path, PathBuf};

use crate::models::SongCollectionDefinition;

use super::{read_json_file, write_json_file};

/// A peer of `library-settings.json`, not nested inside it — one small file holding the
/// whole list, not one-file-per-item like songs/services/etc. (low-cardinality taxonomy
/// data, not worth the per-item conflict-reduction machinery). See `commands::song_collections`
/// for the one-time migration off the old nested-in-settings shape.
fn collections_path(root: &Path) -> PathBuf {
    root.join("song-collections.json")
}

pub fn list(root: &Path) -> std::io::Result<Vec<SongCollectionDefinition>> {
    Ok(read_json_file(&collections_path(root))?.unwrap_or_default())
}

/// Upserts by id into the whole-list file — there's no per-item file to target individually.
pub fn save(
    root: &Path,
    item: SongCollectionDefinition,
) -> std::io::Result<SongCollectionDefinition> {
    let mut items = list(root)?;
    match items.iter_mut().find(|existing| existing.id == item.id) {
        Some(existing) => *existing = item.clone(),
        None => items.push(item.clone()),
    }
    write_json_file(&collections_path(root), &items)?;
    Ok(item)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    let mut items = list(root)?;
    items.retain(|item| item.id != id);
    write_json_file(&collections_path(root), &items)
}

/// Writes the whole list directly — used by the one-time migration (`commands::song_collections`)
/// to commit the freshly-assigned-id definitions in one shot, rather than one `save()` call
/// per item.
pub fn replace_all(root: &Path, items: &Vec<SongCollectionDefinition>) -> std::io::Result<()> {
    write_json_file(&collections_path(root), items)
}

pub fn exists(root: &Path) -> bool {
    collections_path(root).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str) -> SongCollectionDefinition {
        SongCollectionDefinition {
            id: id.to_string(),
            name: name.to_string(),
            abbreviation: None,
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("collection-1", "Hymnal One")).unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].name, "Hymnal One");
    }

    #[test]
    fn save_updates_an_existing_item_in_place_rather_than_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("collection-1", "Hymnal One")).unwrap();
        save(dir.path(), sample("collection-1", "Renamed Hymnal")).unwrap();
        let items = list(dir.path()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Renamed Hymnal");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("collection-1", "Hymnal One")).unwrap();
        delete(dir.path(), "collection-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_on_a_fresh_library_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
        assert!(!exists(dir.path()));
    }
}
