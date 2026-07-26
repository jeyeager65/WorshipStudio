use tauri::AppHandle;

use crate::domain::manifest;
use crate::domain::media::{self, MediaImportCommit, StagedMediaFile};
use crate::models::MediaItem;
use crate::paths::{library_root, local_media_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_media(app: AppHandle) -> Result<Vec<MediaItem>, String> {
    media::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_media(app: AppHandle, item: MediaItem) -> Result<(), String> {
    let root = library_root(&app);
    media::save(&root, item, &this_device_name(&app), &now_iso()).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_media(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    media::delete(&root, &local_media_root(&app), &id).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stage_media_import(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<StagedMediaFile>, String> {
    media::stage_imports(&library_root(&app), &paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn commit_media_import(
    app: AppHandle,
    files: Vec<MediaImportCommit>,
) -> Result<Vec<MediaItem>, String> {
    let root = library_root(&app);
    let created = media::commit_imports(
        &root,
        &local_media_root(&app),
        files,
        &this_device_name(&app),
        &now_iso(),
    )
    .map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(created)
}

#[tauri::command]
pub fn detect_media_duplicates(app: AppHandle, item: MediaItem) -> Result<Vec<MediaItem>, String> {
    media::detect_duplicates(&library_root(&app), &item).map_err(|e| e.to_string())
}
