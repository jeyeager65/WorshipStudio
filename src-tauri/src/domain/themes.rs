use std::path::{Path, PathBuf};

use crate::models::Theme;

use super::{delete_file_if_exists, read_json_dir, write_json_file};

fn themes_dir(root: &Path) -> PathBuf {
    root.join("themes")
}

fn theme_path(root: &Path, id: &str) -> PathBuf {
    themes_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Theme>> {
    read_json_dir(&themes_dir(root))
}

pub fn save(root: &Path, mut theme: Theme, device: &str, now: &str) -> std::io::Result<Theme> {
    theme.updated_at = now.to_string();
    theme.updated_by_device = device.to_string();
    write_json_file(&theme_path(root, &theme.id), &theme)?;
    Ok(theme)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&theme_path(root, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Theme {
        Theme {
            background_color: None,
            id: id.to_string(),
            name: "Brand Blue".to_string(),
            background_id: Some("brand-primary".to_string()),
            font: "Inter".to_string(),
            text_color: "#FFFFFF".to_string(),
            text_effect: None,
            outline: true,
            applies_to: Vec::new(),
            use_as_default_for: vec!["songs".to_string()],
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("theme-1"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].name, "Brand Blue");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("theme-1"), "d", "now").unwrap();
        delete(dir.path(), "theme-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_includes_every_saved_theme() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("theme-1"), "d", "now").unwrap();
        save(dir.path(), sample("theme-2"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 2);
    }
}
