use tauri::AppHandle;

use crate::domain::{manifest, services, songs};
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
    let now = now_iso();
    let device = this_device_name(&app);
    services::save(&root, service, &device, &now).map_err(|e| e.to_string())?;
    // Recomputed from every saved service, not incremented here — the only way a song's "last
    // used" stays correct if its services are later edited or deleted (see
    // songs::recompute_usage's own doc comment).
    songs::recompute_usage(&root, &now[..10], &device, &now).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_service(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    let now = now_iso();
    let device = this_device_name(&app);
    services::delete(&root, &id).map_err(|e| e.to_string())?;
    songs::recompute_usage(&root, &now[..10], &device, &now).map_err(|e| e.to_string())?;
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
