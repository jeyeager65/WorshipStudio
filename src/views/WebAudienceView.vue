<script setup lang="ts">
/**
 * The audience-facing window — opened by src/utils/liveAudienceWindow.ts via window.open() (used
 * by both the mock/demo and real web adapters), detected in main.ts via a `?presentation=1` query
 * param (mounted directly, bypassing BootGate and adapter resolution entirely: this window never
 * needs its own adapter, only the BroadcastChannel content stream). Renders through the same
 * SlideContentRenderer.vue the Tauri desktop build's PresentationView.vue and the Remote Control
 * phone mirror both use.
 *
 * No app-bar, no Vuetify chrome — just the current slide, full-bleed, plus a display-choosing
 * fullscreen affordance. Two-tier by necessity, not preference — confirmed in the August 2026
 * spike: requestFullscreen({screen}) has to be triggered by a genuine click inside *this* window
 * (the opener's click doesn't count), and getScreenDetails() itself needs the same kind of
 * gesture to prompt for the Window Management permission the first time. So "Choose Display" is
 * its own click (asks getScreenDetails(), which may prompt), and going fullscreen on a specific
 * screen is a second, separate click — each one a fresh, valid user gesture. Browsers without the
 * Window Management API (Firefox/Safari) fall back to a single plain "Go Fullscreen" button with
 * no screen targeting, which just fullscreens wherever the window currently is — still useful if
 * the operator dragged it to a second monitor the normal OS way first.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import type { LiveSlideContent } from '@/adapters/types'
import { AUDIENCE_CHANNEL_NAME, type AudienceMessage } from '@/utils/audienceChannel'

const current = ref<LiveSlideContent>()
const isFullscreen = ref(false)
const screens = ref<ScreenDetailed[]>([])
const screenPickerOpen = ref(false)
const screenDetailsSupported = typeof window !== 'undefined' && 'getScreenDetails' in window
let channel: BroadcastChannel | undefined
let screenDetails: ScreenDetails | undefined

function updateFullscreenState() {
  isFullscreen.value = document.fullscreenElement !== null
}

function screenLabel(screen: ScreenDetailed, index: number): string {
  return screen.label || `Screen ${index + 1}${screen.isPrimary ? ' (this one)' : ''}`
}

/** Single entry point for the fullscreen button. If the Window Management API isn't available,
 *  just fullscreen in place — no screen targeting possible or needed. If it is, ask for the
 *  screen list (this click is what's allowed to trigger that permission prompt) and let the
 *  operator pick one via a second click, unless there's only one screen to begin with. */
async function chooseDisplay() {
  if (!screenDetailsSupported) {
    await goFullscreenOnScreen()
    return
  }
  try {
    screenDetails = await window.getScreenDetails()
    screens.value = screenDetails.screens
    screenDetails.addEventListener('screenschange', () => {
      if (screenDetails) screens.value = screenDetails.screens
    })
  } catch {
    // Permission denied — fall back to plain in-place fullscreen rather than a dead end.
    await goFullscreenOnScreen()
    return
  }
  if (screens.value.length <= 1) {
    await goFullscreenOnScreen(screens.value[0])
  } else {
    screenPickerOpen.value = true
  }
}

async function goFullscreenOnScreen(screen?: ScreenDetailed) {
  screenPickerOpen.value = false
  try {
    await document.documentElement.requestFullscreen(screen ? { screen } : undefined)
  } catch {
    // Ignored — most likely the user dismissed the browser's own fullscreen prompt; the button
    // stays available to try again.
  }
}

// Also bound directly to the Close button in the reveal overlay below — the 'stop' broadcast
// (see audienceChannel.ts) is what makes Stop Presenting reliably reach this window from the
// operator's tab on iOS Safari, but this window needs its own way to close itself too: on an
// iPad especially, there's no keyboard/window-chrome to fall back on, so without a control in
// here the only way out is force-closing the whole app.
function closeSelf() {
  window.close()
}

// Presenting from a tablet with no separate operator screen to switch back to (or no other
// screen at all): tapping the left/right edge of the slide itself requests Previous/Next, same
// as the operator's own on-screen buttons — see LivePresentationPort's `onNavigateRequest` and
// useLiveTransport.ts's subscription to it. A tap in the middle reveals the small overlay below
// instead (see revealOverlay), rather than navigating.
const NAV_ZONE_FRACTION = 0.35
function requestNavigate(direction: 'next' | 'previous') {
  const message: AudienceMessage = { type: direction }
  channel?.postMessage(message)
}

// No persistent on-screen chrome once presenting for real (fullscreen, an external monitor, or
// just a tablet propped up in front of the room) — the congregation shouldn't see a Close button
// sitting over the slide. A tap in the middle reveals it briefly instead, the same "tap to
// reveal, then fade" pattern video players use, so it's there the moment someone touches the
// screen looking for it and gone the rest of the time.
const OVERLAY_AUTO_HIDE_MS = 3000
const overlayVisible = ref(false)
let overlayHideTimer: ReturnType<typeof setTimeout> | undefined
function revealOverlay() {
  overlayVisible.value = true
  if (overlayHideTimer) clearTimeout(overlayHideTimer)
  overlayHideTimer = setTimeout(() => {
    overlayVisible.value = false
    overlayHideTimer = undefined
  }, OVERLAY_AUTO_HIDE_MS)
}

/** Bound to the whole slide area. Buttons inside the overlay/controls stop propagation (see
 *  their own @click.stop below) so clicking them doesn't also register as a nav-zone tap. */
function handleTap(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const xFraction = (event.clientX - rect.left) / rect.width
  if (xFraction < NAV_ZONE_FRACTION) requestNavigate('previous')
  else if (xFraction > 1 - NAV_ZONE_FRACTION) requestNavigate('next')
  else revealOverlay()
}

onMounted(() => {
  channel = new BroadcastChannel(AUDIENCE_CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<AudienceMessage>) => {
    if (event.data?.type === 'content') current.value = event.data.content ?? undefined
    if (event.data?.type === 'stop') closeSelf()
  }
  const readyMessage: AudienceMessage = { type: 'ready' }
  channel.postMessage(readyMessage)
  document.addEventListener('fullscreenchange', updateFullscreenState)
})

onBeforeUnmount(() => {
  channel?.close()
  document.removeEventListener('fullscreenchange', updateFullscreenState)
  if (overlayHideTimer) clearTimeout(overlayHideTimer)
})
</script>

<template>
  <!-- Tap zones: left/right edges request Previous/Next (see requestNavigate); the middle
       reveals the overlay below instead of navigating. Every actual button stops propagation
       (@click.stop) so tapping one doesn't also register as a nav-zone tap underneath it. -->
  <div class="audience-root" @click="handleTap">
    <SlideContentRenderer :content="current" transition />

    <!-- Tap-to-reveal only — no persistent chrome once presenting for real. Kept small/low-key
         like RemoteMirror.vue's mute toggle. -->
    <div v-if="overlayVisible" class="reveal-overlay">
      <button
        type="button"
        class="close-btn"
        aria-label="Close presentation window"
        @click.stop="closeSelf"
      >
        ✕ Close
      </button>
    </div>

    <div v-if="!isFullscreen" class="controls">
      <button
        v-if="!screenPickerOpen"
        type="button"
        class="control-btn"
        @click.stop="chooseDisplay"
      >
        {{ screenDetailsSupported ? 'Choose Display…' : 'Go Fullscreen' }}
      </button>
      <div v-else class="screen-picker">
        <button
          v-for="(screen, index) in screens"
          :key="index"
          type="button"
          class="control-btn"
          @click.stop="goFullscreenOnScreen(screen)"
        >
          Fullscreen on {{ screenLabel(screen, index) }}
        </button>
        <button
          type="button"
          class="control-btn control-btn--cancel"
          @click.stop="screenPickerOpen = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audience-root {
  position: fixed;
  inset: 0;
  background: black;
}
.controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  /* Higher than any z-index inside SlideContentRenderer.vue/SlideSceneRenderer.vue (currently
     tops out at 2, for the reference-only scripture wayfinding progress bar) — this overlay
     must always sit above whatever slide content is showing underneath it. */
  z-index: 10;
}
.screen-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.control-btn {
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.control-btn:hover {
  background: rgba(0, 0, 0, 0.75);
}
.control-btn--cancel {
  opacity: 0.7;
}
.reveal-overlay {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 10;
}
.close-btn {
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.close-btn:hover {
  background: rgba(0, 0, 0, 0.75);
}
</style>
