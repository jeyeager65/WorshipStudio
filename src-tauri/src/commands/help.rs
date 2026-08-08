use tauri::{AppHandle, Manager};

/// Navigates the already-open help window to a new URL — the one piece of "switch this
/// window's topic" that has no frontend equivalent (there's no JS-side `WebviewWindow.navigate`
/// API; `src/adapters/tauri/index.ts`'s `openHelp` creates the window itself via the ordinary
/// `new WebviewWindow(...)` call, same as the presentation/identify windows, and only reaches
/// here when one already exists to redirect). Returns whether a window was actually found and
/// navigated — the frontend falls back to creating a fresh one when this is `false`, since
/// `WebviewWindow.getByLabel('help')` finding a reference doesn't guarantee this command still
/// finds the same window moments later (a benign race, not worth surfacing as an error).
///
/// An earlier version of this command also *created* the window from Rust, to get real
/// `WebviewWindow::navigate`-based in-place switching from the start. That turned out
/// unreliable in practice — confirmed live, repeatedly, across several fixes (URL scheme
/// format, main-thread dispatch): a window built this way stayed on `about:blank` forever,
/// which was also what made it unresponsive to close. Every other secondary window in this
/// app is created from the frontend's own `new WebviewWindow(...)` instead, which is the one
/// path actually proven to load real content reliably — this command now only ever touches a
/// window that already exists and is already showing something real.
#[tauri::command]
pub fn navigate_help_window(app: AppHandle, url: String) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("help") else {
        return Ok(false);
    };
    let url: tauri::Url = url.parse().map_err(|error| format!("{error}"))?;
    window.navigate(url).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(true)
}
