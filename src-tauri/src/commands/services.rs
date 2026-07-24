use tauri::AppHandle;

use crate::domain::{manifest, services};
use crate::models::Service;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_services(app: AppHandle) -> Result<Vec<Service>, String> {
    services::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service(app: AppHandle, id: String) -> Result<Option<Service>, String> {
    Ok(services::get(&library_root(&app), &id))
}

#[tauri::command]
pub fn save_service(app: AppHandle, service: Service) -> Result<(), String> {
    let root = library_root(&app);
    services::save(&root, service, &this_device_name(&app), &now_iso())
        .map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_service(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    services::delete(&root, &id).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_upcoming_services(
    app: AppHandle,
    from_date: String,
    to_date: String,
) -> Result<Vec<Service>, String> {
    services::list_upcoming(&library_root(&app), &from_date, &to_date).map_err(|e| e.to_string())
}
