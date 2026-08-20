use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use chrono::{Datelike, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::domain::opensong::decode_xml_entities;
use crate::models::{Service, ServiceItem, ServiceItemContent, Song};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportSetsSummary {
    pub services_created: usize,
    pub song_references_matched: usize,
    pub unmatched_song_titles: Vec<String>,
    pub skipped_files: Vec<String>,
}

/// Ordered song titles referenced by a set, in performance order. Non-song slide_groups
/// (announcements, "BAPTISMS", a blank "Untitled" intro slide, etc.) are real content in
/// OpenSong's own sets but are out of scope here — this import exists to seed services and
/// song usage stats from history, not to faithfully recreate every custom slide (see
/// notes/architecture-plan.md's OpenSong migration note).
static SLIDE_GROUP_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<slide_group\s+name="([^"]*)"\s+type="([^"]*)""#).expect("pattern must compile")
});

fn parse_set(xml: &str) -> Vec<String> {
    SLIDE_GROUP_PATTERN
        .captures_iter(xml)
        .filter(|cap| &cap[2] == "song")
        .map(|cap| decode_xml_entities(&cap[1]))
        .collect()
}

/// Parses a set filename's embedded date. The real church library's Sets folder uses two
/// inconsistent conventions for current/recent sets — `MM.DD.YYYY` and `MM.DD.YY` (both show
/// up) — and archived years use a third (`YYYY-MM-DD`, under `Sets/<year> Archive/`
/// subfolders). Only the first two are handled here; anything else (a descriptive name like
/// "Easter Morning Service", or a genuinely dateless file) returns `None` so the caller can
/// report it as skipped rather than silently dropping it.
pub fn parse_set_filename_date(filename: &str) -> Option<NaiveDate> {
    let parts: Vec<&str> = filename.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let month: u32 = parts[0].parse().ok()?;
    let day: u32 = parts[1].parse().ok()?;
    let year: i32 = match parts[2].len() {
        4 => parts[2].parse().ok()?,
        2 => 2000 + parts[2].parse::<i32>().ok()?,
        _ => return None,
    };
    NaiveDate::from_ymd_opt(year, month, day)
}

/// Reads every file directly inside `sets_dir` (non-recursive — archived-year subfolders use a
/// different naming convention entirely and are a later slice), keeps only the ones whose
/// filename parses to a date in `year`, and turns each into a draft `Service` with its songs
/// matched by title (case-insensitively) against `songs`. Doesn't compute any song usage stats
/// itself — a newly-imported service is just another "service now exists" event, so callers seed
/// `Song::usage_dates` the same way any other new service does, via
/// `songs::update_usage_dates_for_service` (see `commands::opensong::import_opensong_sets`).
pub fn import_sets(
    sets_dir: &Path,
    songs: &[Song],
    year: i32,
    default_service_type_id: &str,
) -> std::io::Result<(Vec<Service>, ImportSetsSummary)> {
    let mut services = Vec::new();
    let mut unmatched_song_titles = Vec::new();
    let mut skipped_files = Vec::new();

    if !sets_dir.exists() {
        return Ok((services, ImportSetsSummary::default()));
    }

    let title_lookup: HashMap<String, &Song> =
        songs.iter().map(|s| (s.title.to_lowercase(), s)).collect();

    let mut entries: Vec<_> = fs::read_dir(sets_dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    let mut song_references_matched = 0usize;

    for entry in entries {
        if !entry.file_type()?.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let Some(date) = parse_set_filename_date(&filename) else {
            skipped_files.push(filename);
            continue;
        };
        if date.year() != year {
            continue;
        }

        let xml = fs::read_to_string(entry.path())?;
        let date_str = date.format("%Y-%m-%d").to_string();
        let mut items = Vec::new();

        for title in parse_set(&xml) {
            match title_lookup.get(&title.to_lowercase()) {
                Some(song) => {
                    items.push(ServiceItem {
                        theme_id: None,
                        id: format!("item-{}", uuid::Uuid::new_v4()),
                        content: ServiceItemContent::Song {
                            song_id: song.id.clone(),
                            arrangement: song.default_arrangement.clone(),
                        },
                        role_id: None,
                        bulletin_label: None,
                        bulletin_note: None,
                        auto_advance: None,
                    });
                    song_references_matched += 1;
                }
                None => unmatched_song_titles.push(title),
            }
        }

        services.push(Service {
            id: format!("service-{}", uuid::Uuid::new_v4()),
            date: date_str,
            time: None,
            service_type_id: default_service_type_id.to_string(),
            planning_notes: None,
            planning_song_ids: None,
            service_template_id: None,
            items,
            presenter_notes: None,
            assignments: None,
            bulletin_page1_footer: None,
            bulletin_page2_footer: None,
            updated_at: String::new(),
            updated_by_device: String::new(),
        });
    }

    unmatched_song_titles.sort();
    unmatched_song_titles.dedup();

    let summary = ImportSetsSummary {
        services_created: services.len(),
        song_references_matched,
        unmatched_song_titles,
        skipped_files,
    };

    Ok((services, summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Arrangement;

    fn sample_song(id: &str, title: &str) -> Song {
        Song {
            id: id.to_string(),
            title: title.to_string(),
            ccli: None,
            author: None,
            artist: None,
            copyright: None,
            collections: vec![],
            tags: vec![],
            notes: None,
            blocks: vec![],
            default_arrangement: Arrangement {
                sequence: vec!["v1".to_string()],
            },
            usage_dates: vec![],
            archived: false,
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn parses_four_digit_year_filename() {
        assert_eq!(
            parse_set_filename_date("02.26.2026"),
            NaiveDate::from_ymd_opt(2026, 2, 26)
        );
    }

    #[test]
    fn parses_two_digit_year_filename() {
        assert_eq!(
            parse_set_filename_date("05.03.26"),
            NaiveDate::from_ymd_opt(2026, 5, 3)
        );
    }

    #[test]
    fn returns_none_for_a_descriptive_non_date_filename() {
        assert_eq!(
            parse_set_filename_date("EASTER MORNING SERVICE 4.5.2026"),
            None
        );
        assert_eq!(
            parse_set_filename_date("christmas candelight service"),
            None
        );
    }

    #[test]
    fn returns_none_for_an_invalid_calendar_date() {
        assert_eq!(parse_set_filename_date("02.30.2026"), None);
    }

    #[test]
    fn parse_set_extracts_only_song_type_slide_groups_in_order() {
        let xml = r#"<set name="x">
          <slide_groups>
          <slide_group name="Untitled" type="custom" print="true">
          <slide_group name="Rejoice the Lord is King" type="song">
          <slide_group name="BAPTISMS" type="custom">
          <slide_group name="His Mercy is More" type="song">
        "#;
        assert_eq!(
            parse_set(xml),
            vec!["Rejoice the Lord is King", "His Mercy is More"]
        );
    }

    #[test]
    fn parse_set_decodes_xml_entities_in_titles() {
        let xml = r#"<slide_group name="Rock &amp; Redeemer&apos;s Grace" type="song">"#;
        assert_eq!(parse_set(xml), vec!["Rock & Redeemer's Grace"]);
    }

    #[test]
    fn import_sets_creates_a_service_per_in_year_file_and_matches_songs_by_title() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("02.26.2026"),
            r#"<set name="x"><slide_group name="Amazing Grace" type="song"></set>"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("03.08.2025"),
            r#"<set name="x"><slide_group name="Amazing Grace" type="song"></set>"#,
        )
        .unwrap();

        let songs = vec![sample_song("song-1", "Amazing Grace")];
        let (services, summary) =
            import_sets(dir.path(), &songs, 2026, "Sunday Morning Worship").unwrap();

        // Only the 2026 file should produce a service -- the 2025 one is out of scope for
        // this year's import, silently (not an error, not "skipped" -- just not this year).
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].date, "2026-02-26");
        assert_eq!(summary.services_created, 1);
        assert_eq!(summary.song_references_matched, 1);
    }

    #[test]
    fn import_sets_reports_unmatched_titles_and_skipped_filenames() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("02.26.2026"),
            r#"<set name="x"><slide_group name="Song Not In Library" type="song"></set>"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("christmas candelight service"),
            "<set></set>",
        )
        .unwrap();

        let (services, summary) =
            import_sets(dir.path(), &[], 2026, "Sunday Morning Worship").unwrap();

        assert_eq!(services.len(), 1);
        assert_eq!(
            summary.unmatched_song_titles,
            vec!["Song Not In Library".to_string()]
        );
        assert_eq!(
            summary.skipped_files,
            vec!["christmas candelight service".to_string()]
        );
    }

    #[test]
    fn import_sets_creates_a_separate_service_for_each_set_the_same_song_appears_in() {
        // This function no longer aggregates usage stats itself -- that's now the caller's job
        // (see commands::opensong::import_opensong_sets, which feeds each created service
        // through songs::update_usage_dates_for_service the same way any other new service
        // would be) -- so this only checks that each in-year set still produces its own service
        // referencing the matched song.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("01.04.2026"),
            r#"<slide_group name="Amazing Grace" type="song">"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("02.01.2026"),
            r#"<slide_group name="Amazing Grace" type="song">"#,
        )
        .unwrap();

        let songs = vec![sample_song("song-1", "Amazing Grace")];
        let (services, summary) = import_sets(dir.path(), &songs, 2026, "Service").unwrap();

        assert_eq!(services.len(), 2);
        assert_eq!(summary.song_references_matched, 2);
        for service in &services {
            assert!(matches!(
                &service.items[0].content,
                ServiceItemContent::Song { song_id, .. } if song_id == "song-1"
            ));
        }
    }

    #[test]
    fn import_sets_returns_empty_when_the_directory_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let (services, summary) = import_sets(&missing, &[], 2026, "Service").unwrap();
        assert!(services.is_empty());
        assert_eq!(summary.services_created, 0);
    }
}
