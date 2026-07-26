use std::path::{Path, PathBuf};

use crate::models::Volunteer;

use super::{delete_file_if_exists, read_json_dir, write_json_file};

fn volunteers_dir(root: &Path) -> PathBuf {
    root.join("volunteers")
}

fn volunteer_path(root: &Path, id: &str) -> PathBuf {
    volunteers_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Volunteer>> {
    read_json_dir(&volunteers_dir(root))
}

pub fn save(
    root: &Path,
    mut volunteer: Volunteer,
    device: &str,
    now: &str,
) -> std::io::Result<Volunteer> {
    volunteer.updated_at = now.to_string();
    volunteer.updated_by_device = device.to_string();
    write_json_file(&volunteer_path(root, &volunteer.id), &volunteer)?;
    Ok(volunteer)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&volunteer_path(root, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Volunteer {
        Volunteer {
            id: id.to_string(),
            first_name: "Ashley".to_string(),
            last_name: "Combs".to_string(),
            email: Some("ashley.combs@email.com".to_string()),
            preferred_roles: vec!["Vocals".to_string()],
            unavailable_date_ranges: vec![],
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("volunteer-1"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].first_name, "Ashley");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("volunteer-1"), "d", "now").unwrap();
        delete(dir.path(), "volunteer-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
}
