use tauri::AppHandle;

use crate::domain::{services, songs};
use crate::models::Service;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_services(app: AppHandle) -> Result<Vec<Service>, String> {
    services::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service(app: AppHandle, id: String) -> Result<Option<Service>, String> {
    services::get(&library_root(&app), &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_service(app: AppHandle, service: Service) -> Result<(), String> {
    let root = library_root(&app);
    let now = now_iso();
    let device = this_device_name(&app);
    let service_id = service.id.clone();
    // Read the old version before it's overwritten so the songs it referenced can be diffed
    // against what the new version references — see songs::update_usage_dates_for_service's own
    // doc comment for why this replaced a full-library recompute on every save.
    let old_service = services::get(&root, &service_id).map_err(|e| e.to_string())?;
    let saved = services::save(&root, service, &device, &now).map_err(|e| e.to_string())?;
    songs::update_usage_dates_for_service(
        &root,
        &service_id,
        old_service.as_ref(),
        Some(&saved),
        &device,
        &now,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_service(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    let now = now_iso();
    let device = this_device_name(&app);
    let old_service = services::get(&root, &id).map_err(|e| e.to_string())?;
    services::delete(&root, &id).map_err(|e| e.to_string())?;
    if let Some(old_service) = old_service {
        songs::update_usage_dates_for_service(&root, &id, Some(&old_service), None, &device, &now)
            .map_err(|e| e.to_string())?;
    }
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
