use std::path::Path;

use crate::models::{ExternalAppKeyCommand, ExternalAppProfile};

use super::{read_json_file, write_json_file};

/// Whole-list-in-one-file rather than one-file-per-profile (unlike songs/slides/etc.) — a
/// church realistically has a handful of these at most, and unlike synced library content,
/// there's no Dropbox-conflict concern to keep per-item files scoped around.
pub fn list(external_apps_path: &Path) -> std::io::Result<Vec<ExternalAppProfile>> {
    Ok(read_json_file(external_apps_path)?.unwrap_or_default())
}

pub fn save(
    external_apps_path: &Path,
    mut profile: ExternalAppProfile,
    device: &str,
    now: &str,
) -> std::io::Result<ExternalAppProfile> {
    profile.updated_at = now.to_string();
    profile.updated_by_device = device.to_string();
    let mut all = list(external_apps_path)?;
    match all.iter().position(|p| p.id == profile.id) {
        Some(index) => all[index] = profile.clone(),
        None => all.push(profile.clone()),
    }
    write_json_file(external_apps_path, &all)?;
    Ok(profile)
}

pub fn delete(external_apps_path: &Path, id: &str) -> std::io::Result<()> {
    let mut all = list(external_apps_path)?;
    all.retain(|p| p.id != id);
    write_json_file(external_apps_path, &all)
}

/// A starter profile for a common presentation-adjacent app — not a full `ExternalAppProfile`
/// since `executable_path` is machine-specific (install location varies by machine/bitness/Office
/// version) and gets probed for at import time instead of hardcoded. Add more entries to
/// `default_profiles` below as new apps come up; nothing else needs to change to pick them up.
pub struct DefaultExternalAppProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub launch_mode: &'static str,
    pub parameter_format: &'static str,
    /// Checked in order at import time; the first one that exists on this machine becomes the
    /// seeded profile's `executable_path`. None found just leaves it blank — still a real,
    /// useful starter profile with the right launch mode/parameters/remote keys already filled
    /// in, the operator only has to Browse to their actual install once.
    pub candidate_executable_paths: &'static [&'static str],
    pub remote_controls_enabled: bool,
    /// `(label, key_combo, trigger_key)` for each starter command — see
    /// `ExternalAppKeyCommand`'s own doc comment for what these mean. Not reserved/special in
    /// any way; the operator can rename, rebind, or delete them like any other command.
    pub key_commands: &'static [(&'static str, &'static str, Option<&'static str>)],
}

pub fn default_profiles() -> &'static [DefaultExternalAppProfile] {
    &[
        DefaultExternalAppProfile {
            id: "external-app-default-powerpoint",
            name: "PowerPoint",
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
        },
        DefaultExternalAppProfile {
            id: "external-app-default-vlc",
            name: "VLC",
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
        },
    ]
}

/// Adds every default profile not already present (matched by id, same idempotency convention as
/// `stock_content::import` — safe to invoke repeatedly, e.g. from a "Add Suggested Profiles"
/// button, without duplicating anything already added or edited). Returns how many were added.
pub fn import_defaults(external_apps_path: &Path, device: &str, now: &str) -> std::io::Result<u32> {
    let mut all = list(external_apps_path)?;
    let mut added = 0;
    for default in default_profiles() {
        if all.iter().any(|p| p.id == default.id) {
            continue;
        }
        let executable_path = default
            .candidate_executable_paths
            .iter()
            .find(|path| Path::new(path).exists())
            .map(|path| path.to_string());
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
        all.push(ExternalAppProfile {
            id: default.id.to_string(),
            name: default.name.to_string(),
            launch_mode: default.launch_mode.to_string(),
            executable_path,
            parameter_format: Some(default.parameter_format.to_string()),
            remote_controls_enabled: default.remote_controls_enabled,
            key_commands,
            updated_at: now.to_string(),
            updated_by_device: device.to_string(),
        });
        added += 1;
    }
    if added > 0 {
        write_json_file(external_apps_path, &all)?;
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
            launch_mode: "launch-automatically".to_string(),
            executable_path: Some(
                r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE".to_string(),
            ),
            parameter_format: Some(r#"/S "{file}""#.to_string()),
            remote_controls_enabled: false,
            key_commands: Vec::new(),
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");
        save(&path, sample("app-1", "PowerPoint"), "d", "now").unwrap();
        assert_eq!(list(&path).unwrap()[0].name, "PowerPoint");
    }

    #[test]
    fn save_updates_an_existing_profile_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");
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
        let path = dir.path().join("external-apps.json");
        save(&path, sample("app-1", "PowerPoint"), "d", "now").unwrap();
        save(&path, sample("app-2", "VLC"), "d", "now").unwrap();

        delete(&path, "app-1").unwrap();

        let all = list(&path).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "app-2");
    }

    #[test]
    fn import_defaults_adds_every_default_on_a_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");

        let added = import_defaults(&path, "d", "now").unwrap();

        assert_eq!(added, default_profiles().len() as u32);
        let all = list(&path).unwrap();
        assert_eq!(all.len(), default_profiles().len());
        for default in default_profiles() {
            let profile = all.iter().find(|p| p.id == default.id).unwrap();
            assert_eq!(profile.name, default.name);
            assert_eq!(profile.launch_mode, default.launch_mode);
        }
    }

    #[test]
    fn import_defaults_running_twice_never_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");

        import_defaults(&path, "d", "now").unwrap();
        let added_second_time = import_defaults(&path, "d", "now").unwrap();

        assert_eq!(added_second_time, 0);
        assert_eq!(list(&path).unwrap().len(), default_profiles().len());
    }

    #[test]
    fn import_defaults_does_not_steal_a_default_id_already_edited_by_the_operator() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("external-apps.json");
        let mut renamed = sample("external-app-default-powerpoint", "My PowerPoint Setup");
        renamed.id = "external-app-default-powerpoint".to_string();
        save(&path, renamed, "d", "now").unwrap();

        import_defaults(&path, "d", "now").unwrap();

        let all = list(&path).unwrap();
        let profile = all
            .iter()
            .find(|p| p.id == "external-app-default-powerpoint")
            .unwrap();
        assert_eq!(profile.name, "My PowerPoint Setup");
    }

    #[test]
    fn list_returns_empty_for_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("does-not-exist.json"))
            .unwrap()
            .is_empty());
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
