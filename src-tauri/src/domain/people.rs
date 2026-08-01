use std::path::{Path, PathBuf};

use crate::models::Person;

use super::{delete_file_if_exists, read_json_dir, write_json_file};

fn people_dir(root: &Path) -> PathBuf {
    root.join("people")
}

fn person_path(root: &Path, id: &str) -> PathBuf {
    people_dir(root).join(format!("{id}.json"))
}

pub fn exists(root: &Path, id: &str) -> bool {
    person_path(root, id).is_file()
}

pub fn list(root: &Path) -> std::io::Result<Vec<Person>> {
    read_json_dir(&people_dir(root))
}

pub fn save(root: &Path, mut person: Person, device: &str, now: &str) -> std::io::Result<Person> {
    person.updated_at = now.to_string();
    person.updated_by_device = device.to_string();
    write_json_file(&person_path(root, &person.id), &person)?;
    Ok(person)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&person_path(root, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Person {
        Person {
            id: id.to_string(),
            first_name: "Ashley".to_string(),
            last_name: "Combs".to_string(),
            display_name: None,
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
        save(dir.path(), sample("person-1"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].first_name, "Ashley");
    }

    #[test]
    fn delete_removes_the_item() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("person-1"), "d", "now").unwrap();
        delete(dir.path(), "person-1").unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
}
