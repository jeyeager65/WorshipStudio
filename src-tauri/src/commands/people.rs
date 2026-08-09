use tauri::AppHandle;

use crate::domain::{people, remote};
use crate::models::Person;
use crate::paths::{library_root, now_iso, remote_devices_path, this_device_name};

#[tauri::command]
pub fn list_people(app: AppHandle) -> Result<Vec<Person>, String> {
    people::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_person(app: AppHandle, person: Person) -> Result<(), String> {
    let root = library_root(&app);
    people::save(&root, person, &this_device_name(&app), &now_iso()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_person(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    people::delete(&root, &id).map_err(|e| e.to_string())?;
    remote::delete_by_person(&remote_devices_path(&app), &id).map_err(|e| e.to_string())?;
    Ok(())
}
