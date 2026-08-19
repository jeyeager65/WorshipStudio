use std::fs;
use std::path::{Path, PathBuf};

use crate::models::Service;

use super::{delete_file_if_exists, read_json_dir, write_json_file};

fn services_root(root: &Path) -> PathBuf {
    root.join("services")
}

fn year_of(date: &str) -> &str {
    // Dates are stored as YYYY-MM-DD; falls back to a catch-all bucket for anything malformed
    // rather than failing the save outright.
    if date.len() >= 4 {
        &date[0..4]
    } else {
        "unknown"
    }
}

fn service_path(root: &Path, year: &str, id: &str) -> PathBuf {
    services_root(root).join(year).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Service>> {
    let base = services_root(root);
    let mut services = Vec::new();
    if !base.exists() {
        return Ok(services);
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            services.extend(read_json_dir::<Service>(&entry.path())?);
        }
    }
    Ok(services)
}

pub fn get(root: &Path, id: &str) -> std::io::Result<Option<Service>> {
    Ok(list(root)?.into_iter().find(|s| s.id == id))
}

/// Removes any existing file for this id across all year folders — needed so changing a
/// service's date (which changes which year folder it belongs in) doesn't leave a stale
/// orphaned copy behind in the old folder.
fn remove_existing_except(root: &Path, id: &str, keep: Option<&Path>) -> std::io::Result<()> {
    let base = services_root(root);
    if !base.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let candidate = entry.path().join(format!("{id}.json"));
            if keep.is_none_or(|keep| candidate != keep) {
                delete_file_if_exists(&candidate)?;
            }
        }
    }
    Ok(())
}

pub fn save(
    root: &Path,
    mut service: Service,
    device: &str,
    now: &str,
) -> std::io::Result<Service> {
    service.updated_at = now.to_string();
    service.updated_by_device = device.to_string();
    let year = year_of(&service.date).to_string();
    let destination = service_path(root, &year, &service.id);
    // Commit the new version before removing a copy from an old year folder. If the write
    // fails, the previous service remains intact and visible.
    write_json_file(&destination, &service)?;
    remove_existing_except(root, &service.id, Some(&destination))?;
    Ok(service)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    remove_existing_except(root, id, None)
}

pub fn list_upcoming(root: &Path, from_date: &str, to_date: &str) -> std::io::Result<Vec<Service>> {
    Ok(list(root)?
        .into_iter()
        .filter(|s| s.date.as_str() >= from_date && s.date.as_str() <= to_date)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, date: &str) -> Service {
        Service {
            id: id.to_string(),
            date: date.to_string(),
            time: None,
            service_type_id: "type-sunday-morning-worship".to_string(),
            planning_notes: None,
            planning_song_ids: None,
            service_template_id: None,
            items: vec![],
            presenter_notes: None,
            assignments: None,
            bulletin_page1_footer: None,
            bulletin_page2_footer: None,
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_places_service_under_its_year_folder() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        assert!(dir.path().join("services/2026/svc-1.json").exists());
    }

    #[test]
    fn get_finds_a_service_without_knowing_its_year_upfront() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        assert_eq!(
            get(dir.path(), "svc-1").unwrap().unwrap().date,
            "2026-07-19"
        );
    }

    #[test]
    fn changing_the_date_moves_the_file_to_the_new_year_folder() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        save(dir.path(), sample("svc-1", "2027-01-05"), "d", "now").unwrap();

        assert!(!dir.path().join("services/2026/svc-1.json").exists());
        assert!(dir.path().join("services/2027/svc-1.json").exists());
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn list_upcoming_filters_by_inclusive_date_range() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-12"), "d", "now").unwrap();
        save(dir.path(), sample("svc-2", "2026-07-19"), "d", "now").unwrap();
        save(dir.path(), sample("svc-3", "2026-08-01"), "d", "now").unwrap();

        let upcoming = list_upcoming(dir.path(), "2026-07-19", "2026-07-31").unwrap();
        assert_eq!(upcoming.len(), 1);
        assert_eq!(upcoming[0].id, "svc-2");
    }
}
