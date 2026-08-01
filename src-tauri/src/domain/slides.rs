use std::path::{Path, PathBuf};

use crate::models::SlideLibraryItem;

use super::{delete_file_if_exists, read_json_dir, read_json_file, write_json_file};

fn slides_dir(root: &Path) -> PathBuf {
    root.join("slides")
}

fn slide_path(root: &Path, id: &str) -> PathBuf {
    slides_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<SlideLibraryItem>> {
    read_json_dir(&slides_dir(root))
}

pub fn get(root: &Path, id: &str) -> std::io::Result<Option<SlideLibraryItem>> {
    read_json_file(&slide_path(root, id))
}

pub fn save(
    root: &Path,
    mut item: SlideLibraryItem,
    device: &str,
    now: &str,
) -> std::io::Result<SlideLibraryItem> {
    item.updated_at = now.to_string();
    item.updated_by_device = device.to_string();
    write_json_file(&slide_path(root, &item.id), &item)?;
    Ok(item)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&slide_path(root, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Usage;

    fn sample(id: &str) -> SlideLibraryItem {
        SlideLibraryItem {
            id: id.to_string(),
            label: "Announcements".to_string(),
            tags: vec!["Sunday".to_string()],
            document_version: 2,
            slides: vec![],
            background_id: None,
            loop_config: None,
            usage: Usage {
                last_used_at: None,
                uses_past_year: 0,
            },
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("slide-1"), "d", "now").unwrap();
        let item = get(dir.path(), "slide-1").unwrap().unwrap();
        assert_eq!(item.label, "Announcements");
        assert_eq!(item.tags, vec!["Sunday"]);
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("slide-1"), "d", "now").unwrap();
        delete(dir.path(), "slide-1").unwrap();
        assert!(get(dir.path(), "slide-1").unwrap().is_none());
    }
}
