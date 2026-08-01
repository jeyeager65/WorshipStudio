use std::path::Path;

use crate::models::RemoteDevice;

use super::{read_json_file, write_json_file};

/// Whole-list-in-one-file, same reasoning as external_apps: a handful of provisioned devices
/// at most, no Dropbox-conflict concern since this is per-machine and never synced.
pub fn list(remote_devices_path: &Path) -> Vec<RemoteDevice> {
    read_json_file(remote_devices_path).unwrap_or_default()
}

pub fn find_by_token(remote_devices_path: &Path, token: &str) -> Option<RemoteDevice> {
    list(remote_devices_path)
        .into_iter()
        .find(|d| d.token == token)
}

pub fn save(remote_devices_path: &Path, device: RemoteDevice) -> std::io::Result<()> {
    let mut all = list(remote_devices_path);
    match all.iter().position(|d| d.id == device.id) {
        Some(index) => all[index] = device,
        None => all.push(device),
    }
    write_json_file(remote_devices_path, &all)
}

pub fn delete(remote_devices_path: &Path, id: &str) -> std::io::Result<()> {
    let mut all = list(remote_devices_path);
    all.retain(|d| d.id != id);
    write_json_file(remote_devices_path, &all)
}

pub fn delete_by_person(remote_devices_path: &Path, person_id: &str) -> std::io::Result<()> {
    let mut all = list(remote_devices_path);
    all.retain(|device| device.person_id.as_deref() != Some(person_id));
    write_json_file(remote_devices_path, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str, token: &str) -> RemoteDevice {
        RemoteDevice {
            id: id.to_string(),
            person_id: Some("person-1".to_string()),
            name: name.to_string(),
            access_level: "advance-only".to_string(),
            token: token.to_string(),
            updated_at: "now".to_string(),
            updated_by_device: "d".to_string(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-devices.json");
        save(&path, sample("device-1", "John's iPhone", "tok-1")).unwrap();
        assert_eq!(list(&path)[0].name, "John's iPhone");
    }

    #[test]
    fn save_updates_an_existing_device_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-devices.json");
        save(&path, sample("device-1", "John's iPhone", "tok-1")).unwrap();
        let mut updated = sample("device-1", "John's iPad", "tok-1");
        updated.id = "device-1".to_string();
        save(&path, updated).unwrap();

        let all = list(&path);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "John's iPad");
    }

    #[test]
    fn delete_removes_only_the_matching_device() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-devices.json");
        save(&path, sample("device-1", "John's iPhone", "tok-1")).unwrap();
        save(&path, sample("device-2", "Mallory's iPad", "tok-2")).unwrap();

        delete(&path, "device-1").unwrap();

        let all = list(&path);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "device-2");
    }

    #[test]
    fn delete_by_person_revokes_all_of_that_persons_devices() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-devices.json");
        save(&path, sample("device-1", "Phone", "tok-1")).unwrap();
        save(&path, sample("device-2", "Tablet", "tok-2")).unwrap();
        let mut other = sample("device-3", "Other phone", "tok-3");
        other.person_id = Some("person-2".to_string());
        save(&path, other).unwrap();

        delete_by_person(&path, "person-1").unwrap();

        let remaining = list(&path);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].person_id.as_deref(), Some("person-2"));
    }

    #[test]
    fn find_by_token_matches_the_right_device() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-devices.json");
        save(&path, sample("device-1", "John's iPhone", "tok-1")).unwrap();
        save(&path, sample("device-2", "Mallory's iPad", "tok-2")).unwrap();

        assert_eq!(find_by_token(&path, "tok-2").unwrap().id, "device-2");
        assert!(find_by_token(&path, "unknown").is_none());
    }

    #[test]
    fn list_returns_empty_for_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("does-not-exist.json")).is_empty());
    }
}
