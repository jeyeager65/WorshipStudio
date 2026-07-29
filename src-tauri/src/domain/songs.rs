use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::{Duration, NaiveDate};

use crate::domain::opensong;
use crate::models::{ServiceItemContent, Song, Usage};

use super::services;
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

/// Recomputes every song's usage stats (lastUsedAt / usesPastYear) from the full set of saved
/// services, rather than incrementing them on each save — the only way "last used" stays
/// correct if a service's songs or date are edited later, or the most recent service
/// referencing a song is deleted (same "full rebuild over incremental patching" philosophy as
/// manifest::rebuild). lastUsedAt is the *service's own date*, not when it was saved. Only
/// songs whose stats actually changed are rewritten, so saving/deleting a service that doesn't
/// affect a given song's history never touches that song's file (avoids needless sync
/// churn/conflicts across every song in the library on every save).
pub fn recompute_usage(root: &Path, today: &str, device: &str, now: &str) -> std::io::Result<()> {
    let services = services::list(root)?;
    let one_year_ago = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .ok()
        .map(|d| (d - Duration::days(365)).format("%Y-%m-%d").to_string());

    let mut last_used_at: HashMap<String, String> = HashMap::new();
    let mut uses_past_year: HashMap<String, u32> = HashMap::new();

    for service in &services {
        for item in &service.items {
            let ServiceItemContent::Song { song_id, .. } = &item.content else {
                continue;
            };
            let entry = last_used_at
                .entry(song_id.clone())
                .or_insert_with(|| service.date.clone());
            if service.date > *entry {
                *entry = service.date.clone();
            }
            if one_year_ago
                .as_deref()
                .is_none_or(|cutoff| service.date.as_str() >= cutoff)
            {
                *uses_past_year.entry(song_id.clone()).or_insert(0) += 1;
            }
        }
    }

    for song in list(root)? {
        let new_last_used_at = last_used_at.get(&song.id).cloned();
        let new_uses_past_year = uses_past_year.get(&song.id).copied().unwrap_or(0);
        if song.usage.last_used_at == new_last_used_at
            && song.usage.uses_past_year == new_uses_past_year
        {
            continue;
        }
        let mut updated = song;
        updated.usage.last_used_at = new_last_used_at;
        updated.usage.uses_past_year = new_uses_past_year;
        save(root, updated, device, now)?;
    }
    Ok(())
}

pub fn import_from_opensong_xml(
    root: &Path,
    xml: &str,
    id: String,
    device: &str,
    now: &str,
) -> std::io::Result<Song> {
    let parsed = opensong::parse(xml);
    let song = Song {
        id,
        title: parsed.title,
        ccli: parsed.ccli,
        author: parsed.author,
        copyright: parsed.copyright,
        collections: vec![],
        tags: vec![],
        notes: None,
        blocks: parsed.blocks,
        default_arrangement: parsed.arrangement,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Arrangement;

    fn sample_song(id: &str) -> Song {
        Song {
            id: id.to_string(),
            title: "Amazing Grace".to_string(),
            ccli: None,
            author: Some("John Newton".to_string()),
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

    fn sample_service(id: &str, date: &str, song_id: &str) -> crate::models::Service {
        crate::models::Service {
            id: id.to_string(),
            date: date.to_string(),
            service_type: "Sunday Morning Worship".to_string(),
            preacher_id: None,
            sermon_title: None,
            key_passage: None,
            items: vec![crate::models::ServiceItem {
                id: format!("item-{song_id}"),
                content: ServiceItemContent::Song {
                    song_id: song_id.to_string(),
                    arrangement: Arrangement { sequence: vec![] },
                },
                role: None,
                bulletin_label: None,
                bulletin_note: None,
            }],
            presenter_notes: None,
            assignments: None,
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn recompute_usage_sets_last_used_at_to_the_most_recent_service_date() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        services::save(
            dir.path(),
            sample_service("svc-1", "2026-01-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();
        services::save(
            dir.path(),
            sample_service("svc-2", "2026-03-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();

        recompute_usage(dir.path(), "2026-07-28", "d", "recompute-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap();
        assert_eq!(updated.usage.last_used_at.as_deref(), Some("2026-03-01"));
    }

    #[test]
    fn recompute_usage_only_counts_uses_past_year_within_the_window_but_still_sets_last_used_at() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        // Well over a year before "today" below.
        services::save(
            dir.path(),
            sample_service("svc-1", "2024-01-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();

        recompute_usage(dir.path(), "2026-07-28", "d", "recompute-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap();
        assert_eq!(updated.usage.last_used_at.as_deref(), Some("2024-01-01"));
        assert_eq!(updated.usage.uses_past_year, 0);
    }

    #[test]
    fn recompute_usage_leaves_a_song_with_unchanged_stats_untouched() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "original-timestamp").unwrap();
        // No services reference this song, so computed stats (None/0) already match the song's
        // existing usage — recompute must not rewrite (and re-stamp) the file in that case.
        recompute_usage(dir.path(), "2026-07-28", "d", "recompute-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap();
        assert_eq!(updated.updated_at, "original-timestamp");
    }

    #[test]
    fn recompute_usage_counts_each_service_within_the_past_year_once() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        services::save(
            dir.path(),
            sample_service("svc-1", "2026-01-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();
        services::save(
            dir.path(),
            sample_service("svc-2", "2026-03-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();

        recompute_usage(dir.path(), "2026-07-28", "d", "recompute-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap();
        assert_eq!(updated.usage.uses_past_year, 2);
    }
}
