use tauri::AppHandle;

use crate::domain::songs;
use crate::models::Song;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_songs(app: AppHandle) -> Result<Vec<Song>, String> {
    songs::list(&library_root(&app)).map_err(|e| e.to_string())
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
