use tauri::AppHandle;

use crate::domain::{manifest, slides};
use crate::models::SlideLibraryItem;
use crate::paths::{library_root, now_iso, this_device_name};
use crate::remote_server;

#[tauri::command]
pub fn list_slides(app: AppHandle) -> Result<Vec<SlideLibraryItem>, String> {
    slides::list(&library_root(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_slide(app: AppHandle, id: String) -> Result<Option<SlideLibraryItem>, String> {
    slides::get(&library_root(&app), &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_slide(app: AppHandle, item: SlideLibraryItem) -> Result<(), String> {
    let root = library_root(&app);
    slides::save(&root, item, &this_device_name(&app), &now_iso()).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_slide(app: AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app);
    slides::delete(&root, &id).map_err(|e| e.to_string())?;
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    Ok(())
}

/// Generic "encode this text as a QR code" command for the slide editor's QR element — reuses
/// the same rendering the Remote Control pairing flow already relies on (see
/// `remote_server::qr_data_url`), just without that flow's pairing-specific URL construction.
#[tauri::command]
pub fn generate_qr_code(content: String) -> Result<String, String> {
    remote_server::qr_data_url(&content)
}
