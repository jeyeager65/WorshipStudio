use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::domain::opensong;
use crate::models::{Service, ServiceItemContent, Song, SongUsageEntry};

use super::services;
use super::{delete_file_if_exists, read_json_dir, read_json_file, write_json_file};

/// Marker file (empty library root, not a per-song thing) recording that
/// `migrate_usage_dates_if_needed` has already run against this library — see that function's
/// own doc comment for why a dedicated marker is used here instead of this codebase's more usual
/// "does the new artifact already exist" gating (there's no new artifact: `usage_dates` is a
/// field on files that already exist).
const USAGE_DATES_MIGRATION_MARKER: &str = "songs.usage-dates-migrated.json";

fn songs_dir(root: &Path) -> PathBuf {
    root.join("songs")
}

fn song_path(root: &Path, id: &str) -> PathBuf {
    songs_dir(root).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Song>> {
    read_json_dir(&songs_dir(root))
}

pub fn get(root: &Path, id: &str) -> std::io::Result<Option<Song>> {
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

/// The distinct song ids a service references, deduplicated so a song reprised twice in one
/// service (e.g. opening and closing) still only counts as one reference for that service.
fn song_ids_in(service: &Service) -> HashSet<String> {
    service
        .items
        .iter()
        .filter_map(|item| match &item.content {
            ServiceItemContent::Song { song_id, .. } => Some(song_id.clone()),
            _ => None,
        })
        .collect()
}

/// Incrementally updates every affected song's `usage_dates` for one service being saved or
/// deleted, instead of rescanning the entire service library (see `rebuild_all_usage_dates` for
/// the full-rescan fallback, used only for migration/repair). `old_service` is the previously
/// saved version of this service — `None` for a brand new service (including one just imported,
/// which has nothing to diff against). `new_service` is the version now being saved — `None`
/// when the service is being deleted. Only the songs whose reference to this service actually
/// changed (added, removed, or its date changed) are rewritten, so saving/deleting a service
/// never touches songs it has nothing to do with (avoids needless sync churn/conflicts). Each
/// song gets at most one `usage_dates` entry per service, keyed by `service_id`, regardless of
/// how many items in that service reference it.
pub fn update_usage_dates_for_service(
    root: &Path,
    service_id: &str,
    old_service: Option<&Service>,
    new_service: Option<&Service>,
    device: &str,
    now: &str,
) -> std::io::Result<()> {
    let old_song_ids = old_service.map(song_ids_in).unwrap_or_default();
    let new_song_ids = new_service.map(song_ids_in).unwrap_or_default();
    let new_date = new_service.map(|service| service.date.clone());

    let mut affected: HashSet<String> = old_song_ids;
    affected.extend(new_song_ids.iter().cloned());

    for song_id in affected {
        let Some(song) = get(root, &song_id)? else {
            continue;
        };
        let existing_index = song
            .usage_dates
            .iter()
            .position(|entry| entry.service_id == service_id);
        let desired = if new_song_ids.contains(&song_id) {
            new_date.clone().map(|date| SongUsageEntry {
                service_id: service_id.to_string(),
                date,
            })
        } else {
            None
        };

        let changed = match (existing_index, &desired) {
            (Some(index), Some(entry)) => song.usage_dates[index] != *entry,
            (Some(_), None) | (None, Some(_)) => true,
            (None, None) => false,
        };
        if !changed {
            continue;
        }

        let mut updated = song;
        match (existing_index, desired) {
            (Some(index), Some(entry)) => updated.usage_dates[index] = entry,
            (Some(index), None) => {
                updated.usage_dates.remove(index);
            }
            (None, Some(entry)) => updated.usage_dates.push(entry),
            (None, None) => unreachable!("changed is false in this case"),
        }
        save(root, updated, device, now)?;
    }
    Ok(())
}

/// Rebuilds every song's `usage_dates` from scratch against the full set of currently-saved
/// services — the "full rebuild" counterpart to `update_usage_dates_for_service`'s incremental
/// patching. Used two ways: as `migrate_usage_dates_if_needed`'s one-time backfill for a library
/// that predates `usage_dates` existing (every entry is fully re-derivable from existing
/// services, so this is never a lossy migration), and as a standing internal consistency-repair
/// capability if `usage_dates` ever drifts. Only songs whose rebuilt `usage_dates` actually
/// differ from what's on disk are rewritten.
pub fn rebuild_all_usage_dates(root: &Path, device: &str, now: &str) -> std::io::Result<()> {
    let mut entries_by_song: HashMap<String, Vec<SongUsageEntry>> = HashMap::new();
    for service in services::list(root)? {
        for song_id in song_ids_in(&service) {
            entries_by_song
                .entry(song_id)
                .or_default()
                .push(SongUsageEntry {
                    service_id: service.id.clone(),
                    date: service.date.clone(),
                });
        }
    }
    for entries in entries_by_song.values_mut() {
        entries.sort_by(|a, b| a.service_id.cmp(&b.service_id));
    }

    for song in list(root)? {
        let mut rebuilt = entries_by_song.remove(&song.id).unwrap_or_default();
        rebuilt.sort_by(|a, b| a.service_id.cmp(&b.service_id));
        let mut current = song.usage_dates.clone();
        current.sort_by(|a, b| a.service_id.cmp(&b.service_id));
        if current == rebuilt {
            continue;
        }
        let mut updated = song;
        updated.usage_dates = rebuilt;
        save(root, updated, device, now)?;
    }
    Ok(())
}

/// One-time migration for a library saved before `Song::usage_dates` existed: on first run
/// (`songs.usage-dates-migrated.json` absent from the library root), backfills every song's
/// `usage_dates` from the full set of already-saved services via `rebuild_all_usage_dates`, then
/// writes the marker so this never runs again. A genuinely fresh library (nothing on disk yet)
/// still gets the marker written — `rebuild_all_usage_dates` is a safe, cheap no-op against zero
/// services/songs. Follows this codebase's established one-time-migration shape (see, e.g., the
/// old `commands::roles::migrate_if_needed`): gate on a marker, trigger eagerly from the
/// relevant list command (`commands::songs::list_songs`).
pub fn migrate_usage_dates_if_needed(root: &Path, device: &str, now: &str) -> std::io::Result<()> {
    let marker_path = root.join(USAGE_DATES_MIGRATION_MARKER);
    if marker_path.is_file() {
        return Ok(());
    }
    rebuild_all_usage_dates(root, device, now)?;
    write_json_file(&marker_path, &serde_json::json!({ "migratedAt": now }))?;
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
        artist: None,
        copyright: parsed.copyright,
        collections: vec![],
        tags: vec![],
        notes: None,
        blocks: parsed.blocks,
        default_arrangement: parsed.arrangement,
        usage_dates: vec![],
        archived: false,
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
            artist: None,
            copyright: None,
            collections: vec![],
            tags: vec![],
            notes: None,
            blocks: vec![],
            default_arrangement: Arrangement { sequence: vec![] },
            usage_dates: vec![],
            archived: false,
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

        let fetched = get(dir.path(), "song-1")
            .unwrap()
            .expect("song should exist after save");
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
        assert!(get(dir.path(), "song-1").unwrap().is_none());
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
        assert!(get(dir.path(), "song-imported").unwrap().is_some());
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
            time: None,
            service_type_id: "type-sunday-morning-worship".to_string(),
            planning_notes: None,
            planning_song_ids: None,
            service_template_id: None,
            items: vec![crate::models::ServiceItem {
                theme_id: None,
                id: format!("item-{song_id}"),
                content: ServiceItemContent::Song {
                    song_id: song_id.to_string(),
                    arrangement: Arrangement { sequence: vec![] },
                },
                role_id: None,
                bulletin_label: None,
                bulletin_note: None,
                auto_advance: None,
            }],
            presenter_notes: None,
            assignments: None,
            bulletin_page1_footer: None,
            bulletin_page2_footer: None,
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn saving_a_service_adds_usage_entries_to_the_songs_it_references() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        let service = sample_service("svc-1", "2026-03-01", "song-1");
        let saved = services::save(dir.path(), service, "d", "now").unwrap();

        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&saved), "d", "now")
            .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(
            updated.usage_dates,
            vec![SongUsageEntry {
                service_id: "svc-1".to_string(),
                date: "2026-03-01".to_string(),
            }]
        );
    }

    #[test]
    fn editing_a_service_to_remove_a_song_removes_that_songs_entry_for_it() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        let old_service = sample_service("svc-1", "2026-03-01", "song-1");
        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&old_service), "d", "now")
            .unwrap();
        assert_eq!(
            get(dir.path(), "song-1")
                .unwrap()
                .unwrap()
                .usage_dates
                .len(),
            1
        );

        // The edited service no longer references song-1 at all.
        let mut new_service = old_service.clone();
        new_service.items.clear();

        update_usage_dates_for_service(
            dir.path(),
            "svc-1",
            Some(&old_service),
            Some(&new_service),
            "d",
            "now",
        )
        .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert!(updated.usage_dates.is_empty());
    }

    #[test]
    fn editing_a_services_date_updates_the_existing_entry_instead_of_duplicating_it() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        let old_service = sample_service("svc-1", "2026-03-01", "song-1");
        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&old_service), "d", "now")
            .unwrap();

        let new_service = sample_service("svc-1", "2026-03-08", "song-1");
        update_usage_dates_for_service(
            dir.path(),
            "svc-1",
            Some(&old_service),
            Some(&new_service),
            "d",
            "now",
        )
        .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(
            updated.usage_dates,
            vec![SongUsageEntry {
                service_id: "svc-1".to_string(),
                date: "2026-03-08".to_string(),
            }]
        );
    }

    #[test]
    fn deleting_a_service_removes_its_entries_from_every_song_that_had_one() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        save(dir.path(), sample_song("song-2"), "d", "now").unwrap();
        let mut service = sample_service("svc-1", "2026-03-01", "song-1");
        service.items.push(crate::models::ServiceItem {
            theme_id: None,
            id: "item-song-2".to_string(),
            content: ServiceItemContent::Song {
                song_id: "song-2".to_string(),
                arrangement: Arrangement { sequence: vec![] },
            },
            role_id: None,
            bulletin_label: None,
            bulletin_note: None,
            auto_advance: None,
        });
        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&service), "d", "now")
            .unwrap();

        update_usage_dates_for_service(dir.path(), "svc-1", Some(&service), None, "d", "now")
            .unwrap();

        assert!(get(dir.path(), "song-1")
            .unwrap()
            .unwrap()
            .usage_dates
            .is_empty());
        assert!(get(dir.path(), "song-2")
            .unwrap()
            .unwrap()
            .usage_dates
            .is_empty());
    }

    #[test]
    fn a_song_referenced_twice_in_one_service_only_gets_one_usage_entry_for_it() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        let mut service = sample_service("svc-1", "2026-07-01", "song-1");
        // The same song reprised as a second item within the same service (e.g. opening and
        // closing) — should still only produce one usage_dates entry for that service.
        let mut second_item = service.items[0].clone();
        second_item.id = "item-song-1-again".to_string();
        service.items.push(second_item);

        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&service), "d", "now")
            .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(updated.usage_dates.len(), 1);
    }

    #[test]
    fn update_usage_dates_leaves_a_song_whose_usage_dates_did_not_change_untouched() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "original-timestamp").unwrap();
        // No service references this song, so its usage_dates (already empty) doesn't actually
        // change — must not rewrite (and re-stamp) the file in that case.
        let service = sample_service("svc-1", "2026-07-01", "song-2");
        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&service), "d", "now")
            .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(updated.updated_at, "original-timestamp");
    }

    #[test]
    fn update_usage_dates_stores_a_future_dated_service_entry_without_filtering_it() {
        // The write path is date-agnostic -- filtering future dates out of "last used"/"past
        // year" is a display-time concern for whoever reads usage_dates, not this function's.
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        let service = sample_service("svc-1", "2099-01-01", "song-1");

        update_usage_dates_for_service(dir.path(), "svc-1", None, Some(&service), "d", "now")
            .unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(updated.usage_dates[0].date, "2099-01-01");
    }

    #[test]
    fn rebuild_all_usage_dates_backfills_every_song_from_existing_services() {
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

        rebuild_all_usage_dates(dir.path(), "d", "rebuild-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        let mut dates: Vec<&str> = updated
            .usage_dates
            .iter()
            .map(|entry| entry.date.as_str())
            .collect();
        dates.sort();
        assert_eq!(dates, vec!["2026-01-01", "2026-03-01"]);
    }

    #[test]
    fn rebuild_all_usage_dates_leaves_an_already_correct_song_untouched() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "original-timestamp").unwrap();
        // No services at all, so the rebuilt usage_dates (empty) already matches -- must not
        // rewrite (and re-stamp) the file.
        rebuild_all_usage_dates(dir.path(), "d", "rebuild-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(updated.updated_at, "original-timestamp");
    }

    #[test]
    fn migrate_usage_dates_backfills_when_the_marker_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "now").unwrap();
        services::save(
            dir.path(),
            sample_service("svc-1", "2026-01-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();

        migrate_usage_dates_if_needed(dir.path(), "d", "migrate-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert_eq!(updated.usage_dates.len(), 1);
        assert!(dir.path().join(USAGE_DATES_MIGRATION_MARKER).is_file());
    }

    #[test]
    fn migrate_usage_dates_is_a_no_op_once_the_marker_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample_song("song-1"), "d", "original-timestamp").unwrap();
        services::save(
            dir.path(),
            sample_service("svc-1", "2026-01-01", "song-1"),
            "d",
            "now",
        )
        .unwrap();
        // Marker already present -- as if the migration already ran (or a fresh install that
        // never needed it) -- so this must not backfill anything, even though the song's
        // usage_dates doesn't reflect the service above.
        write_json_file(
            &dir.path().join(USAGE_DATES_MIGRATION_MARKER),
            &serde_json::json!({ "migratedAt": "already-migrated" }),
        )
        .unwrap();

        migrate_usage_dates_if_needed(dir.path(), "d", "migrate-time").unwrap();

        let updated = get(dir.path(), "song-1").unwrap().unwrap();
        assert!(updated.usage_dates.is_empty());
        assert_eq!(updated.updated_at, "original-timestamp");
    }
}
