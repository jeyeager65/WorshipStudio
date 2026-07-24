use std::path::Path;

use crate::models::ManifestEntry;

use super::{services, slides, songs, write_json_file};

const MANIFEST_FILE: &str = "manifest.json";

/// Rebuilds manifest.json from scratch by scanning every library folder. Simple full-rebuild
/// rather than incremental patching — correctness over cleverness, and cheap at the scale of
/// a single church's library. Called after every save/delete of a synced library item.
pub fn rebuild(root: &Path) -> std::io::Result<Vec<ManifestEntry>> {
    let mut entries = Vec::new();

    for song in songs::list(root)? {
        entries.push(ManifestEntry {
            id: song.id,
            kind: "song".to_string(),
            label: song.title,
            updated_at: song.updated_at,
        });
    }

    for service in services::list(root)? {
        entries.push(ManifestEntry {
            id: service.id,
            kind: "service".to_string(),
            label: format!("{} — {}", service.date, service.service_type),
            updated_at: service.updated_at,
        });
    }

    for slide in slides::list(root)? {
        entries.push(ManifestEntry {
            id: slide.id,
            kind: "slide".to_string(),
            label: slide.label,
            updated_at: slide.updated_at,
        });
    }

    write_json_file(&root.join(MANIFEST_FILE), &entries)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::songs;
    use crate::models::{Arrangement, Song, Usage};

    #[test]
    fn rebuild_indexes_every_saved_song() {
        let dir = tempfile::tempdir().unwrap();
        songs::save(
            dir.path(),
            Song {
                id: "song-1".to_string(),
                title: "Amazing Grace".to_string(),
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
                updated_at: String::new(),
                updated_by_device: String::new(),
            },
            "d",
            "now",
        )
        .unwrap();

        let entries = rebuild(dir.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "song");
        assert_eq!(entries[0].label, "Amazing Grace");
        assert!(dir.path().join("manifest.json").exists());
    }
}
