use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::domain::sync;
use crate::paths::{is_portable, library_root, load_machine_settings, now_iso};

const MAX_BUNDLED_LOG_BYTES: usize = 250_000;

static SENSITIVE_LOG_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(authorization|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|api[_ -]?key|[?&]code)(\s*[:=]\s*)([^&\s]+)",
    )
    .expect("diagnostic redaction pattern must compile")
});

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItemCounts {
    songs: usize,
    services: usize,
    slides: usize,
    media: usize,
    themes: usize,
    people: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    generated_at: String,
    app_version: String,
    build_profile: &'static str,
    platform: &'static str,
    architecture: &'static str,
    installation_mode: &'static str,
    setup_complete: bool,
    library_readable: bool,
    library_items: LibraryItemCounts,
    last_library_change_at: Option<String>,
    sync_conflict_count: usize,
    recovery_issue_count: usize,
    display_assignment_count: usize,
    remote_port_mode: &'static str,
    last_remote_port: Option<u16>,
    canva_callback_port: Option<u16>,
    log_file_count: usize,
    log_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticLog {
    file_name: String,
    truncated: bool,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundle {
    privacy_notice: &'static str,
    summary: DiagnosticSummary,
    logs: Vec<DiagnosticLog>,
}

fn count_json_files(path: &Path) -> usize {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return 0;
            };
            if file_type.is_symlink() {
                0
            } else if file_type.is_dir() {
                count_json_files(&entry.path())
            } else {
                usize::from(
                    entry.path().extension().and_then(|value| value.to_str()) == Some("json"),
                )
            }
        })
        .sum()
}

fn log_files(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    let app_name = &app.package_info().name;
    let mut files = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file()
                        && path.extension().and_then(|value| value.to_str()) == Some("log")
                        && path
                            .file_name()
                            .is_some_and(|name| name.to_string_lossy().starts_with(app_name))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    files.sort();
    Ok(files)
}

fn redact_log(contents: &str) -> String {
    let mut sanitized = SENSITIVE_LOG_VALUE
        .replace_all(contents, "$1$2[REDACTED]")
        .into_owned();
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
        sanitized = sanitized.replace(&profile.to_string_lossy().to_string(), "%USERPROFILE%");
    }
    if let Some(home) = std::env::var_os("HOME").filter(|value| !value.is_empty()) {
        sanitized = sanitized.replace(&home.to_string_lossy().to_string(), "$HOME");
    }
    sanitized
}

fn bundled_log(path: &Path) -> Option<DiagnosticLog> {
    let bytes = fs::read(path).ok()?;
    let truncated = bytes.len() > MAX_BUNDLED_LOG_BYTES;
    let start = bytes.len().saturating_sub(MAX_BUNDLED_LOG_BYTES);
    let contents = String::from_utf8_lossy(&bytes[start..]);
    Some(DiagnosticLog {
        file_name: path.file_name()?.to_string_lossy().to_string(),
        truncated,
        contents: redact_log(&contents),
    })
}

fn diagnostic_summary(app: &AppHandle) -> DiagnosticSummary {
    let settings = load_machine_settings(app);
    let root = library_root(app);
    let sync_status = sync::get_status(&root).ok();
    let files = log_files(app).unwrap_or_default();
    let log_bytes = files
        .iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .sum();

    DiagnosticSummary {
        generated_at: now_iso(),
        app_version: app.package_info().version.to_string(),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        installation_mode: if is_portable(app) {
            "portable"
        } else {
            "installed"
        },
        setup_complete: settings.has_completed_setup,
        library_readable: sync_status
            .as_ref()
            .is_some_and(|status| status.folder_readable),
        library_items: LibraryItemCounts {
            songs: count_json_files(&root.join("songs")),
            services: count_json_files(&root.join("services")),
            slides: count_json_files(&root.join("slides")),
            media: count_json_files(&root.join("media-items")),
            themes: count_json_files(&root.join("themes")),
            people: count_json_files(&root.join("people")),
        },
        last_library_change_at: sync_status
            .as_ref()
            .and_then(|status| status.last_library_change_at.clone()),
        sync_conflict_count: sync_status
            .as_ref()
            .map_or(0, |status| status.conflict_count),
        recovery_issue_count: sync_status
            .as_ref()
            .map_or(0, |status| status.recovery_count),
        display_assignment_count: settings.display_roles.len(),
        remote_port_mode: if settings.remote_control_port.is_some() {
            "configured"
        } else {
            "automatic"
        },
        last_remote_port: settings.last_remote_control_port,
        canva_callback_port: settings.canva_callback_port,
        log_file_count: files.len(),
        log_bytes,
    }
}

#[tauri::command]
pub fn get_diagnostic_summary(app: AppHandle) -> DiagnosticSummary {
    diagnostic_summary(&app)
}

#[tauri::command]
pub fn create_diagnostic_bundle(app: AppHandle) -> Result<String, String> {
    let logs = log_files(&app)?
        .iter()
        .filter_map(|path| bundled_log(path))
        .collect();
    serde_json::to_string_pretty(&DiagnosticBundle {
        privacy_notice: "Allowlisted operational data only. Settings files, library content, credentials, authorization tokens, and personal records are excluded. Log excerpts are size-limited and redacted.",
        summary: diagnostic_summary(&app),
        logs,
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_and_user_profile_paths() {
        let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Operator".into());
        let input = format!(
            "api_key=secret-value access-token: bearer-value callback?code=oauth-code file={profile}\\Logs"
        );
        let redacted = redact_log(&input);
        assert!(!redacted.contains("secret-value"));
        assert!(!redacted.contains("bearer-value"));
        assert!(!redacted.contains("oauth-code"));
        if std::env::var_os("USERPROFILE").is_some() {
            assert!(!redacted.contains(&profile));
        }
    }

    #[test]
    fn counts_only_json_files_recursively() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("2026")).unwrap();
        fs::write(dir.path().join("one.json"), "{}").unwrap();
        fs::write(dir.path().join("2026/two.json"), "{}").unwrap();
        fs::write(dir.path().join("ignore.txt"), "ignored").unwrap();
        assert_eq!(count_json_files(dir.path()), 2);
    }
}
