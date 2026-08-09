use tauri::AppHandle;

use crate::domain::announcements;
use crate::models::Announcement;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_announcements(app: AppHandle) -> Result<Vec<Announcement>, String> {
    announcements::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_announcement(app: AppHandle, announcement: Announcement) -> Result<(), String> {
    let root = library_root(&app);
    announcements::save(&root, announcement, &this_device_name(&app), &now_iso())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_announcement(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    announcements::delete(&root, &id).map_err(|e| e.to_string())?;
    Ok(())
}
