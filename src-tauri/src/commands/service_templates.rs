use tauri::AppHandle;

use crate::domain::service_templates;
use crate::models::ServiceTemplate;
use crate::paths::library_root;

#[tauri::command]
pub fn list_service_templates(app: AppHandle) -> Result<Vec<ServiceTemplate>, String> {
    service_templates::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_service_template(
    app: AppHandle,
    service_template: ServiceTemplate,
) -> Result<ServiceTemplate, String> {
    service_templates::save(&library_root(&app), service_template).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service_template(app: AppHandle, id: String) -> Result<(), String> {
    service_templates::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}
