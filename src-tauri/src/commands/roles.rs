use tauri::AppHandle;

use crate::domain::{role_groups, roles};
use crate::models::{RoleDefinition, RoleGroupDefinition};
use crate::paths::library_root;

#[tauri::command]
pub fn list_role_groups(app: AppHandle) -> Result<Vec<RoleGroupDefinition>, String> {
    role_groups::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_role_group(
    app: AppHandle,
    role_group: RoleGroupDefinition,
) -> Result<RoleGroupDefinition, String> {
    role_groups::save(&library_root(&app), role_group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_role_group(app: AppHandle, id: String) -> Result<(), String> {
    role_groups::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_roles(app: AppHandle) -> Result<Vec<RoleDefinition>, String> {
    roles::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_role(app: AppHandle, role: RoleDefinition) -> Result<RoleDefinition, String> {
    roles::save(&library_root(&app), role).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_role(app: AppHandle, id: String) -> Result<(), String> {
    roles::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}
