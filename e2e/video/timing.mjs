// Shared timing constants for the overview-video proof of concept — one source of truth so
// overview.record.js's actual pacing and mux.mjs's audio/caption offset math never drift apart.
// See notes/help-system-plan.md's "Proof of concept: automated overview video" section.

export const LEAD_IN_SECONDS = 1 // matches the browser.pause(1000) before beat 1 (let ffmpeg attach)
export const BUFFER_SECONDS = 0.8 // silence after each beat's narration before the next one starts

// A human-like pointer move+click's fixed real-world duration. WebDriver's action `duration` is
// interpolation *time*, not speed, so this is deterministic regardless of how far the cursor
// has to travel — safe to treat as a constant both scripts can rely on.
export const CLICK_MOVE_MS = 500
export const CLICK_SETTLE_MS = 150 // brief hover/"deciding" pause before pressing down
export const CLICK_HOLD_MS = 70 // time between mousedown and mouseup
export const CLICK_POST_MS = 150 // brief pause after the click before moving on
export const CLICK_SECONDS = (CLICK_MOVE_MS + CLICK_SETTLE_MS + CLICK_HOLD_MS + CLICK_POST_MS) / 1000

// Opening a specific service is called out explicitly as the one moment viewers should be able
// to watch happen, not just glimpse — same shape, longer every step.
export const SLOW_CLICK_MOVE_MS = 900
export const SLOW_CLICK_SETTLE_MS = 350
export const SLOW_CLICK_HOLD_MS = 90
export const SLOW_CLICK_POST_MS = 350
export const SLOW_CLICK_SECONDS =
  (SLOW_CLICK_MOVE_MS + SLOW_CLICK_SETTLE_MS + SLOW_CLICK_HOLD_MS + SLOW_CLICK_POST_MS) / 1000

// Extra, fixed time spent on human-like clicks immediately before each beat's narration starts.
// A beat with no click beforehand (already on the right screen) gets 0.
export const PRE_ACTION_SECONDS = {
  '01-intro': 0, // already on Services after seeding
  '02-intro2': 0, // same screen, second narration beat
  '03-plan-ahead': CLICK_SECONDS, // Plan Ahead tab
  '04-schedule': CLICK_SECONDS, // Schedule tab (back)
  '05-songs': CLICK_SECONDS, // Songs nav
  '06-slides': CLICK_SECONDS, // Slides nav
  '07-media': CLICK_SECONDS, // Media nav
  '08-themes': CLICK_SECONDS, // Presentation Themes nav
  '09-people': CLICK_SECONDS, // People nav
  '10-roles': CLICK_SECONDS, // Roles nav
  '11-announcements': CLICK_SECONDS, // Announcements nav
  '12-templates': CLICK_SECONDS, // Service Templates nav
  '13-reports': CLICK_SECONDS, // Reports nav
  '14-settings': CLICK_SECONDS, // Settings nav
  '15-open-service': CLICK_SECONDS + SLOW_CLICK_SECONDS, // back to Services, then open one (slow)
  '16-live-preview': CLICK_SECONDS, // select an order-of-worship item
  '17-assignments': CLICK_SECONDS, // Assignments link
  '18-outro': CLICK_SECONDS, // back to Services
}
