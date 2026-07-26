use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::domain::{external_apps, win32};
use crate::models::{ExternalAppProfile, WindowPosition};
use crate::paths::{external_apps_path, now_iso, this_device_name};

#[tauri::command]
pub fn list_external_app_profiles(app: AppHandle) -> Result<Vec<ExternalAppProfile>, String> {
    Ok(external_apps::list(&external_apps_path(&app)))
}

#[tauri::command]
pub fn save_external_app_profile(
    app: AppHandle,
    profile: ExternalAppProfile,
) -> Result<(), String> {
    external_apps::save(
        &external_apps_path(&app),
        profile,
        &this_device_name(&app),
        &now_iso(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_external_app_profile(app: AppHandle, id: String) -> Result<(), String> {
    external_apps::delete(&external_apps_path(&app), &id).map_err(|e| e.to_string())
}

fn find_profile(app: &AppHandle, profile_id: &str) -> Result<ExternalAppProfile, String> {
    external_apps::list(&external_apps_path(app))
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "That external app profile no longer exists.".to_string())
}

/// Robustness-first, per feature-spec.md's principle for this feature: the executable (and,
/// if given, the chosen file) are checked to actually exist *before* attempting to launch —
/// caught during prep, not discovered mid-service.
fn verify_paths(profile: &ExternalAppProfile, file: Option<&str>) -> Result<String, String> {
    let executable = profile
        .executable_path
        .clone()
        .ok_or_else(|| "This profile has no executable configured.".to_string())?;
    if !std::path::Path::new(&executable).exists() {
        return Err(format!("Executable not found: {executable}"));
    }
    if let Some(file) = file {
        if !std::path::Path::new(file).exists() {
            return Err(format!("File not found: {file}"));
        }
    }
    Ok(executable)
}

#[tauri::command]
pub fn launch_external_app(
    app: AppHandle,
    profile_id: String,
    file: Option<String>,
) -> Result<(), String> {
    let profile = find_profile(&app, &profile_id)?;

    if profile.launch_mode == "already-running" {
        let executable_name = profile
            .executable_path
            .as_deref()
            .and_then(|p| std::path::Path::new(p).file_name())
            .and_then(|n| n.to_str())
            .ok_or_else(|| "This profile has no executable name to look for.".to_string())?;
        let pid = win32::find_running_process_id(executable_name).ok_or_else(|| {
            format!("{executable_name} doesn't appear to be open. Open it, then try again.")
        })?;
        return win32::focus_process(pid);
    }

    let executable = verify_paths(&profile, file.as_deref())?;
    let args = external_apps::build_args(&profile.parameter_format, file.as_deref());
    win32::launch_and_focus(&executable, &args, profile.window_position.as_ref())
}

#[tauri::command]
pub fn restore_self(window: tauri::WebviewWindow) -> Result<(), String> {
    let handle = window.window_handle().map_err(|e| e.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win32_handle) => win32::restore_self(win32_handle.hwnd.get()),
        _ => Err("External App Hand-off is only supported on Windows.".to_string()),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestLaunchResult {
    pub ok: bool,
    pub message: String,
}

/// Runs the same launch/focus/keystroke sequence a live service would, on demand from
/// Settings, without needing an actual file (see design/feature-spec.md: "so the whole setup
/// can be verified from Settings rather than discovered broken live").
#[tauri::command]
pub fn test_launch_external_app(
    app: AppHandle,
    profile_id: String,
) -> Result<TestLaunchResult, String> {
    let profile = match find_profile(&app, &profile_id) {
        Ok(profile) => profile,
        Err(e) => {
            return Ok(TestLaunchResult {
                ok: false,
                message: e,
            })
        }
    };

    let result = if profile.launch_mode == "already-running" {
        launch_external_app(app.clone(), profile_id.clone(), None)
    } else {
        match verify_paths(&profile, None) {
            Ok(executable) => {
                let args = external_apps::build_args(&profile.parameter_format, None);
                win32::launch_and_focus(&executable, &args, profile.window_position.as_ref())
            }
            Err(e) => Err(e),
        }
    };

    match result {
        Ok(()) => {
            if profile.remote_controls_enabled {
                if let Some(key) = &profile.next_key {
                    let _ = win32::send_keystroke(key);
                }
            }
            Ok(TestLaunchResult {
                ok: true,
                message: "Launched and brought to the foreground successfully.".to_string(),
            })
        }
        Err(message) => Ok(TestLaunchResult { ok: false, message }),
    }
}

#[tauri::command]
pub fn capture_external_app_window_position() -> Result<WindowPosition, String> {
    win32::capture_foreground_window_position()
}
