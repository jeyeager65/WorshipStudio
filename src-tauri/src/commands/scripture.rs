use tauri::AppHandle;

use crate::commands::settings::get_library_settings;
use crate::domain::scripture;
use crate::models::{ApiBibleCatalogEntry, ScripturePassage, ScriptureTranslation};
use crate::paths::load_machine_settings;

fn esv_api_key(app: &AppHandle) -> Option<String> {
    load_machine_settings(app)
        .esv_api_key
        .filter(|k| !k.is_empty())
        // Local-dev convenience only (see docs/release-process.md) — never overrides a real
        // per-machine key configured in Settings.
        .or_else(|| std::env::var("ESV_API_KEY").ok().filter(|k| !k.is_empty()))
}

fn api_bible_key(app: &AppHandle) -> Option<String> {
    load_machine_settings(app)
        .api_bible_key
        .filter(|k| !k.is_empty())
        .or_else(|| {
            std::env::var("API_BIBLE_KEY")
                .ok()
                .filter(|k| !k.is_empty())
        })
}

#[tauri::command]
pub async fn resolve_scripture(
    app: AppHandle,
    reference: String,
    translation_code: String,
) -> Result<ScripturePassage, String> {
    if translation_code == "ESV" {
        let api_key = esv_api_key(&app).ok_or("The ESV API isn't configured on this machine.")?;
        return scripture::resolve_esv(&reference, &api_key).await;
    }
    if translation_code != "KJV" {
        // Anything else must be a configured api.bible entry — look up its bible_id rather
        // than falling through to the KJV-only local resolver, which would otherwise silently
        // return KJV text mislabeled under the wrong translation code.
        let library = get_library_settings(app.clone())?;
        if let Some(entry) = library
            .api_bible_translations
            .into_iter()
            .find(|t| t.code == translation_code)
        {
            let api_key =
                api_bible_key(&app).ok_or("The api.bible API isn't configured on this machine.")?;
            return scripture::resolve_api_bible(
                &reference,
                &entry.bible_id,
                &translation_code,
                &api_key,
            )
            .await;
        }
    }
    scripture::resolve(&reference, &translation_code)
}

#[tauri::command]
pub fn get_scripture_book_list() -> Vec<String> {
    scripture::get_book_names()
}

#[tauri::command]
pub fn list_scripture_translations(app: AppHandle) -> Result<Vec<ScriptureTranslation>, String> {
    let library = get_library_settings(app.clone())?;
    let mut translations = vec![ScriptureTranslation {
        code: "KJV".to_string(),
        name: "King James Version".to_string(),
    }];
    if esv_api_key(&app).is_some() {
        translations.push(ScriptureTranslation {
            code: "ESV".to_string(),
            name: "English Standard Version".to_string(),
        });
    }
    if api_bible_key(&app).is_some() {
        for t in library.api_bible_translations {
            translations.push(ScriptureTranslation {
                code: t.code,
                name: t.label,
            });
        }
    }
    Ok(translations)
}

#[tauri::command]
pub async fn list_api_bible_catalog(
    app: AppHandle,
    api_key: Option<String>,
) -> Result<Vec<ApiBibleCatalogEntry>, String> {
    // Prefer whatever key the caller just typed (Settings passes its unsaved draft field) over
    // machine-settings.json — otherwise browsing the catalog would only work after Save, since
    // api_bible_key() below reads from disk.
    let api_key = api_key
        .filter(|k| !k.is_empty())
        .or_else(|| api_bible_key(&app))
        .ok_or("The api.bible API isn't configured on this machine.")?;
    scripture::list_api_bible_catalog(&api_key).await
}
