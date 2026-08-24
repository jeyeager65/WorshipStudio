use std::path::{Path, PathBuf};

use crate::models::{ExternalAppImplementation, ExternalAppKeyCommand, ExternalAppProfile};

use super::{read_json_file, write_json_file};

// ---------------------------------------------------------------------------------------------
// Shared/synced profiles (library_root/external-app-profiles.json)
// ---------------------------------------------------------------------------------------------

/// Whole-list-in-one-file rather than one-file-per-profile (unlike songs/slides/etc.) — a
/// church realistically has a handful of these at most, and unlike synced library content,
/// there's no Dropbox-conflict concern to keep per-item files scoped around.
pub fn list(profiles_path: &Path) -> std::io::Result<Vec<ExternalAppProfile>> {
    Ok(read_json_file(profiles_path)?.unwrap_or_default())
}

pub fn save(
    profiles_path: &Path,
    mut profile: ExternalAppProfile,
    device: &str,
    now: &str,
) -> std::io::Result<ExternalAppProfile> {
    profile.updated_at = now.to_string();
    profile.updated_by_device = device.to_string();
    let mut all = list(profiles_path)?;
    match all.iter().position(|p| p.id == profile.id) {
        Some(index) => all[index] = profile.clone(),
        None => all.push(profile.clone()),
    }
    write_json_file(profiles_path, &all)?;
    Ok(profile)
}

pub fn delete(profiles_path: &Path, id: &str) -> std::io::Result<()> {
    let mut all = list(profiles_path)?;
    all.retain(|p| p.id != id);
    write_json_file(profiles_path, &all)
}

/// The `.backup` sibling `write_json_file` keeps beside this file — see
/// `commands::settings::clear_settings_list_backups`, the one place this is used. Takes the
/// library `root`, not an already-resolved path, matching every sibling whole-list file's own
/// `backup_path(root)` (song_collections.rs, service_types.rs, ...) exactly.
pub fn backup_path(root: &Path) -> PathBuf {
    super::backup_path(&root.join("external-app-profiles.json"))
}

// ---------------------------------------------------------------------------------------------
// Per-machine implementations (local_root/external-apps.json) — just {profileId, executablePath}
// ---------------------------------------------------------------------------------------------

pub fn list_implementations(
    implementations_path: &Path,
) -> std::io::Result<Vec<ExternalAppImplementation>> {
    Ok(read_json_file(implementations_path)?.unwrap_or_default())
}

pub fn get_implementation(
    implementations_path: &Path,
    profile_id: &str,
) -> std::io::Result<Option<ExternalAppImplementation>> {
    Ok(list_implementations(implementations_path)?
        .into_iter()
        .find(|i| i.profile_id == profile_id))
}

pub fn save_implementation(
    implementations_path: &Path,
    profile_id: &str,
    executable_path: &str,
) -> std::io::Result<()> {
    let mut all = list_implementations(implementations_path)?;
    match all.iter_mut().find(|i| i.profile_id == profile_id) {
        Some(existing) => existing.executable_path = executable_path.to_string(),
        None => all.push(ExternalAppImplementation {
            profile_id: profile_id.to_string(),
            executable_path: executable_path.to_string(),
        }),
    }
    write_json_file(implementations_path, &all)
}

// ---------------------------------------------------------------------------------------------
// One-time migration: pre-split external-apps.json (flat profiles with an inline
// executable_path) into the new shared profiles file + slim per-machine implementations file.
// ---------------------------------------------------------------------------------------------

/// The pre-split shape `external-apps.json` used to hold — read-only, only ever deserialized by
/// `migrate_if_needed` below to pull the two new shapes apart from what's already on disk.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyExternalAppProfile {
    id: String,
    name: String,
    launch_mode: String,
    #[serde(default)]
    executable_path: Option<String>,
    #[serde(default)]
    parameter_format: Option<String>,
    #[serde(default)]
    remote_controls_enabled: bool,
    #[serde(default)]
    key_commands: Vec<ExternalAppKeyCommand>,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    updated_by_device: String,
}

/// Follows this codebase's established one-time-migration shape (see
/// `domain::songs::migrate_usage_dates_if_needed`): gate on a marker (checked *before* ever
/// reading/deserializing `implementations_path` — once the marker exists this never again
/// attempts to parse that file as the old shape, which matters since the new slim
/// `ExternalAppImplementation` shape doesn't satisfy `LegacyExternalAppProfile`'s required
/// fields), trigger eagerly from the relevant list command, cheap no-op thereafter. Only ever
/// relevant on Tauri — web/tablet never had this feature pre-split, so there's nothing there to
/// migrate.
///
/// If `implementations_path` (the pre-split `external-apps.json`) still holds the *old* flat
/// shape, splits each record into a shared profile (written to `profiles_path`, defaulting
/// `kind: "custom"` and no `allowedExtensions` — nothing in the old shape captures either) plus
/// an implementation record (rewritten in place at `implementations_path`, now holding only
/// `{profileId, executablePath}` pairs).
///
/// Accepted edge case: if two computers each already had their own independently-configured
/// "PowerPoint" profile before this migration, they'll produce two separate shared profiles once
/// both sync — not auto-merged; the operator can delete the duplicate.
pub fn migrate_if_needed(
    implementations_path: &Path,
    profiles_path: &Path,
    device: &str,
    now: &str,
) -> std::io::Result<()> {
    let marker_path = implementations_path.with_file_name("external-apps.migrated-to-shared.json");
    if marker_path.is_file() {
        return Ok(());
    }
    let legacy: Vec<LegacyExternalAppProfile> =
        read_json_file(implementations_path)?.unwrap_or_default();

    if !legacy.is_empty() {
        let mut profiles = list(profiles_path)?;
        // Not `list_implementations(implementations_path)` — that path still holds the *old*
        // flat shape right now (that's what `legacy` above just read), not the new
        // ExternalAppImplementation shape, so reading it a second time as that shape would fail.
        // Migration is all-or-nothing per file (gated by the marker above), so there's nothing
        // else to merge with yet — every implementation this produces comes from `legacy` itself.
        let mut implementations: Vec<ExternalAppImplementation> = Vec::new();
        for old in legacy {
            if !profiles.iter().any(|p| p.id == old.id) {
                profiles.push(ExternalAppProfile {
                    id: old.id.clone(),
                    name: old.name,
                    kind: "custom".to_string(),
                    launch_mode: old.launch_mode,
                    parameter_format: old.parameter_format,
                    remote_controls_enabled: old.remote_controls_enabled,
                    key_commands: old.key_commands,
                    allowed_extensions: Vec::new(),
                    updated_at: if old.updated_at.is_empty() {
                        now.to_string()
                    } else {
                        old.updated_at
                    },
                    updated_by_device: if old.updated_by_device.is_empty() {
                        device.to_string()
                    } else {
                        old.updated_by_device
                    },
                });
            }
            if let Some(executable_path) = old.executable_path {
                if !executable_path.trim().is_empty()
                    && !implementations.iter().any(|i| i.profile_id == old.id)
                {
                    implementations.push(ExternalAppImplementation {
                        profile_id: old.id,
                        executable_path,
                    });
                }
            }
        }
        write_json_file(profiles_path, &profiles)?;
        write_json_file(implementations_path, &implementations)?;
    }
    write_json_file(&marker_path, &serde_json::json!({ "migratedAt": now }))
}

// ---------------------------------------------------------------------------------------------
// Starter profiles
// ---------------------------------------------------------------------------------------------

/// A starter profile for a common presentation-adjacent app. `candidate_executable_paths` is
/// probed only at import time to seed *this machine's* implementation record — never baked into
/// the shared profile itself, which has no notion of a specific computer at all.
pub struct DefaultExternalAppProfile {
    pub id: &'static str,
    pub name: &'static str,
    /// "powerpoint" | "video" | "custom" — see ExternalAppProfile::kind.
    pub kind: &'static str,
    pub launch_mode: &'static str,
    pub parameter_format: &'static str,
    /// Checked in order at import time; the first one that exists on this machine becomes this
    /// machine's seeded implementation record. None found just leaves it unimplemented here —
    /// still a real, useful starter profile with the right launch mode/parameters/remote keys
    /// already filled in; the operator only has to point it at their actual install once.
    pub candidate_executable_paths: &'static [&'static str],
    pub remote_controls_enabled: bool,
    /// `(label, key_combo, trigger_key)` for each starter command — see
    /// `ExternalAppKeyCommand`'s own doc comment for what these mean. Not reserved/special in
    /// any way; the operator can rename, rebind, or delete them like any other command.
    pub key_commands: &'static [(&'static str, &'static str, Option<&'static str>)],
    /// Seeded `allowedExtensions` — still just a starting point, freely editable/clearable.
    pub allowed_extensions: &'static [&'static str],
}

pub fn default_profiles() -> &'static [DefaultExternalAppProfile] {
    &[
        DefaultExternalAppProfile {
            id: "external-app-default-powerpoint",
            name: "PowerPoint",
            kind: "powerpoint",
            launch_mode: "launch-automatically",
            // /S launches straight into slideshow mode for the given file, no editor chrome.
            parameter_format: r#"/S "{file}""#,
            candidate_executable_paths: &[
                r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
                r"C:\Program Files (x86)\Microsoft Office\root\Office16\POWERPNT.EXE",
            ],
            remote_controls_enabled: true,
            key_commands: &[
                ("Next", "Right", Some("Right")),
                ("Previous", "Left", Some("Left")),
            ],
            allowed_extensions: &["pptx", "ppt", "ppsx"],
        },
        DefaultExternalAppProfile {
            id: "external-app-default-vlc",
            name: "VLC",
            kind: "video",
            launch_mode: "launch-automatically",
            // --play-and-exit closes VLC when the clip ends rather than sitting on the last
            // frame/playlist view, so restore_self's minimize is the only cleanup needed.
            parameter_format: r#"--fullscreen --play-and-exit "{file}""#,
            candidate_executable_paths: &[
                r"C:\Program Files\VideoLAN\VLC\vlc.exe",
                r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
            ],
            remote_controls_enabled: false,
            key_commands: &[],
            allowed_extensions: &["mp4", "mov", "webm", "m4v", "mkv", "avi"],
        },
    ]
}

/// Adds every default profile not already present (matched by id, same idempotency convention as
/// `stock_content::import` — safe to invoke repeatedly, e.g. from a "Add Suggested Profiles"
/// button, without duplicating anything already added or edited). Also seeds *this machine's*
/// implementation record for any newly-added default whose executable is found at one of its
/// candidate paths. Returns how many profiles were newly added.
pub fn import_defaults(
    profiles_path: &Path,
    implementations_path: &Path,
    device: &str,
    now: &str,
) -> std::io::Result<u32> {
    let mut profiles = list(profiles_path)?;
    let mut implementations = list_implementations(implementations_path)?;
    let mut added = 0;
    for default in default_profiles() {
        if profiles.iter().any(|p| p.id == default.id) {
            continue;
        }
        let key_commands = default
            .key_commands
            .iter()
            .map(|(label, key_combo, trigger_key)| ExternalAppKeyCommand {
                id: uuid::Uuid::new_v4().to_string(),
                label: label.to_string(),
                key_combo: key_combo.to_string(),
                trigger_key: trigger_key.map(str::to_string),
            })
            .collect();
        profiles.push(ExternalAppProfile {
            id: default.id.to_string(),
            name: default.name.to_string(),
            kind: default.kind.to_string(),
            launch_mode: default.launch_mode.to_string(),
            parameter_format: Some(default.parameter_format.to_string()),
            remote_controls_enabled: default.remote_controls_enabled,
            key_commands,
            allowed_extensions: default
                .allowed_extensions
                .iter()
                .map(|s| s.to_string())
                .collect(),
            updated_at: now.to_string(),
            updated_by_device: device.to_string(),
        });
        added += 1;

        if let Some(executable_path) = default
            .candidate_executable_paths
            .iter()
            .find(|path| Path::new(path).exists())
        {
            implementations.push(ExternalAppImplementation {
                profile_id: default.id.to_string(),
                executable_path: executable_path.to_string(),
            });
        }
    }
    if added > 0 {
        write_json_file(profiles_path, &profiles)?;
        write_json_file(implementations_path, &implementations)?;
    }
    Ok(added)
}

/// Resolves a profile's parameter format (e.g. `/S "{file}"`) with the actual file
/// substituted in, then splits it into individual process arguments. A small hand-rolled
/// splitter rather than a shell-parsing crate — this only ever needs to respect
/// double-quoted segments (so a file path containing spaces stays one argument), not full
/// shell syntax (pipes, escapes, etc.).
pub fn build_args(parameter_format: &Option<String>, file: Option<&str>) -> Vec<String> {
    let Some(format) = parameter_format else {
        return Vec::new();
    };
    let resolved = format.replace("{file}", file.unwrap_or(""));
    split_args(&resolved)
}

fn split_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in input.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str) -> ExternalAppProfile {
        ExternalAppProfile {
            id: id.to_string(),
            name: name.to_string(),
            kind: "powerpoint".to_string(),
            launch_mode: "launch-automatically".to_string(),
            parameter_format: Some(r#"/S "{file}""#.to_string()),
            remote_controls_enabled: false,
            key_commands: Vec::new(),
            allowed_extensions: Vec::new(),
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-app-profiles.json");
        save(&path, sample("app-1", "PowerPoint"), "d", "now").unwrap();
        assert_eq!(list(&path).unwrap()[0].name, "PowerPoint");
    }

    #[test]
    fn save_updates_an_existing_profile_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-app-profiles.json");
        save(&path, sample("app-1", "PowerPoint"), "d", "now").unwrap();
        let mut updated = sample("app-1", "PowerPoint Renamed");
        updated.id = "app-1".to_string();
        save(&path, updated, "d", "now").unwrap();

        let all = list(&path).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "PowerPoint Renamed");
    }

    #[test]
    fn delete_removes_only_the_matching_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-app-profiles.json");
        save(&path, sample("app-1", "PowerPoint"), "d", "now").unwrap();
        save(&path, sample("app-2", "VLC"), "d", "now").unwrap();

        delete(&path, "app-1").unwrap();

        let all = list(&path).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "app-2");
    }

    #[test]
    fn list_returns_empty_for_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("does-not-exist.json"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn implementation_round_trips_and_updates_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");
        save_implementation(&path, "app-1", r"C:\PowerPoint.exe").unwrap();
        save_implementation(&path, "app-2", r"C:\vlc.exe").unwrap();
        save_implementation(&path, "app-1", r"D:\Apps\PowerPoint.exe").unwrap();

        let all = list_implementations(&path).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(
            get_implementation(&path, "app-1")
                .unwrap()
                .unwrap()
                .executable_path,
            r"D:\Apps\PowerPoint.exe"
        );
    }

    #[test]
    fn import_defaults_adds_every_default_on_a_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_path = dir.path().join("external-app-profiles.json");
        let implementations_path = dir.path().join("external-apps.json");

        let added = import_defaults(&profiles_path, &implementations_path, "d", "now").unwrap();

        assert_eq!(added, default_profiles().len() as u32);
        let all = list(&profiles_path).unwrap();
        assert_eq!(all.len(), default_profiles().len());
        for default in default_profiles() {
            let profile = all.iter().find(|p| p.id == default.id).unwrap();
            assert_eq!(profile.name, default.name);
            assert_eq!(profile.launch_mode, default.launch_mode);
            assert_eq!(profile.kind, default.kind);
        }
    }

    #[test]
    fn import_defaults_running_twice_never_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_path = dir.path().join("external-app-profiles.json");
        let implementations_path = dir.path().join("external-apps.json");

        import_defaults(&profiles_path, &implementations_path, "d", "now").unwrap();
        let added_second_time =
            import_defaults(&profiles_path, &implementations_path, "d", "now").unwrap();

        assert_eq!(added_second_time, 0);
        assert_eq!(
            list(&profiles_path).unwrap().len(),
            default_profiles().len()
        );
    }

    #[test]
    fn import_defaults_does_not_steal_a_default_id_already_edited_by_the_operator() {
        let dir = tempfile::tempdir().unwrap();
        let profiles_path = dir.path().join("external-app-profiles.json");
        let implementations_path = dir.path().join("external-apps.json");
        let mut renamed = sample("external-app-default-powerpoint", "My PowerPoint Setup");
        renamed.id = "external-app-default-powerpoint".to_string();
        save(&profiles_path, renamed, "d", "now").unwrap();

        import_defaults(&profiles_path, &implementations_path, "d", "now").unwrap();

        let all = list(&profiles_path).unwrap();
        let profile = all
            .iter()
            .find(|p| p.id == "external-app-default-powerpoint")
            .unwrap();
        assert_eq!(profile.name, "My PowerPoint Setup");
    }

    #[test]
    fn migrate_splits_a_legacy_flat_profile_into_shared_plus_implementation() {
        let dir = tempfile::tempdir().unwrap();
        let implementations_path = dir.path().join("external-apps.json");
        let profiles_path = dir.path().join("external-app-profiles.json");
        std::fs::write(
            &implementations_path,
            r#"[{"id":"app-1","name":"PowerPoint","launchMode":"launch-automatically","executablePath":"C:\\POWERPNT.EXE","parameterFormat":"/S \"{file}\"","remoteControlsEnabled":true,"keyCommands":[],"updatedAt":"then","updatedByDevice":"old-device"}]"#,
        )
        .unwrap();

        migrate_if_needed(&implementations_path, &profiles_path, "d", "now").unwrap();

        let profiles = list(&profiles_path).unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "PowerPoint");
        assert_eq!(profiles[0].kind, "custom");
        assert_eq!(profiles[0].updated_at, "then");

        let implementations = list_implementations(&implementations_path).unwrap();
        assert_eq!(implementations.len(), 1);
        assert_eq!(implementations[0].profile_id, "app-1");
        assert_eq!(implementations[0].executable_path, r"C:\POWERPNT.EXE");
    }

    #[test]
    fn migrate_is_a_one_time_no_op_once_the_marker_exists() {
        let dir = tempfile::tempdir().unwrap();
        let implementations_path = dir.path().join("external-apps.json");
        let profiles_path = dir.path().join("external-app-profiles.json");
        migrate_if_needed(&implementations_path, &profiles_path, "d", "now").unwrap();

        // Once the marker exists, a real implementation record in the new slim shape must never
        // be re-parsed as the old flat shape (it wouldn't satisfy LegacyExternalAppProfile's
        // required fields) — confirms the marker check really does happen before any read.
        save_implementation(&implementations_path, "app-1", r"C:\PowerPoint.exe").unwrap();
        migrate_if_needed(&implementations_path, &profiles_path, "d", "now").unwrap();

        assert!(list(&profiles_path).unwrap().is_empty());
        assert_eq!(
            list_implementations(&implementations_path).unwrap().len(),
            1
        );
    }

    #[test]
    fn build_args_substitutes_the_file_and_keeps_a_quoted_path_as_one_argument() {
        let format = Some(r#"/S "{file}""#.to_string());
        let args = build_args(&format, Some(r"C:\Services\Missions Update.pptx"));
        assert_eq!(
            args,
            vec![
                "/S".to_string(),
                r"C:\Services\Missions Update.pptx".to_string()
            ]
        );
    }

    #[test]
    fn build_args_returns_empty_with_no_parameter_format() {
        assert_eq!(build_args(&None, Some("file.pptx")), Vec::<String>::new());
    }

    #[test]
    fn build_args_handles_an_unset_file_by_leaving_the_placeholder_blank() {
        let format = Some("/S \"{file}\"".to_string());
        assert_eq!(build_args(&format, None), vec!["/S".to_string()]);
    }
}
