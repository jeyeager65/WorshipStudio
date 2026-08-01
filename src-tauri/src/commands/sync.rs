use tauri::AppHandle;

use crate::domain::sync::{ConflictedItem, RecoveryIssue, SyncStatus};
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
pub fn list_recovery_issues(app: AppHandle) -> Result<Vec<RecoveryIssue>, String> {
    sync::detect_recovery_issues(&library_root(&app)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn recover_library_file(app: AppHandle, file_path: String) -> Result<(), String> {
    let root = library_root(&app);
    sync::recover_from_backup(&root, &file_path).map_err(|error| error.to_string())?;
    manifest::rebuild(&root)
        .map(drop)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn quarantine_library_file(app: AppHandle, file_path: String) -> Result<String, String> {
    let root = library_root(&app);
    let destination =
        sync::quarantine_damaged_file(&root, &file_path).map_err(|error| error.to_string())?;
    manifest::rebuild(&root).map_err(|error| error.to_string())?;
    Ok(destination)
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
