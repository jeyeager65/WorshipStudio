use std::path::Path;

use crate::models::ExternalAppProfile;

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
            next_key: None,
            prev_key: None,
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
