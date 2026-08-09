/**
 * Shared BroadcastChannel contract between the web adapter's live port (src/adapters/web/live.ts,
 * the sender) and the audience window (src/views/WebAudienceView.vue, the receiver) — kept in one
 * place so both sides agree on the channel name and message shape without duplicating literals.
 *
 * Mirrors the Tauri desktop build's presentation window, which uses `emit`/`listen` events
 * instead (`live:slide-changed`, `presentation:ready` — see src/adapters/tauri/index.ts and
 * src/views/PresentationView.vue): a 'ready' handshake exists here for the same reason as there
 * — BroadcastChannel messages aren't queued, so a message sent before the new window's listener
 * is attached is simply lost; the audience window announces itself once ready, and the operator
 * side re-sends whatever it last had.
 */

import type { LiveSlideContent } from '@/adapters/types'

export const AUDIENCE_CHANNEL_NAME = 'worship-studio-audience'

export type AudienceMessage =
  { type: 'ready' } | { type: 'content'; content: LiveSlideContent | null }
