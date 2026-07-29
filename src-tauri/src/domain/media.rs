use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::{MediaItem, Usage};

use super::{delete_file_if_exists, read_json_dir, read_json_file, write_json_file};

fn media_items_dir(root: &Path) -> PathBuf {
    root.join("media-items")
}

fn media_item_path(root: &Path, id: &str) -> PathBuf {
    media_items_dir(root).join(format!("{id}.json"))
}

/// Where actual synced media *files* live (as opposed to `media-items/`, which holds each
/// item's JSON metadata) — referenced by relative path from elsewhere (slides/themes store
/// only a MediaItem id), never copied into those JSON documents directly.
pub fn synced_media_dir(root: &Path) -> PathBuf {
    root.join("media")
}

pub fn list(root: &Path) -> std::io::Result<Vec<MediaItem>> {
    Ok(read_json_dir(&media_items_dir(root))?
        .into_iter()
        .map(normalize_title)
        .collect())
}

/// A title is required everywhere this item is displayed, but on-disk records saved before
/// this field existed have an empty one (see MediaItem::title) — backfilled here from the
/// filename on every read rather than eagerly rewritten to disk, since re-deriving it is cheap
/// and idempotent, and doesn't force a write the first time an old library is opened.
fn normalize_title(mut item: MediaItem) -> MediaItem {
    if item.title.trim().is_empty() {
        item.title = title_from_filename(&item.filename);
    }
    item
}

fn title_from_filename(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string()
}

/// The actual file on disk backing a MediaItem — needed for real playback/display (spec
/// sections 3/1), not just the metadata `list`/`get` return. Doesn't check existence; callers
/// that need to fail loudly on a missing file do that check themselves.
pub fn file_path(root: &Path, local_media_root: &Path, item: &MediaItem) -> PathBuf {
    let dir = if item.location == "local" {
        local_media_root
    } else {
        &synced_media_dir(root)
    };
    dir.join(&item.filename)
}

pub fn get(root: &Path, id: &str) -> Option<MediaItem> {
    read_json_file(&media_item_path(root, id)).map(normalize_title)
}

pub fn save(
    root: &Path,
    mut item: MediaItem,
    device: &str,
    now: &str,
) -> std::io::Result<MediaItem> {
    item.updated_at = now.to_string();
    item.updated_by_device = device.to_string();
    write_json_file(&media_item_path(root, &item.id), &item)?;
    Ok(item)
}

/// Deletes both the metadata record and the underlying file (in whichever folder its
/// `location` says it lives) — orphaned media files would otherwise accumulate on disk
/// forever with no UI able to find them again.
pub fn delete(root: &Path, local_media_root: &Path, id: &str) -> std::io::Result<()> {
    if let Some(item) = get(root, id) {
        let _ = fs::remove_file(file_path(root, local_media_root, &item));
    }
    delete_file_if_exists(&media_item_path(root, id))
}

/// Non-cryptographic content hash — good enough to notice an accidental duplicate import,
/// not meant as an integrity/security guarantee. Avoids adding a hashing crate dependency
/// for something this low-stakes.
fn hash_file(path: &Path) -> std::io::Result<String> {
    let bytes = fs::read(path)?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn guess_kind(filename: &str) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "mp4" | "mov" | "webm" | "m4v" => "video",
        _ => "image",
    }
    .to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StagedMediaFile {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_of_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_of_filename: Option<String>,
}

/// Reads each candidate file just enough to stage it for the Import Media review dialog:
/// size (for the large-file/"store locally instead?" nudge) and whether its content already
/// matches an existing library item (the duplicate nudge). Both nudges default-checked in
/// the UI but stay overridable — never a hard block (design/feature-spec.md's Media Library
/// section).
pub fn stage_imports(root: &Path, paths: &[String]) -> std::io::Result<Vec<StagedMediaFile>> {
    let existing = list(root)?;
    let mut staged = Vec::new();
    for path_str in paths {
        let path = Path::new(path_str);
        let metadata = fs::metadata(path)?;
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        let content_hash = hash_file(path)?;
        let duplicate = existing
            .iter()
            .find(|item| item.content_hash == content_hash);
        staged.push(StagedMediaFile {
            path: path_str.clone(),
            kind: guess_kind(&filename),
            filename,
            size_bytes: metadata.len(),
            duplicate_of_id: duplicate.map(|d| d.id.clone()),
            duplicate_of_filename: duplicate.map(|d| d.filename.clone()),
        });
    }
    Ok(staged)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaImportCommit {
    pub path: String,
    pub filename: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_of_id: Option<String>,
}

fn unique_filename(dir: &Path, filename: &str) -> String {
    if !dir.join(filename).exists() {
        return filename.to_string();
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = path.extension().and_then(|e| e.to_str());
    for n in 2.. {
        let candidate = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// Copies each accepted file into the managed media folder (synced or local, per its chosen
/// location) and creates its MediaItem record. A destination filename collision (two
/// different source files that happen to share a name) gets a " (2)"-style suffix rather
/// than silently overwriting an unrelated file.
pub fn commit_imports(
    root: &Path,
    local_media_root: &Path,
    files: Vec<MediaImportCommit>,
    device: &str,
    now: &str,
) -> std::io::Result<Vec<MediaItem>> {
    let synced_dir = synced_media_dir(root);
    fs::create_dir_all(&synced_dir)?;
    fs::create_dir_all(local_media_root)?;

    let mut created = Vec::new();
    for file in files {
        let dest_dir = if file.location == "local" {
            local_media_root
        } else {
            &synced_dir
        };
        let dest_filename = unique_filename(dest_dir, &file.filename);
        let dest_path = dest_dir.join(&dest_filename);
        fs::copy(&file.path, &dest_path)?;
        let content_hash = hash_file(&dest_path)?;

        let item = MediaItem {
            id: format!("media-{}", uuid::Uuid::new_v4()),
            kind: guess_kind(&file.filename),
            filename: dest_filename,
            title: if file.title.trim().is_empty() {
                title_from_filename(&file.filename)
            } else {
                file.title
            },
            description: file.description,
            tags: file.tags,
            location: file.location,
            duplicate_of_id: file.duplicate_of_id,
            content_hash,
            usage: Usage {
                last_used_at: None,
                uses_past_year: 0,
            },
            updated_at: now.to_string(),
            updated_by_device: device.to_string(),
        };
        write_json_file(&media_item_path(root, &item.id), &item)?;
        created.push(item);
    }
    Ok(created)
}

/// Explicit re-check for an already-imported item — the passive "DUPLICATE" badge's backstop
/// for a file that entered the library some other way (e.g. copied straight into the sync
/// folder rather than through Import Media). Matches by content hash, excluding itself.
pub fn detect_duplicates(root: &Path, item: &MediaItem) -> std::io::Result<Vec<MediaItem>> {
    Ok(list(root)?
        .into_iter()
        .filter(|other| other.id != item.id && other.content_hash == item.content_hash)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, filename: &str, location: &str, content_hash: &str) -> MediaItem {
        MediaItem {
            id: id.to_string(),
            filename: filename.to_string(),
            title: filename.to_string(),
            description: None,
            kind: guess_kind(filename),
            tags: vec![],
            location: location.to_string(),
            duplicate_of_id: None,
            content_hash: content_hash.to_string(),
            usage: Usage {
                last_used_at: None,
                uses_past_year: 0,
            },
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn guesses_video_kind_from_common_extensions() {
        assert_eq!(guess_kind("clouds-loop.mp4"), "video");
        assert_eq!(guess_kind("clouds-loop.MOV"), "video");
    }

    #[test]
    fn guesses_image_kind_for_anything_else() {
        assert_eq!(guess_kind("sunset.jpg"), "image");
        assert_eq!(guess_kind("sunset.PNG"), "image");
        assert_eq!(guess_kind("no-extension"), "image");
    }

    #[test]
    fn file_path_resolves_synced_items_under_the_library_media_dir() {
        let root = Path::new("/library");
        let local = Path::new("/local-media");
        let item = sample("media-1", "sunset.jpg", "synced", "abc");
        assert_eq!(
            file_path(root, local, &item),
            root.join("media").join("sunset.jpg")
        );
    }

    #[test]
    fn file_path_resolves_local_items_under_the_local_media_root() {
        let root = Path::new("/library");
        let local = Path::new("/local-media");
        let item = sample("media-1", "clip.mp4", "local", "abc");
        assert_eq!(file_path(root, local, &item), local.join("clip.mp4"));
    }

    #[test]
    fn save_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        save(
            dir.path(),
            sample("media-1", "a.jpg", "synced", "abc"),
            "d",
            "now",
        )
        .unwrap();
        assert_eq!(get(dir.path(), "media-1").unwrap().filename, "a.jpg");
    }

    #[test]
    fn stage_imports_flags_a_file_whose_content_matches_an_existing_item() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("cross-hill-copy.jpg");
        fs::write(&file_path, b"same bytes").unwrap();
        let content_hash = hash_file(&file_path).unwrap();

        save(
            root,
            sample("media-1", "cross-hill.jpg", "synced", &content_hash),
            "d",
            "now",
        )
        .unwrap();

        let staged = stage_imports(root, &[file_path.to_string_lossy().to_string()]).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].duplicate_of_id.as_deref(), Some("media-1"));
        assert_eq!(
            staged[0].duplicate_of_filename.as_deref(),
            Some("cross-hill.jpg")
        );
        assert_eq!(staged[0].kind, "image");
    }

    #[test]
    fn stage_imports_reports_no_duplicate_for_unique_content() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("unique.jpg");
        fs::write(&file_path, b"never seen before").unwrap();

        let staged = stage_imports(dir.path(), &[file_path.to_string_lossy().to_string()]).unwrap();
        assert_eq!(staged.len(), 1);
        assert!(staged[0].duplicate_of_id.is_none());
    }

    #[test]
    fn commit_imports_copies_the_file_and_creates_a_record() {
        let root_dir = tempfile::tempdir().unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("sunset.jpg");
        fs::write(&file_path, b"pixels").unwrap();

        let created = commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![MediaImportCommit {
                path: file_path.to_string_lossy().to_string(),
                filename: "sunset.jpg".to_string(),
                title: "Sunset Over the Hills".to_string(),
                description: Some("Taken after the Easter service".to_string()),
                tags: vec!["Worship".to_string()],
                location: "synced".to_string(),
                duplicate_of_id: None,
            }],
            "d",
            "now",
        )
        .unwrap();

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].filename, "sunset.jpg");
        assert_eq!(created[0].title, "Sunset Over the Hills");
        assert_eq!(
            created[0].description.as_deref(),
            Some("Taken after the Easter service")
        );
        assert_eq!(created[0].tags, vec!["Worship".to_string()]);
        assert!(synced_media_dir(root_dir.path())
            .join("sunset.jpg")
            .exists());
    }

    #[test]
    fn commit_imports_copies_local_only_files_into_the_local_media_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("big-loop.mp4");
        fs::write(&file_path, b"big video bytes").unwrap();

        let created = commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![MediaImportCommit {
                path: file_path.to_string_lossy().to_string(),
                filename: "big-loop.mp4".to_string(),
                title: "Big Loop".to_string(),
                description: None,
                tags: vec![],
                location: "local".to_string(),
                duplicate_of_id: None,
            }],
            "d",
            "now",
        )
        .unwrap();

        assert_eq!(created[0].location, "local");
        assert!(local_dir.path().join("big-loop.mp4").exists());
        assert!(!synced_media_dir(root_dir.path())
            .join("big-loop.mp4")
            .exists());
    }

    #[test]
    fn commit_imports_dedupes_a_destination_filename_collision() {
        let root_dir = tempfile::tempdir().unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let first = source_dir.path().join("a.jpg");
        let second = source_dir.path().join("b.jpg");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();

        let make = |path: &Path| MediaImportCommit {
            path: path.to_string_lossy().to_string(),
            filename: "bg.jpg".to_string(),
            title: "Background".to_string(),
            description: None,
            tags: vec![],
            location: "synced".to_string(),
            duplicate_of_id: None,
        };

        commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![make(&first)],
            "d",
            "now",
        )
        .unwrap();
        let second_created = commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![make(&second)],
            "d",
            "now",
        )
        .unwrap();

        assert_eq!(second_created[0].filename, "bg (2).jpg");
        assert!(synced_media_dir(root_dir.path()).join("bg.jpg").exists());
        assert!(synced_media_dir(root_dir.path())
            .join("bg (2).jpg")
            .exists());
    }

    #[test]
    fn delete_removes_both_the_record_and_the_underlying_file() {
        let root_dir = tempfile::tempdir().unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("gone.jpg");
        fs::write(&file_path, b"data").unwrap();

        let created = commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![MediaImportCommit {
                path: file_path.to_string_lossy().to_string(),
                filename: "gone.jpg".to_string(),
                title: "Gone".to_string(),
                description: None,
                tags: vec![],
                location: "synced".to_string(),
                duplicate_of_id: None,
            }],
            "d",
            "now",
        )
        .unwrap();

        delete(root_dir.path(), local_dir.path(), &created[0].id).unwrap();
        assert!(get(root_dir.path(), &created[0].id).is_none());
        assert!(!synced_media_dir(root_dir.path()).join("gone.jpg").exists());
    }

    #[test]
    fn detect_duplicates_matches_by_content_hash_excluding_itself() {
        let dir = tempfile::tempdir().unwrap();
        let a = sample("media-a", "a.jpg", "synced", "same-hash");
        let b = sample("media-b", "b.jpg", "synced", "same-hash");
        let c = sample("media-c", "c.jpg", "synced", "different-hash");
        save(dir.path(), a.clone(), "d", "now").unwrap();
        save(dir.path(), b.clone(), "d", "now").unwrap();
        save(dir.path(), c, "d", "now").unwrap();

        let duplicates = detect_duplicates(dir.path(), &a).unwrap();
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].id, "media-b");
    }

    #[test]
    fn get_and_list_backfill_a_missing_title_from_the_filename() {
        let dir = tempfile::tempdir().unwrap();
        let mut item = sample("media-1", "cross-hill-sunset.jpg", "synced", "abc");
        item.title = String::new();
        save(dir.path(), item, "d", "now").unwrap();

        assert_eq!(
            get(dir.path(), "media-1").unwrap().title,
            "cross-hill-sunset"
        );
        assert_eq!(list(dir.path()).unwrap()[0].title, "cross-hill-sunset");
    }

    #[test]
    fn get_and_list_leave_an_existing_title_alone() {
        let dir = tempfile::tempdir().unwrap();
        let mut item = sample("media-1", "cross-hill-sunset.jpg", "synced", "abc");
        item.title = "Cross Hill at Sunset".to_string();
        save(dir.path(), item, "d", "now").unwrap();

        assert_eq!(
            get(dir.path(), "media-1").unwrap().title,
            "Cross Hill at Sunset"
        );
    }

    #[test]
    fn commit_imports_derives_a_title_from_the_filename_when_none_is_sent() {
        let root_dir = tempfile::tempdir().unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let file_path = source_dir.path().join("wide-open-field.jpg");
        fs::write(&file_path, b"pixels").unwrap();

        let created = commit_imports(
            root_dir.path(),
            local_dir.path(),
            vec![MediaImportCommit {
                path: file_path.to_string_lossy().to_string(),
                filename: "wide-open-field.jpg".to_string(),
                title: String::new(),
                description: None,
                tags: vec![],
                location: "synced".to_string(),
                duplicate_of_id: None,
            }],
            "d",
            "now",
        )
        .unwrap();

        assert_eq!(created[0].title, "wide-open-field");
    }
}
