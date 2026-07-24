use std::path::{Path, PathBuf};

use crate::models::{Arrangement, Song, Usage};

use super::{delete_file_if_exists, read_json_dir, read_json_file, write_json_file};

fn songs_dir(root: &Path) -> PathBuf {
    root.join("songs")
}

fn song_path(root: &Path, id: &str) -> PathBuf {
    songs_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Song>> {
    read_json_dir(&songs_dir(root))
}

pub fn get(root: &Path, id: &str) -> Option<Song> {
    read_json_file(&song_path(root, id))
}

pub fn save(root: &Path, mut song: Song, device: &str, now: &str) -> std::io::Result<Song> {
    song.updated_at = now.to_string();
    song.updated_by_device = device.to_string();
    write_json_file(&song_path(root, &song.id), &song)?;
    Ok(song)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    delete_file_if_exists(&song_path(root, id))
}

/// Minimal structure extraction from OpenSong's XML song format — pulls the title
/// so the import command path can be exercised end-to-end; full lyric/block
/// parsing is the OpenSong-import feature itself (not this milestone's scope).
pub fn import_from_opensong_xml(
    root: &Path,
    xml: &str,
    id: String,
    device: &str,
    now: &str,
) -> std::io::Result<Song> {
    let title = extract_tag(xml, "title").unwrap_or_else(|| "Imported Song".to_string());
    let song = Song {
        id,
        title,
        ccli: None,
        author: None,
        copyright: None,
        key: None,
        tempo: None,
        collections: vec![],
        tags: vec![],
        notes: None,
        blocks: vec![],
        default_arrangement: Arrangement { sequence: vec![] },
        usage: Usage {
            last_used_at: None,
            uses_past_year: 0,
        },
        updated_at: now.to_string(),
        updated_by_device: device.to_string(),
    };
    write_json_file(&song_path(root, &song.id), &song)?;
    Ok(song)
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let value = xml[start..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_song(id: &str) -> Song {
        Song {
            id: id.to_string(),
            title: "Amazing Grace".to_string(),
            ccli: None,
            author: Some("John Newton".to_string()),
            copyright: None,
            key: None,
            tempo: None,
            collections: vec![],
            tags: vec![],
            notes: None,
            blocks: vec![],
            default_arrangement: Arrangement { sequence: vec![] },
            usage: Usage {
                last_used_at: None,
                uses_past_year: 0,
            },
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_get_round_trips_and_stamps_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let saved = save(
            dir.path(),
            sample_song("song-1"),
            "test-device",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        assert_eq!(saved.updated_by_device, "test-device");

        let fetched = get(dir.path(), "song-1").expect("song should exist after save");
        assert_eq!(fetched.title, "Amazing Grace");
        assert_eq!(fetched.updated_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn list_returns_empty_vec_when_songs_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn list_includes_all_saved_songs() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        save(dir.path(), sample_song("song-2"), "d", "now").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 2);
    }

    #[test]
    fn delete_removes_the_song_file() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        delete(dir.path(), "song-1").unwrap();
        assert!(get(dir.path(), "song-1").is_none());
    }

    #[test]
    fn delete_is_a_no_op_when_the_song_never_existed() {
        let dir = tempfile::tempdir().unwrap();
        assert!(delete(dir.path(), "does-not-exist").is_ok());
    }

    #[test]
    fn import_extracts_title_from_opensong_xml() {
        let dir = tempfile::tempdir().unwrap();
        let xml = "<?xml version=\"1.0\"?><song><title>Amazing Grace</title></song>";
        let song =
            import_from_opensong_xml(dir.path(), xml, "song-imported".to_string(), "d", "now")
                .unwrap();
        assert_eq!(song.title, "Amazing Grace");
        assert!(get(dir.path(), "song-imported").is_some());
    }

    #[test]
    fn import_falls_back_to_placeholder_title_when_tag_missing() {
        let dir = tempfile::tempdir().unwrap();
        let song = import_from_opensong_xml(
            dir.path(),
            "<song></song>",
            "song-x".to_string(),
            "d",
            "now",
        )
        .unwrap();
        assert_eq!(song.title, "Imported Song");
    }
}
