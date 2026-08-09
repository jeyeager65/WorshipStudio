use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::domain::stock_content::{self, StockImportSummary};
use crate::paths::{library_root, local_media_root, now_iso, this_device_name};

/// Copies whichever of the 6 stock background images (bundled as Tauri resources — see
/// `bundle.resources` in tauri.conf.json, produced by scripts/optimize-stock-backgrounds.mjs)
/// aren't already in the library into its real synced media folder, plus whichever of the 2
/// starter themes aren't already present. Offered from the Setup Wizard's Library step and
/// re-runnable from Settings → Data tools; idempotent either way.
#[tauri::command]
pub fn import_stock_backgrounds(app: AppHandle) -> Result<StockImportSummary, String> {
    let resource_dir = app
        .path()
        .resolve("resources/stock-backgrounds", BaseDirectory::Resource)
        .map_err(|error| format!("Could not locate bundled stock backgrounds: {error}"))?;
    let root = library_root(&app);
    let summary = stock_content::import(
        &root,
        &local_media_root(&app),
        &resource_dir,
        &this_device_name(&app),
        &now_iso(),
    )
    .map_err(|error| error.to_string())?;
    Ok(summary)
}
