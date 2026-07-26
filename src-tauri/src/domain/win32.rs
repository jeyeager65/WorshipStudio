//! External App Hand-off's OS-level mechanics — bringing another already-running/launched
//! app's window to the foreground, remembering its position, and forwarding a keystroke to
//! it. Explicitly Windows-only (see design/feature-spec.md section 12); every function here
//! has a `#[cfg(not(windows))]` fallback that returns a clear error rather than being absent,
//! so callers (commands/external_apps.rs) don't need their own platform `cfg` branches.

use crate::models::WindowPosition;

#[cfg(windows)]
mod imp {
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        SetForegroundWindow, SetWindowPos, ShowWindow, SWP_NOZORDER, SW_RESTORE,
    };

    use super::*;

    /// Enumerates top-level windows looking for one owned by `pid` — a freshly spawned
    /// process's main window doesn't exist the instant `Command::spawn` returns, so this is
    /// polled for a few seconds rather than checked once.
    fn find_window_for_pid(pid: u32) -> Option<HWND> {
        struct SearchState {
            pid: u32,
            found: Option<HWND>,
        }
        unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            unsafe {
                let state = &mut *(lparam.0 as *mut SearchState);
                let mut window_pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
                if window_pid == state.pid && IsWindowVisible(hwnd).as_bool() {
                    state.found = Some(hwnd);
                    return false.into();
                }
                true.into()
            }
        }

        let mut state = SearchState { pid, found: None };
        unsafe {
            let _ = EnumWindows(
                Some(callback),
                LPARAM(&mut state as *mut SearchState as isize),
            );
        }
        state.found
    }

    fn wait_for_window(pid: u32, timeout: Duration) -> Option<HWND> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Some(hwnd) = find_window_for_pid(pid) {
                return Some(hwnd);
            }
            thread::sleep(Duration::from_millis(150));
        }
        None
    }

    fn monitor_name(hwnd: HWND) -> String {
        unsafe {
            let monitor: HMONITOR = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            if GetMonitorInfoW(monitor, &mut info as *mut _ as *mut _).as_bool() {
                String::from_utf16_lossy(&info.szDevice)
                    .trim_end_matches('\0')
                    .to_string()
            } else {
                "Unknown".to_string()
            }
        }
    }

    fn set_position(hwnd: HWND, position: &WindowPosition) -> Result<(), String> {
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                position.x,
                position.y,
                position.width,
                position.height,
                SWP_NOZORDER,
            )
            .map_err(|e| format!("Failed to position window: {e}"))
        }
    }

    pub fn launch_and_focus(
        executable: &str,
        args: &[String],
        position: Option<&WindowPosition>,
    ) -> Result<(), String> {
        let child = Command::new(executable)
            .args(args)
            .spawn()
            .map_err(|e| format!("Failed to launch \"{executable}\": {e}"))?;

        let hwnd = wait_for_window(child.id(), Duration::from_secs(5)).ok_or_else(|| {
            format!("\"{executable}\" launched but no window appeared within 5 seconds.")
        })?;

        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if let Some(position) = position {
            set_position(hwnd, position)?;
        }
        unsafe {
            SetForegroundWindow(hwnd)
                .as_bool()
                .then_some(())
                .ok_or_else(|| {
                    "Windows declined the request to bring the app's window to the foreground."
                        .to_string()
                })
        }
    }

    /// Brings an already-running app's window (identified by its owning process id, from a
    /// previous `launch_and_focus`) back to the foreground — used for "Already Running" mode,
    /// where Worship Studio never launched it and so has no window handle cached from a spawn.
    pub fn focus_process(pid: u32) -> Result<(), String> {
        // Confirming the process is at least still alive gives a clearer error than a raw
        // Win32 failure when the operator never actually started the app.
        unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .map_err(|_| "That app doesn't appear to be running.".to_string())?;
        }
        let hwnd = find_window_for_pid(pid)
            .ok_or_else(|| "That app doesn't appear to have a visible window.".to_string())?;
        unsafe {
            SetForegroundWindow(hwnd)
                .as_bool()
                .then_some(())
                .ok_or_else(|| {
                    "Windows declined the request to bring the app's window to the foreground."
                        .to_string()
                })
        }
    }

    pub fn restore_self(hwnd_value: isize) -> Result<(), String> {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe {
            SetForegroundWindow(hwnd)
                .as_bool()
                .then_some(())
                .ok_or_else(|| {
                    "Windows declined the request to restore Worship Studio to the foreground."
                        .to_string()
                })
        }
    }

    pub fn capture_foreground_window_position() -> Result<WindowPosition, String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return Err(
                    "No foreground window to capture — bring the target app to the front first."
                        .to_string(),
                );
            }
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect)
                .map_err(|e| format!("Failed to read the window's position: {e}"))?;
            Ok(WindowPosition {
                monitor_id: monitor_name(hwnd),
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
            })
        }
    }

    fn key_name_to_vk(name: &str) -> Option<VIRTUAL_KEY> {
        // Covers the handful of keys the sketch's "Basic Remote Controls" fields realistically
        // need (arrow keys for Next/Prev) plus a few common extras — not a full keyboard map.
        let vk = match name.to_lowercase().replace(' ', "").as_str() {
            "rightarrow" | "right" => 0x27,
            "leftarrow" | "left" => 0x25,
            "uparrow" | "up" => 0x26,
            "downarrow" | "down" => 0x28,
            "space" | "spacebar" => 0x20,
            "enter" | "return" => 0x0D,
            "escape" | "esc" => 0x1B,
            "pageup" => 0x21,
            "pagedown" => 0x22,
            "tab" => 0x09,
            "f5" => 0x74,
            _ => return None,
        };
        Some(VIRTUAL_KEY(vk))
    }

    pub fn send_keystroke(key_name: &str) -> Result<(), String> {
        let vk = key_name_to_vk(key_name)
            .ok_or_else(|| format!("\"{key_name}\" isn't a recognized key name."))?;
        let make_input = |flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [
            make_input(KEYBD_EVENT_FLAGS(0)),
            make_input(KEYEVENTF_KEYUP),
        ];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err("Windows didn't accept the simulated keystroke.".to_string())
        }
    }

    /// Used by commands::external_apps to check "already running" mode without launching a
    /// second copy — best-effort by executable name only (no argument matching).
    pub fn find_running_process_id(executable_name: &str) -> Option<u32> {
        // Kept intentionally simple: shells out to `tasklist` rather than the heavier
        // ToolHelp32 snapshot APIs, matching the existing (Sync Status) approach of
        // process-checking via a subprocess rather than raw enumeration APIs.
        let output = Command::new("tasklist")
            .args([
                "/FI",
                &format!("IMAGENAME eq {executable_name}"),
                "/NH",
                "/FO",
                "CSV",
            ])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text.lines().find(|line| line.contains(executable_name))?;
        let pid_field = line.split(',').nth(1)?;
        pid_field.trim_matches('"').parse().ok()
    }
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
mod imp {
    use super::*;

    const UNSUPPORTED: &str = "External App Hand-off is only supported on Windows.";

    pub fn launch_and_focus(
        _executable: &str,
        _args: &[String],
        _position: Option<&WindowPosition>,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn focus_process(_pid: u32) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn restore_self(_hwnd_value: isize) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn capture_foreground_window_position() -> Result<WindowPosition, String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn send_keystroke(_key_name: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn find_running_process_id(_executable_name: &str) -> Option<u32> {
        None
    }
}

#[cfg(not(windows))]
pub use imp::*;
