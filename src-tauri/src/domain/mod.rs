pub mod announcements;
pub mod external_apps;
pub mod manifest;
pub mod media;
pub mod opensong;
pub mod opensong_sets;
pub mod people;
pub mod remote;
pub mod scripture;
pub mod services;
pub mod slides;
pub mod songs;
pub mod sync;
pub mod themes;
pub mod win32;

use std::ffi::OsString;
#[cfg(not(windows))]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};

pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("data.json"));
    name.push(".backup");
    path.with_file_name(name)
}

pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> io::Result<Option<T>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(io::Error::new(
                error.kind(),
                format!("Could not read {}: {error}", path.display()),
            ))
        }
    };
    serde_json::from_slice(&bytes).map(Some).map_err(|error| {
        let backup = backup_path(path);
        let recovery = if backup.is_file() {
            format!(" A backup is available at {}.", backup.display())
        } else {
            " No automatic backup is available.".to_string()
        };
        io::Error::new(
            ErrorKind::InvalidData,
            format!(
                "{} contains invalid JSON and was not loaded: {error}.{recovery}",
                path.display()
            ),
        )
    })
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(io::Error::other)
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    if let Some(parent) = _path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

/// Replaces a file from a temporary file in the same directory. Writing and flushing the
/// temporary file before the rename means the destination is always either the complete old
/// version or the complete new version, never a partially-written mixture of the two.
pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other(format!("{} has no parent directory", path.display())))?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data");
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp.write_all(bytes)?;
        temp.sync_all()?;
        drop(temp);
        replace_file(&temp_path, path)?;
        sync_parent_directory(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub fn write_json_file<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    // Serialize before touching either the destination or its backup. A model serialization
    // failure therefore cannot damage the last good version.
    let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    if path.is_file() {
        let previous = fs::read(path)?;
        // Never replace a known-good backup with corrupt bytes. This leaves recovery possible
        // even when a later save follows an external sync corruption.
        if serde_json::from_slice::<serde_json::Value>(&previous).is_ok() {
            atomic_write_bytes(&backup_path(path), &previous)?;
        }
    }
    atomic_write_bytes(path, &bytes)
}

pub fn restore_json_backup(path: &Path) -> io::Result<bool> {
    let backup = backup_path(path);
    let bytes = match fs::read(&backup) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|error| {
        io::Error::new(
            ErrorKind::InvalidData,
            format!(
                "The backup at {} is also invalid: {error}",
                backup.display()
            ),
        )
    })?;
    atomic_write_bytes(path, &bytes)?;
    Ok(true)
}

pub fn delete_file_if_exists(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    let backup = backup_path(path);
    if backup.exists() {
        fs::remove_file(backup)?;
    }
    Ok(())
}

/// Lists the `.json` files directly inside `dir` (non-recursive), reading each as `T`.
/// Missing directory reads as empty rather than an error — a library folder that hasn't
/// been created yet (first run, nothing saved of this kind) is a normal, not exceptional, state.
pub fn read_json_dir<T: DeserializeOwned>(dir: &Path) -> io::Result<Vec<T>> {
    let mut items = Vec::new();
    if !dir.exists() {
        return Ok(items);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(item) = read_json_file(&path)? {
                items.push(item);
            }
        }
    }
    Ok(items)
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use serde::ser::Error as _;

    #[test]
    fn a_second_write_keeps_the_previous_complete_version_as_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("item.json");
        write_json_file(&path, &serde_json::json!({ "version": 1 })).unwrap();
        write_json_file(&path, &serde_json::json!({ "version": 2 })).unwrap();

        let current: serde_json::Value = read_json_file(&path).unwrap().unwrap();
        let backup: serde_json::Value = read_json_file(&backup_path(&path)).unwrap().unwrap();
        assert_eq!(current["version"], 2);
        assert_eq!(backup["version"], 1);
    }

    struct CannotSerialize;

    impl Serialize for CannotSerialize {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(S::Error::custom("intentional test failure"))
        }
    }

    #[test]
    fn serialization_failure_leaves_the_current_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("item.json");
        write_json_file(&path, &serde_json::json!({ "safe": true })).unwrap();

        assert!(write_json_file(&path, &CannotSerialize).is_err());
        let current: serde_json::Value = read_json_file(&path).unwrap().unwrap();
        assert_eq!(current["safe"], true);
        assert!(!backup_path(&path).exists());
    }

    #[test]
    fn invalid_json_reports_the_file_and_available_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("item.json");
        fs::write(&path, "{not json").unwrap();
        fs::write(backup_path(&path), r#"{"safe":true}"#).unwrap();

        let error = read_json_file::<serde_json::Value>(&path).unwrap_err();
        let message = error.to_string();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert!(message.contains("item.json"));
        assert!(message.contains("backup is available"));
    }

    #[test]
    fn restore_backup_replaces_a_damaged_primary_with_the_last_good_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("item.json");
        write_json_file(&path, &serde_json::json!({ "version": 1 })).unwrap();
        write_json_file(&path, &serde_json::json!({ "version": 2 })).unwrap();
        fs::write(&path, "{interrupted").unwrap();

        assert!(restore_json_backup(&path).unwrap());
        let restored: serde_json::Value = read_json_file(&path).unwrap().unwrap();
        assert_eq!(restored["version"], 1);
    }
}
