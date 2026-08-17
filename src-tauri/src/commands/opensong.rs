use tauri::AppHandle;

use crate::domain::opensong_sets::{self, ImportSetsSummary};
use crate::domain::{services, songs};
use crate::paths::{library_root, now_iso, this_device_name};

/// Imports OpenSong Sets as Services for the given year, matching each set's songs by title
/// against the already-imported song library and seeding usage stats (uses-this-year count +
/// most recent date) from real history rather than starting every song at zero. Meant to run
/// once, as the First-Time Setup Wizard's Library Import step — see
/// domain::opensong_sets::import_sets for the actual parsing/matching logic and its scope
/// limits (current year only; a handful of non-date-named/archived files are reported as
/// skipped rather than silently dropped).
#[tauri::command]
pub fn import_opensong_sets(
    app: AppHandle,
    sets_folder: String,
    year: i32,
    default_service_type_id: String,
) -> Result<ImportSetsSummary, String> {
    let root = library_root(&app);
    let device = this_device_name(&app);
    let now = now_iso();

    let existing_songs = songs::list(&root).map_err(|e| e.to_string())?;
    let (new_services, usage_updates, summary) = opensong_sets::import_sets(
        std::path::Path::new(&sets_folder),
        &existing_songs,
        year,
        &default_service_type_id,
    )
    .map_err(|e| e.to_string())?;

    for service in new_services {
        services::save(&root, service, &device, &now).map_err(|e| e.to_string())?;
    }
    for song in existing_songs {
        if let Some(usage) = usage_updates.get(&song.id) {
            let mut updated = song;
            updated.usage = usage.clone();
            songs::save(&root, updated, &device, &now).map_err(|e| e.to_string())?;
        }
    }

    Ok(summary)
}
