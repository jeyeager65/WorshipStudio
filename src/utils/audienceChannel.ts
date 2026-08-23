/**
 * Shared BroadcastChannel contract between the live audience window port
 * (src/utils/liveAudienceWindow.ts, the sender — used by both the mock/demo and real web
 * adapters) and the audience window itself (src/views/WebAudienceView.vue, the receiver) — kept
 * in one place so both sides agree on the channel name and message shape without duplicating
 * literals.
 *
 * Mirrors the Tauri desktop build's presentation window, which uses `emit`/`listen` events
 * instead (`live:slide-changed`, `presentation:ready` — see src/adapters/tauri/index.ts and
 * src/views/PresentationView.vue): a 'ready' handshake exists here for the same reason as there
 * — BroadcastChannel messages aren't queued, so a message sent before the new window's listener
 * is attached is simply lost; the audience window announces itself once ready, and the operator
 * side re-sends whatever it last had.
 *
 * 'stop' tells the audience window to close itself. Broadcasting this (rather than relying solely
 * on the operator side's own `Window` object reference calling `.close()` on it — see
 * liveAudienceWindow.ts's `stopPresenting`) is what makes closing actually work on iOS Safari:
 * backgrounding the operator's tab (unavoidable — the operator has to switch back to it to tap
 * Stop Presenting) can get the popped-out audience tab's process torn down and recreated, silently
 * invalidating that direct reference, whereas a same-origin BroadcastChannel message still reaches
 * the tab's live script instance.
 */

import type { LiveSlideContent } from '@/adapters/types'

export const AUDIENCE_CHANNEL_NAME = 'worship-studio-audience'

export type AudienceMessage =
  | { type: 'ready' }
  | { type: 'content'; content: LiveSlideContent | null }
  | { type: 'stop' }
