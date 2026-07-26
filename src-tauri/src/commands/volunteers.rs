use tauri::AppHandle;

use crate::domain::{manifest, volunteers};
use crate::models::Volunteer;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_volunteers(app: AppHandle) -> Result<Vec<Volunteer>, String> {
    volunteers::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_volunteer(app: AppHandle, volunteer: Volunteer) -> Result<(), String> {
    let root = library_root(&app);
    volunteers::save(&root, volunteer, &this_device_name(&app), &now_iso())
        .map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_volunteer(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    volunteers::delete(&root, &id).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}
