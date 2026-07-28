use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::ManifestEntry;

use super::read_json_file;

/// Matches Dropbox's "conflicted copy" filename convention — the exact wording has varied
/// across client versions ("Conflicted copy", "<device>'s conflicted copy"), so this just
/// looks for "conflicted copy" case-insensitively inside a trailing parenthetical, which
/// covers both. Other sync providers' conflict-artifact naming isn't handled — this is
/// Dropbox-specific by design (see design/feature-spec.md's Sync section).
static CONFLICT_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?P<stem>.+) \([^)]*conflicted copy[^)]*\)(?P<ext>\.[^.]+)?$")
        .expect("pattern must compile")
});

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedItem {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub this_version: Value,
    pub other_version: Value,
    pub other_device: String,
    pub other_updated_at: String,
    pub conflict_file_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub folder_readable: bool,
    pub sync_client_running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_library_change_at: Option<String>,
    pub conflict_count: usize,
}

/// Every item type already stamps `id`/`updatedAt`/`updatedByDevice` on save (see paths.rs's
/// device-name plumbing) — reading the raw JSON `Value` rather than each concrete model type
/// keeps this genuinely generic across songs/services/slides/media/themes/people.
fn label_for(kind: &str, value: &Value) -> String {
    match kind {
        "song" => value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        "service" => {
            let date = value.get("date").and_then(Value::as_str).unwrap_or("");
            let service_type = value.get("type").and_then(Value::as_str).unwrap_or("");
            format!("{date} — {service_type}")
        }
        "slide" => value
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        "media" => value
            .get("filename")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        "theme" => value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        "person" => value
            .get("displayName")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                let first = value.get("firstName").and_then(Value::as_str).unwrap_or("");
                let last = value.get("lastName").and_then(Value::as_str).unwrap_or("");
                format!("{first} {last}").trim().to_string()
            }),
        _ => value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
}

fn scan_dir(dir: &Path, kind: &str, out: &mut Vec<ConflictedItem>) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let Some(caps) = CONFLICT_PATTERN.captures(&filename) else {
            continue;
        };
        let stem = &caps["stem"];
        let ext = caps.name("ext").map(|m| m.as_str()).unwrap_or("");
        let original_path = dir.join(format!("{stem}{ext}"));
        // The original may already be gone (deleted, or a previous conflict resolution) —
        // nothing meaningful to compare against, so this artifact is silently skipped rather
        // than surfaced as an unresolvable conflict.
        let Some(this_version) = read_json_file::<Value>(&original_path) else {
            continue;
        };
        let Some(other_version) = read_json_file::<Value>(&entry.path()) else {
            continue;
        };
        let id = this_version
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(stem)
            .to_string();
        let other_device = other_version
            .get("updatedByDevice")
            .and_then(Value::as_str)
            .unwrap_or("Unknown device")
            .to_string();
        let other_updated_at = other_version
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        out.push(ConflictedItem {
            kind: kind.to_string(),
            label: label_for(kind, &this_version),
            id,
            this_version,
            other_version,
            other_device,
            other_updated_at,
            conflict_file_path: entry.path().to_string_lossy().to_string(),
        });
    }
    Ok(())
}

/// Scans every per-item content folder for Dropbox conflict artifacts. Non-recursive per
/// folder (services needs one extra level for its year subfolders) — matches how each
/// domain module already lays its files out.
pub fn detect_conflicts(root: &Path) -> std::io::Result<Vec<ConflictedItem>> {
    let mut out = Vec::new();
    scan_dir(&root.join("songs"), "song", &mut out)?;
    scan_dir(&root.join("slides"), "slide", &mut out)?;
    scan_dir(&root.join("media-items"), "media", &mut out)?;
    scan_dir(&root.join("themes"), "theme", &mut out)?;
    scan_dir(&root.join("people"), "person", &mut out)?;

    let services_dir = root.join("services");
    if services_dir.exists() {
        for entry in fs::read_dir(&services_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                scan_dir(&entry.path(), "service", &mut out)?;
            }
        }
    }
    Ok(out)
}

/// Resolves a single conflict: `keep == "theirs"` overwrites the original with the
/// conflicted copy's content; either way the conflicted-copy artifact itself is removed
/// afterward, so it stops appearing in the list ("self-clearing" per feature-spec.md).
pub fn resolve_conflict(conflict_file_path: &str, keep: &str) -> std::io::Result<()> {
    let conflict_path = Path::new(conflict_file_path);
    if keep == "theirs" {
        let filename = conflict_path
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or_else(|| std::io::Error::other("invalid conflict file path"))?;
        let caps = CONFLICT_PATTERN
            .captures(filename)
            .ok_or_else(|| std::io::Error::other("not a recognized conflicted-copy filename"))?;
        let stem = &caps["stem"];
        let ext = caps.name("ext").map(|m| m.as_str()).unwrap_or("");
        let original_path = conflict_path.with_file_name(format!("{stem}{ext}"));
        fs::copy(conflict_path, original_path)?;
    }
    fs::remove_file(conflict_path)
}

/// Best-effort: genuinely detecting whether the sync client is running is inherently
/// OS-specific and only implemented for Windows (this app's primary target so far — see
/// docs/architecture-plan.md's macOS-build note); other platforms can't currently verify
/// this, so it optimistically assumes yes rather than showing a false warning.
#[cfg(target_os = "windows")]
fn dropbox_process_running() -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Dropbox.exe", "/NH"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("Dropbox.exe"))
        .unwrap_or(false)
}
#[cfg(not(target_os = "windows"))]
fn dropbox_process_running() -> bool {
    true
}

pub fn get_status(root: &Path) -> std::io::Result<SyncStatus> {
    let folder_readable = root.exists() && fs::read_dir(root).is_ok();
    // Read passively rather than manifest::rebuild()'s full rescan-and-rewrite — a status
    // check shouldn't have the side effect of touching manifest.json on every poll; a
    // slightly-stale timestamp here is a fine tradeoff (the next real save refreshes it).
    let entries: Vec<ManifestEntry> =
        read_json_file(&root.join("manifest.json")).unwrap_or_default();
    let last_library_change_at = entries.into_iter().map(|e| e.updated_at).max();
    let conflict_count = detect_conflicts(root)?.len();
    Ok(SyncStatus {
        folder_readable,
        sync_client_running: dropbox_process_running(),
        last_library_change_at,
        conflict_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, id: &str, updated_at: &str, device: &str, extra: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            format!(r#"{{"id":"{id}","title":"Great Are You Lord","updatedAt":"{updated_at}","updatedByDevice":"{device}"{extra}}}"#),
        )
        .unwrap();
    }

    #[test]
    fn detects_a_conflicted_copy_alongside_its_original() {
        let dir = tempfile::tempdir().unwrap();
        let songs_dir = dir.path().join("songs");
        write(
            &songs_dir.join("song-1.json"),
            "song-1",
            "2026-07-26T09:14:00Z",
            "This Computer",
            r#","key":"A""#,
        );
        write(
            &songs_dir.join("song-1 (Pastor's Mac's conflicted copy 2026-07-25).json"),
            "song-1",
            "2026-07-25T16:02:00Z",
            "Pastor's Mac",
            r#","key":"G""#,
        );

        let conflicts = detect_conflicts(dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, "song");
        assert_eq!(conflicts[0].id, "song-1");
        assert_eq!(conflicts[0].label, "Great Are You Lord");
        assert_eq!(conflicts[0].other_device, "Pastor's Mac");
        assert_eq!(conflicts[0].this_version["key"], "A");
        assert_eq!(conflicts[0].other_version["key"], "G");
    }

    #[test]
    fn ignores_a_conflicted_copy_whose_original_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let songs_dir = dir.path().join("songs");
        write(
            &songs_dir.join("song-1 (Conflicted copy 2026-07-25).json"),
            "song-1",
            "2026-07-25T16:02:00Z",
            "Pastor's Mac",
            "",
        );
        assert!(detect_conflicts(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn finds_conflicts_nested_under_a_service_year_folder() {
        let dir = tempfile::tempdir().unwrap();
        let year_dir = dir.path().join("services").join("2026");
        write(
            &year_dir.join("svc-1.json"),
            "svc-1",
            "2026-07-26T09:20:00Z",
            "This Computer",
            "",
        );
        write(
            &year_dir.join("svc-1 (Conflicted copy 2026-07-26).json"),
            "svc-1",
            "2026-07-26T08:55:00Z",
            "Pastor's Mac",
            "",
        );

        let conflicts = detect_conflicts(dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, "service");
    }

    #[test]
    fn resolve_keeping_mine_just_removes_the_conflict_file() {
        let dir = tempfile::tempdir().unwrap();
        let songs_dir = dir.path().join("songs");
        write(
            &songs_dir.join("song-1.json"),
            "song-1",
            "now",
            "This Computer",
            r#","key":"A""#,
        );
        let conflict_path = songs_dir.join("song-1 (Conflicted copy 2026-07-25).json");
        write(
            &conflict_path,
            "song-1",
            "earlier",
            "Pastor's Mac",
            r#","key":"G""#,
        );

        resolve_conflict(&conflict_path.to_string_lossy(), "mine").unwrap();

        assert!(!conflict_path.exists());
        let kept: Value = read_json_file(&songs_dir.join("song-1.json")).unwrap();
        assert_eq!(kept["key"], "A");
    }

    #[test]
    fn resolve_keeping_theirs_overwrites_the_original_and_removes_the_conflict_file() {
        let dir = tempfile::tempdir().unwrap();
        let songs_dir = dir.path().join("songs");
        write(
            &songs_dir.join("song-1.json"),
            "song-1",
            "now",
            "This Computer",
            r#","key":"A""#,
        );
        let conflict_path = songs_dir.join("song-1 (Conflicted copy 2026-07-25).json");
        write(
            &conflict_path,
            "song-1",
            "earlier",
            "Pastor's Mac",
            r#","key":"G""#,
        );

        resolve_conflict(&conflict_path.to_string_lossy(), "theirs").unwrap();

        assert!(!conflict_path.exists());
        let kept: Value = read_json_file(&songs_dir.join("song-1.json")).unwrap();
        assert_eq!(kept["key"], "G");
    }

    #[test]
    fn get_status_reports_folder_readable_and_conflict_count() {
        let dir = tempfile::tempdir().unwrap();
        let songs_dir = dir.path().join("songs");
        write(
            &songs_dir.join("song-1.json"),
            "song-1",
            "now",
            "This Computer",
            "",
        );
        write(
            &songs_dir.join("song-1 (Conflicted copy 2026-07-25).json"),
            "song-1",
            "earlier",
            "Pastor's Mac",
            "",
        );

        let status = get_status(dir.path()).unwrap();
        assert!(status.folder_readable);
        assert_eq!(status.conflict_count, 1);
    }

    #[test]
    fn get_status_reports_unreadable_for_a_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let status = get_status(&missing).unwrap();
        assert!(!status.folder_readable);
        assert_eq!(status.conflict_count, 0);
    }
}
