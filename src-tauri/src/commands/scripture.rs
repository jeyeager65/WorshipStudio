use crate::domain::scripture;
use crate::models::{ScripturePassage, ScriptureTranslation};

fn esv_api_key() -> Option<String> {
    std::env::var("ESV_API_KEY").ok().filter(|k| !k.is_empty())
}

#[tauri::command]
pub async fn resolve_scripture(
    reference: String,
    translation_code: String,
) -> Result<ScripturePassage, String> {
    if translation_code == "ESV" {
        let api_key = esv_api_key().ok_or("The ESV API isn't configured on this machine.")?;
        return scripture::resolve_esv(&reference, &api_key).await;
    }
    scripture::resolve(&reference, &translation_code)
}

#[tauri::command]
pub fn get_scripture_book_list() -> Vec<String> {
    scripture::get_book_names()
}

#[tauri::command]
pub fn list_scripture_translations() -> Vec<ScriptureTranslation> {
    scripture::list_translations(esv_api_key().is_some())
}
