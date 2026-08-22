use std::collections::HashMap;
use std::sync::Mutex;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Manager};

use crate::domain::{external_apps, win32};
use crate::models::{ExternalAppProfile, WindowPosition};
use crate::paths::{external_apps_path, now_iso, this_device_name};

/// Live-session hand-off state, scoped to Worship Studio's own process lifetime (never
/// persisted).
#[derive(Default)]
pub struct EngagedExternalApp {
    /// hwnd of whichever app `launch_external_app` most recently made topmost on the Audience
    /// display, if any — `restore_self` needs it to know which specific window to
    /// un-topmost/minimize when the operator advances past it.
    current: Mutex<Option<isize>>,
    /// Every hwnd successfully launched/focused this session, keyed by profile id + file, kept
    /// even after being minimized by `restore_self` — so navigating back to an item whose app is
    /// already running (just minimized) reuses that same window instead of spawning a second
    /// instance. Without this, re-engaging the same "launch automatically" item a second time
    /// would call `Command::spawn` again; many apps are single-instance and just hand off to the
    /// existing window and exit, so the freshly spawned process never gets a window of its own —
    /// `wait_for_window` times out and surfaces a false "no window appeared" error even though
    /// the app's own instance-handoff logic actually did bring its window back correctly.
    known: Mutex<HashMap<String, isize>>,
}

#[tauri::command]
pub fn list_external_app_profiles(app: AppHandle) -> Result<Vec<ExternalAppProfile>, String> {
    external_apps::list(&external_apps_path(&app)).map_err(|error| error.to_string())
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

#[tauri::command]
pub fn import_default_external_app_profiles(app: AppHandle) -> Result<u32, String> {
    external_apps::import_defaults(
        &external_apps_path(&app),
        &this_device_name(&app),
        &now_iso(),
    )
    .map_err(|e| e.to_string())
}

fn find_profile(app: &AppHandle, profile_id: &str) -> Result<ExternalAppProfile, String> {
    external_apps::list(&external_apps_path(app))
        .map_err(|error| error.to_string())?
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
    engaged: tauri::State<EngagedExternalApp>,
    profile_id: String,
    file: Option<String>,
    // The configured Audience display's current full bounds (see the Tauri adapter's
    // computeAudienceMonitorPhysicalBounds) — an external app always fills that display, full
    // screen, with no per-profile position to configure. The frontend itself refuses to call
    // this command when no Audience display is assigned (see the adapter's own check), so this
    // is never actually absent in practice — required rather than optional so that invariant is
    // visible here too.
    audience_bounds: WindowPosition,
) -> Result<(), String> {
    // Wrapped in an immediately-invoked closure so every early `?` return still funnels through
    // one place to log a failure -- this is a live-service action (advancing to an external-app
    // item), so a failure here is exactly the kind of thing worth having in the log afterward.
    // The already-cached-window reposition path deliberately isn't logged even on success: that
    // fires on every advance back to an already-open item, and success there is the unremarkable
    // common case, not something worth a log line each time.
    let result = (|| -> Result<(), String> {
        let profile = find_profile(&app, &profile_id)?;
        let cache_key = format!("{profile_id}|{}", file.as_deref().unwrap_or(""));

        let cached_hwnd = engaged.known.lock().unwrap().get(&cache_key).copied();
        if let Some(hwnd) = cached_hwnd {
            if win32::is_window_alive(hwnd) {
                win32::reposition_existing(hwnd, &audience_bounds)?;
                *engaged.current.lock().unwrap() = Some(hwnd);
                return Ok(());
            }
            // Closed since we last saw it — fall through and relaunch, but forget the stale
            // handle first so a second failure doesn't keep tripping this same check.
            engaged.known.lock().unwrap().remove(&cache_key);
        }

        let hwnd = if profile.launch_mode == "already-running" {
            let executable_name = profile
                .executable_path
                .as_deref()
                .and_then(|p| std::path::Path::new(p).file_name())
                .and_then(|n| n.to_str())
                .ok_or_else(|| "This profile has no process name to look for.".to_string())?;
            let pid = win32::find_running_process_id(executable_name).ok_or_else(|| {
                format!("{executable_name} doesn't appear to be open. Open it, then try again.")
            })?;
            win32::focus_process(pid, Some(&audience_bounds))?
        } else {
            let executable = verify_paths(&profile, file.as_deref())?;
            let args = external_apps::build_args(&profile.parameter_format, file.as_deref());
            win32::launch_and_focus(&executable, &args, Some(&audience_bounds))?
        };
        engaged.known.lock().unwrap().insert(cache_key, hwnd);
        *engaged.current.lock().unwrap() = Some(hwnd);
        Ok(())
    })();
    if let Err(error) = &result {
        log::warn!("Failed to launch external app profile \"{profile_id}\": {error}");
    }
    result
}

/// "Launch Now" — starts an item's app ahead of its slide going live, so the cold-start delay
/// (spawning, waiting for its window, possibly a single-instance handoff) happens ahead of time
/// instead of live. Deliberately doesn't touch `engaged.current` (that's reserved for whichever
/// app is actually topmost/live right now) — only `known`, so the later real engagement finds it
/// cached and reuses it via the same fast `reposition_existing` path a re-engaged item already
/// gets. A no-op if this item's app is already known and still alive.
#[tauri::command]
pub fn prelaunch_external_app(
    app: AppHandle,
    engaged: tauri::State<EngagedExternalApp>,
    profile_id: String,
    file: Option<String>,
) -> Result<(), String> {
    let profile = find_profile(&app, &profile_id)?;
    let cache_key = format!("{profile_id}|{}", file.as_deref().unwrap_or(""));

    let cached_hwnd = engaged.known.lock().unwrap().get(&cache_key).copied();
    if let Some(hwnd) = cached_hwnd {
        if win32::is_window_alive(hwnd) {
            return Ok(());
        }
        engaged.known.lock().unwrap().remove(&cache_key);
    }

    let hwnd = if profile.launch_mode == "already-running" {
        let executable_name = profile
            .executable_path
            .as_deref()
            .and_then(|p| std::path::Path::new(p).file_name())
            .and_then(|n| n.to_str())
            .ok_or_else(|| "This profile has no process name to look for.".to_string())?;
        let pid = win32::find_running_process_id(executable_name).ok_or_else(|| {
            format!("{executable_name} doesn't appear to be open. Open it, then try again.")
        })?;
        win32::peek_window_for_pid(pid)
            .ok_or_else(|| "That app doesn't appear to have a visible window.".to_string())?
    } else {
        let executable = verify_paths(&profile, file.as_deref())?;
        let args = external_apps::build_args(&profile.parameter_format, file.as_deref());
        win32::launch_in_background(&executable, &args)?
    };
    engaged.known.lock().unwrap().insert(cache_key, hwnd);
    Ok(())
}

/// Add-time verification (feature-spec.md's "robustness priority over convenience" — the
/// executable/file are checked when an item is *added to a service*, not only when its slide
/// is actually reached live). Deliberately doesn't launch anything.
#[tauri::command]
pub fn verify_external_app_item(
    app: AppHandle,
    profile_id: String,
    file: Option<String>,
) -> Result<(), String> {
    let profile = find_profile(&app, &profile_id)?;
    if profile.launch_mode == "already-running" {
        if profile.executable_path.as_deref().unwrap_or("").is_empty() {
            return Err("This profile has no process name configured.".to_string());
        }
        return Ok(());
    }
    verify_paths(&profile, file.as_deref())?;
    Ok(())
}

/// Basic Remote Controls (feature-spec.md section 12) — a named command's `key_combo` forwarded
/// as a keystroke to the external app's own window, whether triggered by its own button
/// (ServiceWorkspaceView's live-item panel, the phone Remote Control) or by a matching
/// `trigger_key` keypress on the operator's own keyboard (useExternalAppHandoff.ts's
/// `tryForwardKeydown` resolves which command id this is *before* calling here). Needs the
/// currently-engaged hwnd (not just the key combo) — see `win32::send_keystroke`'s own doc
/// comment for why: `SendInput` has no per-window addressing, and by the time this fires,
/// Worship Studio's own window is what actually has OS focus (either because its keydown
/// listener just saw the trigger key, or because the operator just clicked the button itself),
/// not the external app.
#[tauri::command]
pub fn send_external_app_keystroke(
    app: AppHandle,
    engaged: tauri::State<EngagedExternalApp>,
    profile_id: String,
    command_id: String,
) -> Result<(), String> {
    let profile = find_profile(&app, &profile_id)?;
    if !profile.remote_controls_enabled {
        return Err("Basic Remote Controls aren't enabled for this profile.".to_string());
    }
    let command = profile
        .key_commands
        .iter()
        .find(|c| c.id == command_id)
        .ok_or_else(|| "That command no longer exists on this profile.".to_string())?;
    if command.key_combo.trim().is_empty() {
        return Err(format!("No key is configured for \"{}\".", command.label));
    }
    let hwnd = engaged.current.lock().unwrap().ok_or_else(|| {
        "This app isn't currently engaged — its item must be live first.".to_string()
    })?;
    win32::send_keystroke(hwnd, &command.key_combo)
}

fn hwnd_of(window: &tauri::WebviewWindow) -> Result<isize, String> {
    match window.window_handle().map_err(|e| e.to_string())?.as_raw() {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get()),
        _ => Err("External App Hand-off is only supported on Windows.".to_string()),
    }
}

/// Called whenever the live slide stops being an External App Hand-off item (advancing past it,
/// or Stop Presenting) — the counterpart to `launch_external_app`'s topmost hand-off. Un-topmosts
/// and minimizes whichever app was engaged (if any — a no-op otherwise), then brings the
/// Audience-monitor presentation window back to the front without stealing the operator's own
/// input focus, and finally reasserts the operator's own (main) window as foreground for good
/// measure in case anything else ended up on top of it in the meantime.
#[tauri::command]
pub fn restore_self(
    app: AppHandle,
    window: tauri::WebviewWindow,
    engaged: tauri::State<EngagedExternalApp>,
) -> Result<(), String> {
    if let Some(hwnd) = engaged.current.lock().unwrap().take() {
        win32::restore_engaged_app(hwnd);
    }
    if let Some(presentation) = app.get_webview_window("presentation") {
        win32::bring_to_top_without_activating(hwnd_of(&presentation)?)?;
    }
    win32::restore_self(hwnd_of(&window)?)
}

/// Operator-triggered ("Close App" in the transport bar) — closes just the currently-engaged
/// app and forgets it, so a later re-engagement of the same item relaunches fresh rather than
/// trying to reuse a handle the operator deliberately closed. A no-op if nothing's engaged.
#[tauri::command]
pub fn close_current_external_app(engaged: tauri::State<EngagedExternalApp>) -> Result<(), String> {
    if let Some(hwnd) = engaged.current.lock().unwrap().take() {
        win32::close_window(hwnd);
        engaged
            .known
            .lock()
            .unwrap()
            .retain(|_, known_hwnd| *known_hwnd != hwnd);
    }
    Ok(())
}

/// Stop Presenting's counterpart to `restore_self` — rather than just minimizing the most
/// recently engaged app, this is the point where every External App Hand-off window launched
/// this session (there could be more than one, across different items) actually gets closed,
/// not merely tucked out of the way, per feature-spec.md: presenting stopping should leave
/// nothing behind for the operator to clean up by hand.
#[tauri::command]
pub fn close_all_external_apps(
    app: AppHandle,
    window: tauri::WebviewWindow,
    engaged: tauri::State<EngagedExternalApp>,
) -> Result<(), String> {
    *engaged.current.lock().unwrap() = None;
    let hwnds: Vec<isize> = engaged
        .known
        .lock()
        .unwrap()
        .drain()
        .map(|(_, hwnd)| hwnd)
        .collect();
    for hwnd in hwnds {
        win32::close_window(hwnd);
    }
    if let Some(presentation) = app.get_webview_window("presentation") {
        win32::bring_to_top_without_activating(hwnd_of(&presentation)?)?;
    }
    win32::restore_self(hwnd_of(&window)?)
}
