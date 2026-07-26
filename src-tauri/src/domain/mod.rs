pub mod manifest;
pub mod media;
pub mod opensong;
pub mod opensong_sets;
pub mod scripture;
pub mod services;
pub mod slides;
pub mod songs;
pub mod themes;
pub mod volunteers;

use std::fs;
use std::path::Path;

use serde::{de::DeserializeOwned, Serialize};

pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Option<T> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

pub fn write_json_file<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?,
    )
}

pub fn delete_file_if_exists(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Lists the `.json` files directly inside `dir` (non-recursive), reading each as `T`.
/// Missing directory reads as empty rather than an error — a library folder that hasn't
/// been created yet (first run, nothing saved of this kind) is a normal, not exceptional, state.
pub fn read_json_dir<T: DeserializeOwned>(dir: &Path) -> std::io::Result<Vec<T>> {
    let mut items = Vec::new();
    if !dir.exists() {
        return Ok(items);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(item) = read_json_file(&path) {
                items.push(item);
            }
        }
    }
    Ok(items)
}
