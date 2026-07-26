use tauri::AppHandle;

use crate::domain::sync::{ConflictedItem, SyncStatus};
use crate::domain::{manifest, sync};
use crate::paths::library_root;

#[tauri::command]
pub fn get_sync_status(app: AppHandle) -> Result<SyncStatus, String> {
    sync::get_status(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sync_conflicts(app: AppHandle) -> Result<Vec<ConflictedItem>, String> {
    sync::detect_conflicts(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resolve_sync_conflict(
    app: AppHandle,
    conflict_file_path: String,
    keep: String,
) -> Result<(), String> {
    let root = library_root(&app);
    sync::resolve_conflict(&conflict_file_path, &keep).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}
