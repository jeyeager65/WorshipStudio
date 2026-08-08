import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import {
  BUFFER_SECONDS,
  CLICK_MOVE_MS,
  CLICK_SETTLE_MS,
  CLICK_HOLD_MS,
  CLICK_POST_MS,
  SLOW_CLICK_MOVE_MS,
  SLOW_CLICK_SETTLE_MS,
  SLOW_CLICK_HOLD_MS,
  SLOW_CLICK_POST_MS,
} from './timing.mjs'

// Proof-of-concept overview video — drives the real e2e-sandboxed app (never the operator's
// real library) while ffmpeg records the window, then mux.mjs overlays the narration
// generate-narration.mjs already produced. See notes/help-system-plan.md's "Proof of concept:
// automated overview video" section for the full design.

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const outDir = path.join(__dirname, 'out')

// A real, gliding cursor move + hover + click, instead of WebDriver's default instant/teleport
// click — makes the recording read as a person driving the app rather than a script. The
// timings (moveMs et al.) are shared constants (timing.mjs) so mux.mjs's narration/caption
// offsets stay in sync with however long this actually takes.
async function humanClick(
  elementOrSelector,
  { moveMs = CLICK_MOVE_MS, settleMs = CLICK_SETTLE_MS, holdMs = CLICK_HOLD_MS, postMs = CLICK_POST_MS } = {},
) {
  const el = typeof elementOrSelector === 'string' ? await $(elementOrSelector) : elementOrSelector
  await el.waitForExist({ timeout: 10000 })
  await el.waitForClickable({ timeout: 10000 })
  await browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ duration: moveMs, origin: el })
    .pause(settleMs)
    .down({ button: 0 })
    .pause(holdMs)
    .up({ button: 0 })
    .pause(postMs)
    .perform()
  return el
}

// Opening a specific service is the one moment viewers should be able to watch happen, not
// just glimpse — same shape as humanClick, every step held longer.
async function slowHumanClick(elementOrSelector) {
  return humanClick(elementOrSelector, {
    moveMs: SLOW_CLICK_MOVE_MS,
    settleMs: SLOW_CLICK_SETTLE_MS,
    holdMs: SLOW_CLICK_HOLD_MS,
    postMs: SLOW_CLICK_POST_MS,
  })
}

// WebDriver's setWindowRect uses OS logical/DPI-scaled coordinates, which don't reliably line
// up with the raw physical pixels ffmpeg's gdigrab captures on a scaled or multi-monitor
// desktop (the first attempt at this left the operator's other windows visible at the edges).
// Pinning the window with a DPI-aware native Win32 call instead guarantees it lands at the
// exact physical (0,0)-(1920,1080) region gdigrab reads, regardless of the operator's own
// monitor size/scaling/arrangement.
function pinWindowToTopLeft() {
  // Enumerates every top-level window rather than an exact FindWindow(title) match — the
  // latter came back empty against the running app (title text may not be set on the raw
  // HWND exactly the way the in-app custom title bar displays it), so this matches on any
  // window whose title contains "Worship Studio" instead, and logs every title it saw either
  // way to make the next failure diagnosable from the recording's own console output.
  //
  // A first MoveWindow(0,0,1920,1080) left a ~10px band of desktop visible on every edge —
  // Windows gives even borderless (decorations: false) windows an invisible resize-border/
  // drop-shadow margin outside their visible content, and plain GetWindowRect/MoveWindow work
  // in that *outer*, invisible-border-inclusive rect. DwmGetWindowAttribute's
  // DWMWA_EXTENDED_FRAME_BOUNDS reports the actual *visible* frame instead — measuring the gap
  // between the two and compensating lets the visible content land exactly at (0,0)-(1920,1080).
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public struct WsVideoRect { public int Left; public int Top; public int Right; public int Bottom; }
public class WsVideoWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out WsVideoRect lpRect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out WsVideoRect pvAttribute, int cbAttribute);
}
"@
[WsVideoWin32]::SetProcessDPIAware() | Out-Null
$target = [IntPtr]::Zero
$proc = [WsVideoWin32+EnumWindowsProc]{
  param($hWnd, $lParam)
  $sb = New-Object System.Text.StringBuilder 256
  [WsVideoWin32]::GetWindowText($hWnd, $sb, 256) | Out-Null
  $title = $sb.ToString()
  if ($title.Length -gt 0) { Write-Host "window: $title" }
  if ($title -like "*Worship Studio*") { $script:target = $hWnd }
  return $true
}
[WsVideoWin32]::EnumWindows($proc, [IntPtr]::Zero) | Out-Null
if ($target -eq [IntPtr]::Zero) { throw "Couldn't find a window titled 'Worship Studio' to position it." }
[WsVideoWin32]::ShowWindow($target, 9) | Out-Null

# Coarse pass — establishes a real geometry to measure the invisible-border insets from.
[WsVideoWin32]::MoveWindow($target, 0, 0, 1920, 1080, $true) | Out-Null

$DWMWA_EXTENDED_FRAME_BOUNDS = 9
$windowRect = New-Object WsVideoRect
$frameRect = New-Object WsVideoRect
[WsVideoWin32]::GetWindowRect($target, [ref]$windowRect) | Out-Null
[WsVideoWin32]::DwmGetWindowAttribute($target, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$frameRect, [Runtime.InteropServices.Marshal]::SizeOf([type][WsVideoRect])) | Out-Null

$leftInset = $frameRect.Left - $windowRect.Left
$topInset = $frameRect.Top - $windowRect.Top
$rightInset = $windowRect.Right - $frameRect.Right
$bottomInset = $windowRect.Bottom - $frameRect.Bottom
Write-Host "insets: left=$leftInset top=$topInset right=$rightInset bottom=$bottomInset"

# Corrected pass — offsets the outer (invisible-border-inclusive) rect so the *visible* frame
# ends up exactly at (0,0)-(1920,1080).
[WsVideoWin32]::MoveWindow($target, -$leftInset, -$topInset, 1920 + $leftInset + $rightInset, 1080 + $topInset + $bottomInset, $true) | Out-Null
[WsVideoWin32]::SetForegroundWindow($target) | Out-Null
`
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' })
}

const timings = JSON.parse(fs.readFileSync(path.join(outDir, 'narration', 'timings.json'), 'utf-8'))

async function pauseForBeat(id) {
  const beat = timings[id]
  if (!beat) {
    throw new Error(`No narration timing for beat "${id}" — run "node generate-narration.mjs" first.`)
  }
  await browser.pause(Math.round((beat.durationSeconds + BUFFER_SECONDS) * 1000))
}

describe('Overview video (recording, not a test)', () => {
  it('seeds sample data, then drives the app while ffmpeg records', async () => {
    // --- Seed real-looking content first, silently, before capture starts — same sequence
    // e2e/specs/settings-library-sync.spec.js already exercises. ---
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    const loadSampleBtn = await $('button*=Load Sample Data')
    await loadSampleBtn.waitForClickable({ timeout: 10000 })
    await loadSampleBtn.click()

    const confirmBtn = await $('button*=Delete Everything & Load Sample Data')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    const sampleSuccess = await $('div*=Sample songs, services, people, and themes added')
    await sampleSuccess.waitForExist({ timeout: 45000 })

    const addStockBtn = await $('button*=Add Stock Backgrounds')
    await addStockBtn.waitForClickable({ timeout: 10000 })
    await addStockBtn.click()

    const stockSuccess = await $('div*=already-present ones were skipped')
    await stockSuccess.waitForExist({ timeout: 20000 })

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()

    // Loading sample data leaves the settings document dirty (see
    // settings-library-sync.spec.js's identical comment) — handle the unsaved-changes guard
    // if it shows up.
    const saveAndLeaveBtn = await $('button*=Save & Leave')
    if (await saveAndLeaveBtn.waitForExist({ timeout: 3000 }).catch(() => false)) {
      await saveAndLeaveBtn.click()
    }

    const serviceCard = await $('.service-card')
    await serviceCard.waitForExist({ timeout: 10000 })

    // --- Start recording ---
    // gdigrab's window-title capture (`-i title=...`) BitBlts that specific HWND directly,
    // which frequently fails to reflect updates for GPU-composited Chromium/WebView2 windows
    // once they're occluded or not foreground — the first attempt at this recording froze on
    // whatever was on screen at start instead of showing the navigation. Pinning the window to
    // a known position and capturing that screen *region* instead reads the real DWM-composited
    // desktop image, which doesn't have that problem, while still producing an exact 1920x1080
    // video regardless of the operator's actual monitor size/resolution.
    pinWindowToTopLeft()

    fs.mkdirSync(outDir, { recursive: true })
    const capturePath = path.join(outDir, 'capture.mp4')
    fs.rmSync(capturePath, { force: true })
    // crf 0 ("true lossless") forces x264 into its High 4:4:4 Predictive profile even for
    // 4:2:0 content — that produced a file most ordinary players' H.264 decoders (including
    // whatever the operator was viewing this in) silently fail to decode at all, showing a
    // blank/white frame while the separately-decoded AAC audio played fine. crf 1 keeps x264 in
    // its normal, broadly-compatible High profile — still visually indistinguishable from
    // lossless at this content complexity, and comfortably real-time at "fast" for 1080p30
    // desktop-capture content (mostly static, occasional motion).
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-f',
        'gdigrab',
        '-framerate',
        '30',
        '-draw_mouse',
        '1',
        '-offset_x',
        '0',
        '-offset_y',
        '0',
        '-video_size',
        '1920x1080',
        '-i',
        'desktop',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '1',
        '-pix_fmt',
        'yuv420p',
        capturePath,
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    )
    // Give ffmpeg a moment to actually attach before the first beat starts.
    await browser.pause(1000)

    try {
      // Beat 1-2 — Services list, already populated by the seeding above. Two narration beats
      // on the same screen, no navigation.
      await pauseForBeat('01-intro')
      await pauseForBeat('02-intro2')

      // Beat 3 — Plan Ahead tab.
      await humanClick('.v-tab*=Plan Ahead')
      await pauseForBeat('03-plan-ahead')

      // Beat 4 — back to the Schedule tab.
      await humanClick('.v-tab*=Schedule')
      await pauseForBeat('04-schedule')

      // Beats 5-14 — a straight tour of every top-level library/settings area via the sidebar,
      // same idiom as the seeding sequence above.
      await humanClick('a[href="#/library/songs"]')
      await pauseForBeat('05-songs')

      await humanClick('a[href="#/library/slides"]')
      await pauseForBeat('06-slides')

      await humanClick('a[href="#/library/media"]')
      await pauseForBeat('07-media')

      await humanClick('a[href="#/library/themes"]')
      await pauseForBeat('08-themes')

      await humanClick('a[href="#/people"]')
      await pauseForBeat('09-people')

      await humanClick('a[href="#/roles"]')
      await pauseForBeat('10-roles')

      await humanClick('a[href="#/announcements"]')
      await pauseForBeat('11-announcements')

      await humanClick('a[href="#/library/service-templates"]')
      await pauseForBeat('12-templates')

      await humanClick('a[href="#/reports"]')
      await pauseForBeat('13-reports')

      await humanClick('a[href="#/settings"]')
      await pauseForBeat('14-settings')

      // Beat 15 — open a sample service's workspace (order of worship). Explicitly the slow,
      // deliberate click — this is the one action a viewer should be able to watch happen.
      await humanClick(servicesNav)
      const firstServiceCard = await $('.service-card')
      await slowHumanClick(firstServiceCard)
      await pauseForBeat('15-open-service')

      // Beat 16 — select an order-of-worship item to reveal its live preview panel. This stays
      // inside the single main window (no audience-display setup/second window needed, which
      // the e2e sandbox doesn't have configured) while still showing what "live" looks like.
      const firstItem = await $('.service-item')
      if (await firstItem.waitForExist({ timeout: 5000 }).catch(() => false)) {
        await humanClick(firstItem)
      }
      await pauseForBeat('16-live-preview')

      // Beat 17 — Assignments, reached from the service workspace's own top-bar link.
      await humanClick('a*=Assignments')
      await pauseForBeat('17-assignments')

      // Beat 18 — back to Services.
      await humanClick(servicesNav)
      await pauseForBeat('18-outro')
    } finally {
      ffmpeg.stdin.write('q')
      ffmpeg.stdin.end()
      await new Promise((resolve) => ffmpeg.once('close', resolve))
      console.log(`Recorded ${capturePath}`)
    }
  })
})
