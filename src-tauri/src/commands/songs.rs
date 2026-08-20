use tauri::AppHandle;

use crate::domain::songs;
use crate::models::Song;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_songs(app: AppHandle) -> Result<Vec<Song>, String> {
    let root = library_root(&app);
    // One-time backfill for a library saved before Song::usage_dates existed -- see
    // songs::migrate_usage_dates_if_needed's own doc comment. Cheap no-op on every call after
    // the first real one (gated on a marker file), so it's safe to invoke unconditionally here.
    songs::migrate_usage_dates_if_needed(&root, &this_device_name(&app), &now_iso())
        .map_err(|e| e.to_string())?;
    songs::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_song(app: AppHandle, id: String) -> Result<Option<Song>, String> {
    songs::get(&library_root(&app), &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_song(app: AppHandle, song: Song) -> Result<(), String> {
    let root = library_root(&app);
    songs::save(&root, song, &this_device_name(&app), &now_iso()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_song(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    songs::delete(&root, &id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_song_opensong_xml(app: AppHandle, xml: String) -> Result<Song, String> {
    let root = library_root(&app);
    let id = format!("song-{}", uuid::Uuid::new_v4());
    let song =
        songs::import_from_opensong_xml(&root, &xml, id, &this_device_name(&app), &now_iso())
            .map_err(|e| e.to_string())?;
    Ok(song)
}
