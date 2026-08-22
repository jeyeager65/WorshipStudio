//! External App Hand-off's OS-level mechanics — bringing another already-running/launched
//! app's window to the foreground, remembering its position, and forwarding a keystroke to
//! it. Explicitly Windows-only (see design/feature-spec.md section 12); every function here
//! has a `#[cfg(not(windows))]` fallback that returns a clear error rather than being absent,
//! so callers (commands/external_apps.rs) don't need their own platform `cfg` branches.

use crate::models::WindowPosition;

#[cfg(windows)]
mod imp {
    use std::collections::HashSet;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        ROP_CODE, SRCCOPY,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindow,
        IsWindowVisible, PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow,
        HWND_NOTOPMOST, HWND_TOP, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
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

    /// Every currently visible, titled top-level window, keyed by its raw handle value — a
    /// snapshot taken just before spawning, so `find_new_window` can recognize a freshly
    /// launched app's window by "wasn't there a moment ago" (see that function's own doc
    /// comment for why that's needed at all).
    fn snapshot_visible_windows() -> HashSet<isize> {
        unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            unsafe {
                let set = &mut *(lparam.0 as *mut HashSet<isize>);
                if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
                    set.insert(hwnd.0 as isize);
                }
                true.into()
            }
        }
        let mut set = HashSet::new();
        unsafe {
            let _ = EnumWindows(
                Some(callback),
                LPARAM(&mut set as *mut HashSet<isize> as isize),
            );
        }
        set
    }

    /// Fallback for when the process we actually spawned never gets its own window — true for
    /// apps packaged as a Windows Store/UWP app (the modern Notepad included): the executable
    /// Worship Studio spawns is a launcher stub that hands off to, and then exits in favor of, a
    /// different host process, so no window ever belongs to `child.id()`. Finds the first
    /// visible, titled top-level window that wasn't present in an earlier snapshot instead.
    fn find_new_window(existing: &HashSet<isize>) -> Option<HWND> {
        struct SearchState {
            existing: HashSet<isize>,
            found: Option<HWND>,
        }
        unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            unsafe {
                let state = &mut *(lparam.0 as *mut SearchState);
                if IsWindowVisible(hwnd).as_bool()
                    && GetWindowTextLengthW(hwnd) > 0
                    && !state.existing.contains(&(hwnd.0 as isize))
                {
                    state.found = Some(hwnd);
                    return false.into();
                }
                true.into()
            }
        }
        let mut state = SearchState {
            existing: existing.clone(),
            found: None,
        };
        unsafe {
            let _ = EnumWindows(
                Some(callback),
                LPARAM(&mut state as *mut SearchState as isize),
            );
        }
        state.found
    }

    fn wait_for_window(
        pid: u32,
        existing_windows: &HashSet<isize>,
        timeout: Duration,
    ) -> Option<HWND> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Some(hwnd) = find_window_for_pid(pid) {
                return Some(hwnd);
            }
            if let Some(hwnd) = find_new_window(existing_windows) {
                return Some(hwnd);
            }
            thread::sleep(Duration::from_millis(150));
        }
        None
    }

    /// A normal top-level window's `GetWindowRect` includes an invisible DWM resize border
    /// outside its actually-visible frame (thickness varies with DPI/window style, so it can't
    /// be hard-coded) — left uncorrected, positioning a window to exactly the monitor's rect
    /// visibly falls short of the screen edges by that border's thickness. Compares the visible
    /// frame (`DWMWA_EXTENDED_FRAME_BOUNDS`) against the window rect just placed and returns a
    /// grown rect that pushes the invisible border off-monitor, or `None` if there's no
    /// discrepancy worth a second move (or the measurement failed — best-effort only).
    fn compensate_for_dwm_border(hwnd: HWND, target: &WindowPosition) -> Option<WindowPosition> {
        let mut window_rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut window_rect).ok()? };
        let mut visible_rect = RECT::default();
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut visible_rect as *mut RECT as *mut std::ffi::c_void,
                std::mem::size_of::<RECT>() as u32,
            )
            .ok()?
        };
        let left_pad = visible_rect.left - window_rect.left;
        let top_pad = visible_rect.top - window_rect.top;
        let right_pad = window_rect.right - visible_rect.right;
        let bottom_pad = window_rect.bottom - visible_rect.bottom;
        if left_pad == 0 && top_pad == 0 && right_pad == 0 && bottom_pad == 0 {
            return None;
        }
        Some(WindowPosition {
            monitor_id: target.monitor_id.clone(),
            x: target.x - left_pad,
            y: target.y - top_pad,
            width: target.width + left_pad + right_pad,
            height: target.height + top_pad + bottom_pad,
        })
    }

    /// Positions a window to exactly fill `position`, compensating for the invisible DWM border
    /// above, and forces it topmost — Windows only auto-hides the taskbar for windows it
    /// recognizes as truly fullscreen (e.g. exclusive-mode games or Tauri's own `fullscreen: true`
    /// presentation window), not for an arbitrary third-party window merely resized to the
    /// monitor's bounds, so this forces it above the taskbar's own always-on-top band instead of
    /// relying on that shell heuristic.
    fn set_position(hwnd: HWND, position: &WindowPosition) -> Result<(), String> {
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                position.x,
                position.y,
                position.width,
                position.height,
                SWP_SHOWWINDOW,
            )
            .map_err(|e| format!("Failed to position window: {e}"))?;
        }
        if let Some(adjusted) = compensate_for_dwm_border(hwnd, position) {
            unsafe {
                SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    adjusted.x,
                    adjusted.y,
                    adjusted.width,
                    adjusted.height,
                    SWP_NOACTIVATE,
                )
                .map_err(|e| format!("Failed to position window: {e}"))?;
            }
        }
        Ok(())
    }

    /// Shared trailer for every path that ends with a specific hwnd that should end up
    /// unminimized, positioned, and focused — a fresh spawn, an already-running process found by
    /// pid, or a cached hwnd from a previous engagement being reused.
    fn activate_and_position(hwnd: HWND, position: Option<&WindowPosition>) -> Result<(), String> {
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if let Some(position) = position {
            set_position(hwnd, position)?;
        }
        // Best-effort, not a hard failure: apps like PowerPoint juggle several windows of their
        // own right as a slide show starts (a loading window handing off to the real one, etc.),
        // and the first attempt sometimes loses the race against Windows' foreground-focus-
        // stealing prevention even though the window is already shown/positioned/topmost by this
        // point. Retried briefly since it's usually just that transient race, but even if every
        // attempt fails, this must still return Ok — the caller needs the real hwnd back either
        // way (see launch_and_focus/focus_process/reposition_existing) so it stays trackable for
        // Reopen/Close, rather than the whole engagement being silently forgotten over what's at
        // worst a minor "didn't grab keyboard focus" nicety.
        for attempt in 0..3 {
            if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
                break;
            }
            if attempt < 2 {
                thread::sleep(Duration::from_millis(150));
            }
        }
        Ok(())
    }

    pub fn launch_and_focus(
        executable: &str,
        args: &[String],
        position: Option<&WindowPosition>,
    ) -> Result<isize, String> {
        let existing_windows = snapshot_visible_windows();
        let child = Command::new(executable)
            .args(args)
            .spawn()
            .map_err(|e| format!("Failed to launch \"{executable}\": {e}"))?;

        let hwnd = wait_for_window(child.id(), &existing_windows, Duration::from_secs(5))
            .ok_or_else(|| {
                format!("\"{executable}\" launched but no window appeared within 5 seconds.")
            })?;

        activate_and_position(hwnd, position)?;
        Ok(hwnd.0 as isize)
    }

    /// Brings an already-running app's window (identified by its owning process id, from a
    /// previous `launch_and_focus`) back to the foreground — used for "Already Running" mode,
    /// where Worship Studio never launched it and so has no window handle cached from a spawn.
    /// Also repositions it when given a position, same as `launch_and_focus` — the point of
    /// automatically filling the Audience display doesn't stop applying just because the app
    /// happened to already be open.
    pub fn focus_process(pid: u32, position: Option<&WindowPosition>) -> Result<isize, String> {
        // Confirming the process is at least still alive gives a clearer error than a raw
        // Win32 failure when the operator never actually started the app.
        unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .map_err(|_| "That app doesn't appear to be running.".to_string())?;
        }
        let hwnd = find_window_for_pid(pid)
            .ok_or_else(|| "That app doesn't appear to have a visible window.".to_string())?;
        activate_and_position(hwnd, position)?;
        Ok(hwnd.0 as isize)
    }

    /// "Launch Now" (pre-launching an item's app before its slide goes live, so the cold-start
    /// delay happens ahead of time instead of live) — spawns and locates the window exactly like
    /// `launch_and_focus`, but deliberately never positions, foregrounds, or topmosts it: the
    /// operator asked for this app to be ready in the background, not put in front of whatever
    /// they're currently doing. Minimizing it keeps it out of the way in the meantime; the later
    /// real engagement (when its slide actually goes live) finds this same hwnd already cached
    /// and just repositions/foregrounds it via `reposition_existing`.
    pub fn launch_in_background(executable: &str, args: &[String]) -> Result<isize, String> {
        let existing_windows = snapshot_visible_windows();
        let child = Command::new(executable)
            .args(args)
            .spawn()
            .map_err(|e| format!("Failed to launch \"{executable}\": {e}"))?;

        let hwnd = wait_for_window(child.id(), &existing_windows, Duration::from_secs(5))
            .ok_or_else(|| {
                format!("\"{executable}\" launched but no window appeared within 5 seconds.")
            })?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        Ok(hwnd.0 as isize)
    }

    /// "Launch Now" for an "Already Running" profile — there's nothing to spawn (the operator
    /// starts these themselves), so pre-launching just means confirming it's actually running and
    /// noting its window so the real engagement later skips straight to `reposition_existing`.
    /// Doesn't touch the window at all, unlike `launch_in_background` — it's already in whatever
    /// state the operator left it, which is exactly right to leave alone.
    pub fn peek_window_for_pid(pid: u32) -> Option<isize> {
        find_window_for_pid(pid).map(|hwnd| hwnd.0 as isize)
    }

    /// Whether a cached hwnd from an earlier engagement is still worth reusing — the app may
    /// have been closed since Worship Studio last saw it, in which case this specific check is
    /// what routes the caller back to a normal (re-)launch instead of trying to reposition a
    /// handle that no longer refers to anything.
    pub fn is_window_alive(hwnd_value: isize) -> bool {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe { IsWindow(Some(hwnd)) }.as_bool()
    }

    /// Re-engages a hand-off app Worship Studio already knows about (see
    /// `commands::external_apps::EngagedExternalApp`'s `known` cache) instead of launching a
    /// second instance — un-minimizes, repositions/tops it back over the Audience display, and
    /// refocuses it, same end state as a fresh `launch_and_focus`, just without spawning
    /// anything. Callers must check `is_window_alive` first; this doesn't re-check.
    pub fn reposition_existing(hwnd_value: isize, position: &WindowPosition) -> Result<(), String> {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        activate_and_position(hwnd, Some(position))
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

    /// Brings a Worship Studio window (the presentation window, specifically) to the top of the
    /// z-order without stealing input focus from wherever the operator is currently clicking —
    /// `SetForegroundWindow` would also activate it, which would yank keyboard focus away from
    /// the operator's own window mid-click.
    pub fn bring_to_top_without_activating(hwnd_value: isize) -> Result<(), String> {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .map_err(|e| format!("Failed to restore the presentation window: {e}"))
        }
    }

    /// Undoes `set_position`'s `topmost` so a hand-off app that's been engaged, once the
    /// operator moves on, doesn't keep permanently covering everything on the Audience display —
    /// minimizing it (rather than just dropping the topmost flag) is what actually gets it out
    /// of the way visually, since otherwise it would just sit as an ordinary top-level window
    /// still directly over the presentation window's exact same bounds. Best-effort: the app may
    /// have already been closed by the time this runs, which isn't an error worth surfacing —
    /// Worship Studio getting its own display back is what matters here, not this cleanup step.
    pub fn restore_engaged_app(hwnd_value: isize) {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
    }

    /// Explicit close (Settings' operator-facing "Close App" control, and Stop Presenting
    /// closing everything it launched) — posts `WM_CLOSE`, the same message a window's own
    /// close button/titlebar X sends, rather than `TerminateProcess`, so an app with unsaved
    /// state gets the chance to prompt exactly as it would for a manual close. Best-effort: a
    /// no-op if the window's already gone.
    pub fn close_window(hwnd_value: isize) {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe {
            let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    fn key_name_to_vk(name: &str) -> Option<VIRTUAL_KEY> {
        let normalized = name.trim();
        let lower = normalized.to_lowercase().replace(' ', "");
        let vk = match lower.as_str() {
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
            "backspace" => 0x08,
            "delete" | "del" => 0x2E,
            "home" => 0x24,
            "end" => 0x23,
            _ => {
                // F1-F12 — capped there since no real keyboard/consumer software goes further,
                // and the capture UI (KeyComboField.vue, via keyCombo.ts) can never produce
                // anything past F12 anyway.
                if let Some(n) = lower
                    .strip_prefix('f')
                    .and_then(|rest| rest.parse::<u16>().ok())
                {
                    if (1..=12).contains(&n) {
                        return Some(VIRTUAL_KEY(0x70 + (n - 1)));
                    }
                }
                // A-Z/0-9 map directly to their ASCII (uppercase) value — how Win32 virtual-key
                // codes for those already work.
                let mut chars = normalized.chars();
                if let (Some(c), None) = (chars.next(), chars.next()) {
                    if c.is_ascii_alphanumeric() {
                        return Some(VIRTUAL_KEY(c.to_ascii_uppercase() as u16));
                    }
                }
                return None;
            }
        };
        Some(VIRTUAL_KEY(vk))
    }

    /// Splits a canonical combo string (`src/utils/keyCombo.ts`'s format — modifiers in fixed
    /// `Ctrl+Shift+Alt+` order, then the main key) into generic modifier virtual-keys plus the
    /// main one. Generic `VK_CONTROL`/`VK_SHIFT`/`VK_MENU`, not left/right-specific variants —
    /// "either side" is what every combo/accelerator convention expects.
    fn parse_key_combo(combo: &str) -> Option<(Vec<VIRTUAL_KEY>, VIRTUAL_KEY)> {
        let parts: Vec<&str> = combo
            .split('+')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .collect();
        let (modifier_parts, main_part) = parts.split_at(parts.len().checked_sub(1)?);
        let main_key = key_name_to_vk(main_part.first()?)?;
        let mut modifiers = Vec::with_capacity(modifier_parts.len());
        for part in modifier_parts {
            let vk = match part.to_lowercase().as_str() {
                "ctrl" | "control" => VIRTUAL_KEY(0x11),
                "shift" => VIRTUAL_KEY(0x10),
                "alt" => VIRTUAL_KEY(0x12),
                _ => return None,
            };
            modifiers.push(vk);
        }
        Some((modifiers, main_key))
    }

    /// `SendInput` has no per-window addressing — it always targets whatever window currently
    /// has OS keyboard focus. That's *not* reliably the external app by the time this fires:
    /// the trigger-key path only ever reaches here while Worship Studio's own window has focus
    /// (its keydown listener couldn't otherwise have seen the keypress at all), and the manual
    /// button path runs from a button the operator just clicked *inside* Worship Studio's own
    /// window, which independently steals focus back to it the moment it's clicked. Explicitly
    /// re-foregrounding the target hwnd first (same retry-based `activate_and_position` used by
    /// `launch_and_focus`/`focus_process`, just without repositioning) is what actually makes
    /// the keystroke land in the external app instead of Worship Studio itself.
    pub fn send_keystroke(hwnd_value: isize, combo: &str) -> Result<(), String> {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        activate_and_position(hwnd, None)?;
        let (modifiers, main_key) = parse_key_combo(combo)
            .ok_or_else(|| format!("\"{combo}\" isn't a recognized key combo."))?;
        let make_input = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
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
        // One single Vec, sent in one single SendInput call — modifiers down (in order), main
        // key down+up, modifiers up (reverse order). A single call is what guarantees Windows
        // won't interleave other input mid-combo; splitting this into one SendInput per key
        // would reopen exactly that race.
        let mut inputs = Vec::with_capacity(modifiers.len() * 2 + 2);
        for &modifier in &modifiers {
            inputs.push(make_input(modifier, KEYBD_EVENT_FLAGS(0)));
        }
        inputs.push(make_input(main_key, KEYBD_EVENT_FLAGS(0)));
        inputs.push(make_input(main_key, KEYEVENTF_KEYUP));
        for &modifier in modifiers.iter().rev() {
            inputs.push(make_input(modifier, KEYEVENTF_KEYUP));
        }
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

    /// Confidence-monitor-of-last-resort for the one case the remote's own mirror can't cover
    /// itself: while an External App Hand-off item is live, the real audience display is
    /// showing that app's window, not anything Worship Studio rendered, so there's no
    /// `LiveSlideContent` to push. This captures whatever's actually visible on the monitor at
    /// the presentation window's own position instead.
    ///
    /// Deliberately a screen capture (`BitBlt` from the desktop DC), not `PrintWindow` against
    /// the presentation window's own handle — `PrintWindow` asks a *specific window* to paint
    /// its own content into the destination regardless of what's currently covering it on
    /// screen, so targeting the presentation window's handle just reliably captured Worship
    /// Studio's own last-rendered frame (the previous slide) instead of the external app now
    /// on top of it — the exact opposite of the point. DWM has already composited the real
    /// desktop (GPU-accelerated windows included) before this ever reads from it, so a plain
    /// `BitBlt` from the screen is both correct and simpler than fighting `PrintWindow`'s own
    /// per-window semantics.
    pub fn capture_window_png(hwnd_value: isize) -> Result<Vec<u8>, String> {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        unsafe {
            // The presentation window is always borderless (no title bar/resize frame to
            // exclude), so its full window rect *is* its on-screen content area — this also
            // gives screen-relative coordinates directly, which GetClientRect doesn't (that's
            // window-relative), and BitBlt's source position below needs screen coordinates.
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())?;
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width <= 0 || height <= 0 {
                return Err(
                    "The presentation window has no visible content to capture.".to_string()
                );
            }

            // A null HWND targets the entire virtual desktop, not any one window — this is the
            // actual screen, whatever's currently topmost included.
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return Err("Could not get a device context for the screen.".to_string());
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
            let old_obj = SelectObject(mem_dc, bitmap.into());

            // CAPTUREBLT includes layered/WS_EX_LAYERED windows in the copy — without it some
            // overlay-style windows are silently skipped, showing whatever was behind them.
            const CAPTUREBLT: ROP_CODE = ROP_CODE(SRCCOPY.0 | 0x4000_0000);
            let captured = BitBlt(
                mem_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                rect.left,
                rect.top,
                CAPTUREBLT,
            )
            .is_ok();
            ReleaseDC(None, screen_dc);

            let mut bitmap_info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    // Negative height requests a top-down DIB — rows read out in the same
                    // top-to-bottom order `image::RgbaImage` expects, no manual flip needed.
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut buffer = vec![0u8; (width * height * 4) as usize];
            let lines_copied = GetDIBits(
                mem_dc,
                bitmap,
                0,
                height as u32,
                Some(buffer.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );

            SelectObject(mem_dc, old_obj);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(mem_dc);

            if !captured || lines_copied == 0 {
                return Err("Failed to capture the presentation window.".to_string());
            }

            // Windows hands back BGRA; `image` wants RGBA.
            for pixel in buffer.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }

            let image_buffer = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
                .ok_or_else(|| "Captured image data didn't match the expected size.".to_string())?;
            let mut png_bytes: Vec<u8> = Vec::new();
            image::DynamicImage::ImageRgba8(image_buffer)
                .write_to(
                    &mut std::io::Cursor::new(&mut png_bytes),
                    image::ImageFormat::Png,
                )
                .map_err(|e| e.to_string())?;
            Ok(png_bytes)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_a_plain_named_key() {
            let (modifiers, main) = parse_key_combo("Right").unwrap();
            assert!(modifiers.is_empty());
            assert_eq!(main.0, 0x27);
        }

        #[test]
        fn parses_an_f_key() {
            let (modifiers, main) = parse_key_combo("F5").unwrap();
            assert!(modifiers.is_empty());
            assert_eq!(main.0, 0x74);
        }

        #[test]
        fn rejects_f_keys_past_f12() {
            assert!(parse_key_combo("F13").is_none());
        }

        #[test]
        fn parses_a_single_letter() {
            let (modifiers, main) = parse_key_combo("s").unwrap();
            assert!(modifiers.is_empty());
            assert_eq!(main.0, 0x53);
        }

        #[test]
        fn parses_a_modifier_combo_in_fixed_order() {
            let (modifiers, main) = parse_key_combo("Ctrl+Shift+F5").unwrap();
            assert_eq!(
                modifiers.iter().map(|vk| vk.0).collect::<Vec<_>>(),
                vec![0x11, 0x10]
            );
            assert_eq!(main.0, 0x74);
        }

        #[test]
        fn rejects_an_unrecognized_combo() {
            assert!(parse_key_combo("Ctrl+NotAKey").is_none());
            assert!(parse_key_combo("").is_none());
        }
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
    ) -> Result<isize, String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn focus_process(_pid: u32, _position: Option<&WindowPosition>) -> Result<isize, String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn restore_self(_hwnd_value: isize) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn bring_to_top_without_activating(_hwnd_value: isize) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn restore_engaged_app(_hwnd_value: isize) {}
    pub fn is_window_alive(_hwnd_value: isize) -> bool {
        false
    }
    pub fn reposition_existing(
        _hwnd_value: isize,
        _position: &WindowPosition,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn close_window(_hwnd_value: isize) {}
    pub fn launch_in_background(_executable: &str, _args: &[String]) -> Result<isize, String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn peek_window_for_pid(_pid: u32) -> Option<isize> {
        None
    }
    pub fn send_keystroke(_hwnd_value: isize, _combo: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn find_running_process_id(_executable_name: &str) -> Option<u32> {
        None
    }
    pub fn capture_window_png(_hwnd_value: isize) -> Result<Vec<u8>, String> {
        Err(UNSUPPORTED.to_string())
    }
}

#[cfg(not(windows))]
pub use imp::*;
