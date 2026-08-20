use tauri::AppHandle;

use crate::domain::opensong_sets::{self, ImportSetsSummary};
use crate::domain::{services, songs};
use crate::paths::{library_root, now_iso, this_device_name};

/// Imports OpenSong Sets as Services for the given year, matching each set's songs by title
/// against the already-imported song library and populating each matched song's `usage_dates`
/// from real history rather than starting every song with none. Meant to run once, as the
/// First-Time Setup Wizard's Library Import step — see
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
    let (new_services, summary) = opensong_sets::import_sets(
        std::path::Path::new(&sets_folder),
        &existing_songs,
        year,
        &default_service_type_id,
    )
    .map_err(|e| e.to_string())?;

    for service in new_services {
        let service_id = service.id.clone();
        let saved = services::save(&root, service, &device, &now).map_err(|e| e.to_string())?;
        // A newly-imported service is just another "service now exists" event -- the same
        // incremental update save_service uses, with no old version to diff against.
        songs::update_usage_dates_for_service(
            &root,
            &service_id,
            None,
            Some(&saved),
            &device,
            &now,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(summary)
}
