/// Generic file read, used by the OpenSong import flow (and reusable later for local Bible
/// file import, spec section 1) — the dialog plugin only picks a path; reading its content
/// stays server-side rather than adding the broader fs plugin just for this.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}
