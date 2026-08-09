use tauri::AppHandle;

use crate::domain::themes;
use crate::models::Theme;
use crate::paths::{library_root, now_iso, this_device_name};

#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<Theme>, String> {
    themes::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_theme(app: AppHandle, theme: Theme) -> Result<(), String> {
    let root = library_root(&app);
    themes::save(&root, theme, &this_device_name(&app), &now_iso()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    themes::delete(&root, &id).map_err(|e| e.to_string())?;
    Ok(())
}
