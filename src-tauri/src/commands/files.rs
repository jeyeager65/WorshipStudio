/// Generic file read, used by the OpenSong import flow (and reusable later for local Bible
/// file import, spec section 1) — the dialog plugin only picks a path; reading its content
/// stays server-side rather than adding the broader fs plugin just for this.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Generic file write, used by the Order of Worship export (its "Export as Word Document"
/// button) — the dialog plugin's save() only picks a destination path; writing to it stays
/// server-side, same reasoning as read_text_file above rather than adding the broader fs plugin.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

/// Same as write_text_file, but for arbitrary bytes — a real .docx file is a zip archive, not
/// valid UTF-8 text, so it has to cross the IPC boundary as a byte array (Tauri serializes a
/// JS Uint8Array/number[] into this directly) rather than a string.
#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("Order of Worship.doc")
            .to_string_lossy()
            .to_string();

        write_text_file(path.clone(), "<html>hello</html>".to_string()).unwrap();

        assert_eq!(read_text_file(path).unwrap(), "<html>hello</html>");
    }

    #[test]
    fn write_reports_an_error_for_an_unwritable_path() {
        let result = write_text_file(
            "/definitely/not/a/real/directory/file.doc".to_string(),
            "x".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn write_binary_round_trips_arbitrary_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("Order of Worship.docx")
            .to_string_lossy()
            .to_string();
        // Not valid UTF-8 — exactly the kind of content write_text_file couldn't carry, since a
        // real .docx is a zip archive, not text.
        let bytes = vec![0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xfe];

        write_binary_file(path.clone(), bytes.clone()).unwrap();

        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
