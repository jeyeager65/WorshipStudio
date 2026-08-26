//! Watches the library folder so the running app notices files changed underneath it — a tablet's
//! edit arriving through OneDrive's own client, a second desktop syncing the same folder, or
//! someone editing a file by hand.
//!
//! Without this the library is read once per app session: stores cache their loads, views skip
//! reloading when already loaded, and nothing invalidates that — so a desktop left open all week
//! shows whatever was on disk when it started. See notes/desktop-library-change-detection.md.
//!
//! Only `*.json` is watched. Media binaries are deliberately out of scope: replacing one rewrites
//! its metadata (content_hash, updatedAt, updatedByDevice — see domain::media::replace_from_file),
//! so no meaningful media change can happen without its JSON changing, and skipping binaries keeps
//! a cloud client's large chunked downloads out of the event stream entirely.
//!
//! Self-writes are recognised by **content, not provenance**. The app records a hash of every file
//! it writes (`record_write`, called from domain::atomic_write_bytes) and the watcher drops an
//! event whose file still matches that hash. A time-based ignore window was rejected: it swallows a
//! remote change landing while the app happens to be writing the same file, which is exactly the
//! case this feature exists to catch.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Emitted with the library-relative paths that changed. The operator window listens; the
/// presentation window has no stores to refresh and ignores it.
pub const LIBRARY_CHANGED_EVENT: &str = "library:changed";

/// Long enough to collapse a cloud client's burst of writes into one notification, short enough
/// that a change feels immediate. Only small JSON files reach here, so the wait is the only cost.
const DEBOUNCE: Duration = Duration::from_millis(800);

fn written_hashes() -> &'static Mutex<HashMap<PathBuf, u64>> {
    static HASHES: OnceLock<Mutex<HashMap<PathBuf, u64>>> = OnceLock::new();
    HASHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Records what this app just wrote, so the watcher can tell its own write apart from someone
/// else's. Keyed by content rather than by time — see this module's doc comment.
pub fn record_write(path: &Path, bytes: &[u8]) {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return;
    }
    if let Ok(mut hashes) = written_hashes().lock() {
        hashes.insert(path.to_path_buf(), hash_bytes(bytes));
    }
}

/// True when the file's current content is exactly what this app last wrote there.
fn is_own_write(path: &Path) -> bool {
    let Ok(hashes) = written_hashes().lock() else {
        return false;
    };
    let Some(expected) = hashes.get(path) else {
        return false;
    };
    match std::fs::read(path) {
        Ok(bytes) => hash_bytes(&bytes) == *expected,
        // Unreadable mid-write; treat as not-ours so the change is reported rather than lost.
        Err(_) => false,
    }
}

/// Whether a path is library content worth reporting, as opposed to the noise a cloud client and
/// this app's own atomic writes leave behind.
fn is_watchable(path: &Path, local_media_root: &Path) -> bool {
    if path.starts_with(local_media_root) {
        return false; // never synced, so never changed by anyone else
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    // atomic_write_bytes leaves a dot-prefixed `.tmp` beside its target; cloud clients add their
    // own dot-prefixed state. Nothing the operator cares about starts with a dot.
    if name.starts_with('.') {
        return false;
    }
    if name.ends_with(".backup") {
        return false; // this device's own recovery artifact, not shared content
    }
    path.extension().and_then(|e| e.to_str()) == Some("json")
}

fn relative_paths(paths: &HashSet<PathBuf>, root: &Path) -> Vec<String> {
    let mut out: Vec<String> = paths
        .iter()
        .filter_map(|path| path.strip_prefix(root).ok())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .collect();
    out.sort();
    out
}

fn collect(event: notify::Result<Event>, pending: &mut HashSet<PathBuf>, local_media_root: &Path) {
    let Ok(event) = event else { return };
    for path in event.paths {
        if is_watchable(&path, local_media_root) {
            pending.insert(path);
        }
    }
}

/// Starts watching in a background thread. Failure is logged and otherwise ignored — the app stays
/// fully usable without change detection, just back to needing a restart to see other devices'
/// edits, which is how it behaved before this existed.
///
/// The library root is read once here. Changing the library folder already requires a reload (see
/// SettingsView's "the library folder changed" prompt), which restarts this with the new path.
pub fn start(app: AppHandle) {
    let root = crate::paths::library_root(&app);
    let local_media_root = crate::paths::local_media_root(&app);
    if !root.is_dir() {
        log::info!(
            "Library watch not started: {} is not a folder",
            root.display()
        );
        return;
    }

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => watcher,
            Err(error) => {
                log::warn!("Could not create library watcher: {error}");
                return;
            }
        };
        if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
            log::warn!("Could not watch {}: {error}", root.display());
            return;
        }
        log::info!("Watching {} for changes made elsewhere", root.display());

        let mut pending: HashSet<PathBuf> = HashSet::new();
        loop {
            // Block for the next event, then keep draining for DEBOUNCE so a burst of writes
            // becomes one notification rather than one per file.
            let first = match rx.recv() {
                Ok(event) => event,
                Err(_) => break, // sender dropped; app is shutting down
            };
            collect(first, &mut pending, &local_media_root);
            while let Ok(event) = rx.recv_timeout(DEBOUNCE) {
                collect(event, &mut pending, &local_media_root);
            }

            pending.retain(|path| !is_own_write(path));
            if pending.is_empty() {
                continue;
            }
            let changed = relative_paths(&pending, &root);
            pending.clear();
            if let Err(error) = app.emit(LIBRARY_CHANGED_EVENT, &changed) {
                log::warn!("Could not emit {LIBRARY_CHANGED_EVENT}: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_media() -> PathBuf {
        PathBuf::from("/lib/Local/media")
    }

    #[test]
    fn accepts_ordinary_library_json() {
        assert!(is_watchable(Path::new("/lib/songs/a.json"), &local_media()));
    }

    #[test]
    fn rejects_media_binaries_since_their_metadata_always_changes_too() {
        assert!(!is_watchable(Path::new("/lib/media/a.mp4"), &local_media()));
        assert!(!is_watchable(Path::new("/lib/media/a.jpg"), &local_media()));
    }

    #[test]
    fn rejects_this_apps_own_atomic_write_temp_files() {
        assert!(!is_watchable(
            Path::new("/lib/songs/.a.json.0f8c.tmp"),
            &local_media()
        ));
    }

    #[test]
    fn rejects_backups_and_local_media() {
        assert!(!is_watchable(
            Path::new("/lib/songs/a.json.backup"),
            &local_media()
        ));
        assert!(!is_watchable(
            Path::new("/lib/Local/media/private.json"),
            &local_media()
        ));
    }

    #[test]
    fn reports_paths_relative_to_the_library_root_with_forward_slashes() {
        let mut paths = HashSet::new();
        paths.insert(PathBuf::from("/lib/songs/b.json"));
        paths.insert(PathBuf::from("/lib/songs/a.json"));
        paths.insert(PathBuf::from("/elsewhere/c.json")); // outside the root, dropped
        assert_eq!(
            relative_paths(&paths, Path::new("/lib")),
            vec!["songs/a.json".to_string(), "songs/b.json".to_string()]
        );
    }

    #[test]
    fn recognises_a_file_still_holding_exactly_what_this_app_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("song.json");
        let bytes = br#"{"id":"a"}"#;
        std::fs::write(&path, bytes).unwrap();
        record_write(&path, bytes);
        assert!(is_own_write(&path));

        // Someone else rewrote it — the hash no longer matches, so it must be reported even though
        // this app wrote to the same path moments earlier. A time-based ignore window would have
        // swallowed this.
        std::fs::write(&path, br#"{"id":"a","title":"changed"}"#).unwrap();
        assert!(!is_own_write(&path));
    }

    #[test]
    fn treats_a_path_this_app_never_wrote_as_someone_elses() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("never-written.json");
        std::fs::write(&path, b"{}").unwrap();
        assert!(!is_own_write(&path));
    }
}
