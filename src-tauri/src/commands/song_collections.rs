use tauri::AppHandle;

use crate::domain::song_collections;
use crate::models::SongCollectionDefinition;
use crate::paths::library_root;

#[tauri::command]
pub fn list_song_collections(app: AppHandle) -> Result<Vec<SongCollectionDefinition>, String> {
    song_collections::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_song_collection(
    app: AppHandle,
    collection: SongCollectionDefinition,
) -> Result<SongCollectionDefinition, String> {
    song_collections::save(&library_root(&app), collection).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_song_collection(app: AppHandle, id: String) -> Result<(), String> {
    song_collections::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}
