use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;
use tauri::AppHandle;

use crate::domain::{read_json_file, song_collections, songs, write_json_file};
use crate::models::SongCollectionDefinition;
use crate::paths::library_root;

const LIBRARY_SETTINGS_FILE: &str = "library-settings.json";
/// Shared with `commands::settings::clear_migration_snapshots` so the one-off cleanup command
/// can never drift from the filename this migration actually writes.
pub const MIGRATION_SNAPSHOT_FILE: &str = "library-settings.pre-collection-id-migration.json";

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Deterministic id derived from the name, used only for migration-assigned ids — see
/// `migrate_if_needed`'s own doc comment for why this can't just be a random UUID like every
/// other content type's id. Not used for collections created normally after migration (those
/// get an ordinary random id from the frontend, same as songs/services/etc.).
fn slug(name: &str) -> String {
    let normalized = normalize(name);
    let mut result = String::new();
    for ch in normalized.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch);
        } else if !result.ends_with('-') && !result.is_empty() {
            result.push('-');
        }
    }
    while result.ends_with('-') {
        result.pop();
    }
    if result.is_empty() {
        // A real collection name with zero alphanumeric characters is vanishingly unlikely,
        // but this must still produce *some* id — falls back to non-deterministic here since
        // there's nothing meaningful left to derive determinism from anyway.
        format!("unnamed-{}", uuid::Uuid::new_v4())
    } else {
        result
    }
}

/// Reads the legacy `collections` array straight out of library-settings.json as raw JSON —
/// it's no longer a `LibrarySettings` struct field, so this can't go through the normal typed
/// read. Handles both historical shapes a real file could have (plain string, or the
/// `{ name, abbreviation }` object the now-removed flexible deserializer already upgraded
/// bare strings to) — either can genuinely be on disk depending on when it was last saved.
fn legacy_collections(root: &Path) -> std::io::Result<Vec<(String, Option<String>)>> {
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    let Some(raw) = read_json_file::<Value>(&settings_path)? else {
        return Ok(Vec::new());
    };
    let Some(entries) = raw.get("collections").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    Ok(entries
        .iter()
        .filter_map(|entry| match entry {
            Value::String(name) => Some((name.clone(), None)),
            Value::Object(_) => {
                let name = entry.get("name")?.as_str()?.to_string();
                let abbreviation = entry
                    .get("abbreviation")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                Some((name, abbreviation))
            }
            _ => None,
        })
        .collect())
}

/// One-time migration: before song collections had real ids, `Song.collections[].collectionId`
/// held the collection's plain *name*, and the collection list itself lived nested inside
/// library-settings.json's own `collections` field. Runs once, the first time
/// song-collections.json doesn't exist yet.
///
/// Migration-assigned ids are a deterministic slug of the (trimmed, lowercased) name, not a
/// random UUID: these files are synced, and two computers could each independently run this
/// migration on the same church's library before ever syncing with each other (e.g. both
/// offline for a stretch). Random ids would let "Hymnal One" get two different ids depending
/// on which machine you ask, forking one logical collection into two the moment they finally
/// sync. Deterministic ids converge automatically instead. Collections created normally after
/// migration (via the frontend's own `save()`) still get an ordinary random id, matching every
/// other content type — only the migration itself needs this property.
///
/// Also rewrites every song's `collectionId` from name to id, auto-creating a definition for
/// any name a song references that wasn't in the legacy list at all (never drops a historical
/// reference). This part is intentionally *not* independently re-triggered on every later call
/// the way a fully crash-proof migration would need — it runs once, gated on the same
/// `song-collections.json` absence check, together with the definitions migration. A crash in
/// the narrow window between writing the definitions file and finishing the song rewrite loop
/// is a real but very unlikely edge case; its failure mode is graceful (a song's not-yet-
/// rewritten `collectionId` just won't match any definition, so its citation shows blank until
/// re-saved) rather than data loss, which is an acceptable trade against the complexity of full
/// crash-atomicity for a fast, synchronous, one-time local operation.
pub fn migrate_if_needed(root: &Path) -> std::io::Result<()> {
    if song_collections::exists(root) {
        return Ok(());
    }

    // One-off manual escape hatch distinct from write_json_file's own rolling `.backup` --
    // given the stakes of rewriting real library data, this snapshot is never auto-cleaned.
    let settings_path = root.join(LIBRARY_SETTINGS_FILE);
    if let Ok(bytes) = std::fs::read(&settings_path) {
        let snapshot = root.join(MIGRATION_SNAPSHOT_FILE);
        if !snapshot.exists() {
            let _ = std::fs::write(&snapshot, &bytes);
        }
    }

    let mut definitions: Vec<SongCollectionDefinition> = Vec::new();
    let mut id_by_normalized_name: HashMap<String, String> = HashMap::new();

    for (name, abbreviation) in legacy_collections(root)? {
        let key = normalize(&name);
        if id_by_normalized_name.contains_key(&key) {
            continue;
        }
        let id = format!("collection-{}", slug(&name));
        id_by_normalized_name.insert(key, id.clone());
        definitions.push(SongCollectionDefinition {
            id,
            name: name.trim().to_string(),
            abbreviation,
        });
    }

    // Every song's own collection references -- rewrite name -> id, auto-creating a
    // definition for anything a song references that the legacy settings list didn't have
    // (drift between the two is realistic in data entered over months by different people).
    let mut songs_list = songs::list(root)?;
    for song in songs_list.iter_mut() {
        for entry in song.collections.iter_mut() {
            let key = normalize(&entry.collection_id);
            let id = if let Some(existing) = id_by_normalized_name.get(&key) {
                existing.clone()
            } else {
                let id = format!("collection-{}", slug(&entry.collection_id));
                id_by_normalized_name.insert(key, id.clone());
                definitions.push(SongCollectionDefinition {
                    id: id.clone(),
                    name: entry.collection_id.trim().to_string(),
                    abbreviation: None,
                });
                id
            };
            entry.collection_id = id;
        }
    }

    song_collections::replace_all(root, &definitions)?;
    for song in &songs_list {
        write_json_file(&root.join("songs").join(format!("{}.json", song.id)), song)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_song_collections(app: AppHandle) -> Result<Vec<SongCollectionDefinition>, String> {
    let root = library_root(&app);
    migrate_if_needed(&root).map_err(|e| e.to_string())?;
    song_collections::list(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_song_collection(
    app: AppHandle,
    collection: SongCollectionDefinition,
) -> Result<SongCollectionDefinition, String> {
    song_collections::save(&library_root(&app), collection).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_song_collection(app: AppHandle, id: String) -> Result<(), String> {
    song_collections::delete(&library_root(&app), &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::write_json_file;
    use crate::models::{Song, SongCollectionEntry};
    use serde_json::json;

    fn sample_song(id: &str, collection_ids: &[&str]) -> Song {
        Song {
            id: id.to_string(),
            title: id.to_string(),
            ccli: None,
            author: None,
            artist: None,
            copyright: None,
            collections: collection_ids
                .iter()
                .map(|c| SongCollectionEntry {
                    collection_id: c.to_string(),
                    number: None,
                })
                .collect(),
            tags: vec![],
            notes: None,
            blocks: vec![],
            default_arrangement: Default::default(),
            usage: Default::default(),
            archived: false,
            updated_at: "now".to_string(),
            updated_by_device: "d".to_string(),
        }
    }

    #[test]
    fn migrates_string_shaped_legacy_collections_and_rewrites_song_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "collections": ["Hymnal One", { "name": "Hymnal Two", "abbreviation": "H2" }] }),
        )
        .unwrap();
        write_json_file(
            &root.join("songs").join("song-1.json"),
            &sample_song("song-1", &["Hymnal One"]),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = song_collections::list(root).unwrap();
        assert_eq!(definitions.len(), 2);
        let hymnal_two = definitions.iter().find(|d| d.name == "Hymnal Two").unwrap();
        assert_eq!(hymnal_two.abbreviation.as_deref(), Some("H2"));

        let migrated_song: Song = read_json_file(&root.join("songs").join("song-1.json"))
            .unwrap()
            .unwrap();
        let hymnal_one = definitions.iter().find(|d| d.name == "Hymnal One").unwrap();
        assert_eq!(migrated_song.collections[0].collection_id, hymnal_one.id);
    }

    #[test]
    fn name_matching_is_trimmed_and_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "collections": ["Hymnal One"] }),
        )
        .unwrap();
        write_json_file(
            &root.join("songs").join("song-1.json"),
            &sample_song("song-1", &["  hymnal one  "]),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = song_collections::list(root).unwrap();
        assert_eq!(
            definitions.len(),
            1,
            "drifted casing/whitespace must not fork a duplicate"
        );
    }

    #[test]
    fn auto_creates_a_definition_for_a_song_referencing_a_name_missing_from_the_legacy_list() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "collections": [] }),
        )
        .unwrap();
        write_json_file(
            &root.join("songs").join("song-1.json"),
            &sample_song("song-1", &["Orphaned Collection"]),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = song_collections::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Orphaned Collection");
        let migrated_song: Song = read_json_file(&root.join("songs").join("song-1.json"))
            .unwrap()
            .unwrap();
        assert_eq!(
            migrated_song.collections[0].collection_id,
            definitions[0].id
        );
    }

    #[test]
    fn is_a_no_op_once_song_collections_json_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        song_collections::save(
            root,
            SongCollectionDefinition {
                id: "collection-existing".to_string(),
                name: "Already Migrated".to_string(),
                abbreviation: None,
            },
        )
        .unwrap();
        write_json_file(
            &root.join("library-settings.json"),
            &json!({ "collections": ["Should Be Ignored"] }),
        )
        .unwrap();

        migrate_if_needed(root).unwrap();

        let definitions = song_collections::list(root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "Already Migrated");
    }

    #[test]
    fn two_independent_migrations_of_the_same_name_converge_on_the_same_id() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        for root in [dir_a.path(), dir_b.path()] {
            write_json_file(
                &root.join("library-settings.json"),
                &json!({ "collections": ["Hymnal One"] }),
            )
            .unwrap();
            migrate_if_needed(root).unwrap();
        }
        let id_a = song_collections::list(dir_a.path()).unwrap()[0].id.clone();
        let id_b = song_collections::list(dir_b.path()).unwrap()[0].id.clone();
        assert_eq!(
            id_a, id_b,
            "two machines migrating independently must not fork the id"
        );
    }
}
