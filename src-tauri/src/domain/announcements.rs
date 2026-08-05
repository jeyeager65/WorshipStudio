use std::path::{Path, PathBuf};

use crate::models::Announcement;

use super::{delete_file_if_exists, read_json_dir, write_json_file};

fn announcements_dir(root: &Path) -> PathBuf {
    root.join("announcements")
}

fn announcement_path(root: &Path, id: &str) -> PathBuf {
    announcements_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Announcement>> {
    read_json_dir(&announcements_dir(root))
}

pub fn save(
    root: &Path,
    mut announcement: Announcement,
    device: &str,
    now: &str,
) -> std::io::Result<Announcement> {
    announcement.updated_at = now.to_string();
    announcement.updated_by_device = device.to_string();
    write_json_file(&announcement_path(root, &announcement.id), &announcement)?;
    Ok(announcement)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&announcement_path(root, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Announcement {
        Announcement {
            id: id.to_string(),
            text: "Snack & prize donations needed for VBS".to_string(),
            event_date: None,
            event_end_date: None,
            event_time: None,
            show_from: None,
            show_until: Some("2026-06-28".to_string()),
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("ann-1"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].text, sample("ann-1").text);
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("ann-1"), "d", "now").unwrap();
        delete(dir.path(), "ann-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_includes_every_saved_announcement() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("ann-1"), "d", "now").unwrap();
        save(dir.path(), sample("ann-2"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 2);
    }
}
