use std::path::Path;

use crate::models::ManifestEntry;

use super::{announcements, media, people, services, slides, songs, themes};

/// Computes an in-memory index by scanning every library folder — no longer persisted to disk.
/// The only consumer is `sync::get_status()`, which is read rarely enough (app launch, manual
/// refresh) that a fresh scan on demand is simpler and cheaper than keeping a synced file
/// current after every write. See notes/completion-audit.md's "Web-based prep build" section.
pub fn compute(root: &Path) -> std::io::Result<Vec<ManifestEntry>> {
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
            // service_type_id, not a display name -- fine here, nothing reads this label
            // (manifest::compute()'s only real consumer only reads updated_at, see its own
            // module doc comment).
            label: format!("{} — {}", service.date, service.service_type_id),
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

    for item in media::list(root)? {
        entries.push(ManifestEntry {
            id: item.id,
            kind: "media".to_string(),
            label: item.filename,
            updated_at: item.updated_at,
        });
    }

    for theme in themes::list(root)? {
        entries.push(ManifestEntry {
            id: theme.id,
            kind: "theme".to_string(),
            label: theme.name,
            updated_at: theme.updated_at,
        });
    }

    for person in people::list(root)? {
        entries.push(ManifestEntry {
            id: person.id,
            kind: "person".to_string(),
            label: person
                .preferred_name
                .clone()
                .map(|name| format!("{} {}", name, person.last_name))
                .unwrap_or_else(|| format!("{} {}", person.first_name, person.last_name)),
            updated_at: person.updated_at,
        });
    }

    for announcement in announcements::list(root)? {
        entries.push(ManifestEntry {
            id: announcement.id,
            kind: "announcement".to_string(),
            label: announcement.text,
            updated_at: announcement.updated_at,
        });
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::songs;
    use crate::models::{Arrangement, Song, Usage};

    #[test]
    fn compute_indexes_every_saved_song() {
        let dir = tempfile::tempdir().unwrap();
        songs::save(
            dir.path(),
            Song {
                id: "song-1".to_string(),
                title: "Amazing Grace".to_string(),
                ccli: None,
                author: None,
                artist: None,
                copyright: None,
                collections: vec![],
                tags: vec![],
                notes: None,
                blocks: vec![],
                default_arrangement: Arrangement { sequence: vec![] },
                usage: Usage {
                    last_used_at: None,
                    uses_past_year: 0,
                },
                archived: false,
                updated_at: String::new(),
                updated_by_device: String::new(),
            },
            "d",
            "now",
        )
        .unwrap();

        let entries = compute(dir.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "song");
        assert_eq!(entries[0].label, "Amazing Grace");
        assert!(!dir.path().join("manifest.json").exists());
    }
}
