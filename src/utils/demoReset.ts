/**
 * Carries "the demo was just reset" across the reload that performs it.
 *
 * Resetting clears the demo's stored data and reloads, because the adapter and every store were
 * built from the old data and hold it in memory (see DemoIntroDialog). That happens fast enough to
 * look like nothing but a blink — and the intro dialog, which opens on every demo launch, comes
 * straight back looking exactly as it did. The reset worked, but nothing on screen says so.
 *
 * A flag set before the reload and read once after it is the only way to tell the two loads apart:
 * everything else about them is identical by design. The reader keeps the intro dialog shut (the
 * visitor read it a moment ago and asked for current data, not for the introduction again) and
 * confirms the reset instead.
 *
 * sessionStorage rather than localStorage: this belongs to one tab's reload, not to the browser
 * profile, and it should not survive the tab being closed. Both calls tolerate storage being
 * unavailable — a blocked accessor throws on read as well as write — since a missing confirmation
 * is a far better outcome than a demo that will not open.
 */
const DEMO_RESET_FLAG = 'worship-studio:demo-reset'

/** Called immediately before the reload that clears the demo's data. */
export function markDemoReset(): void {
  try {
    sessionStorage.setItem(DEMO_RESET_FLAG, '1')
  } catch {
    // Confirmation is a nicety; losing it must never block the reset itself.
  }
}

/** Reads the flag and clears it, so a later plain reload is not mistaken for another reset. */
export function consumeDemoReset(): boolean {
  try {
    if (sessionStorage.getItem(DEMO_RESET_FLAG) === null) return false
    sessionStorage.removeItem(DEMO_RESET_FLAG)
    return true
  } catch {
    return false
  }
}
