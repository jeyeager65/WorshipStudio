<script setup lang="ts">
/**
 * The web build's audience-facing window — opened by src/adapters/web/live.ts via window.open(),
 * detected in main.ts via a `?presentation=1` query param (mounted directly, bypassing BootGate
 * and adapter resolution entirely: this window never needs its own adapter, only the
 * BroadcastChannel content stream). Renders through the same SlideContentRenderer.vue the Tauri
 * desktop build's PresentationView.vue and the Remote Control phone mirror both use.
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
import { AUDIENCE_CHANNEL_NAME, type AudienceMessage } from '@/adapters/web/audienceChannel'

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

onMounted(() => {
  channel = new BroadcastChannel(AUDIENCE_CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<AudienceMessage>) => {
    if (event.data?.type === 'content') current.value = event.data.content ?? undefined
  }
  const readyMessage: AudienceMessage = { type: 'ready' }
  channel.postMessage(readyMessage)
  document.addEventListener('fullscreenchange', updateFullscreenState)
})

onBeforeUnmount(() => {
  channel?.close()
  document.removeEventListener('fullscreenchange', updateFullscreenState)
})
</script>

<template>
  <div class="audience-root">
    <SlideContentRenderer :content="current" />

    <div v-if="!isFullscreen" class="controls">
      <button v-if="!screenPickerOpen" type="button" class="control-btn" @click="chooseDisplay">
        {{ screenDetailsSupported ? 'Choose Display…' : 'Go Fullscreen' }}
      </button>
      <div v-else class="screen-picker">
        <button
          v-for="(screen, index) in screens"
          :key="index"
          type="button"
          class="control-btn"
          @click="goFullscreenOnScreen(screen)"
        >
          Fullscreen on {{ screenLabel(screen, index) }}
        </button>
        <button
          type="button"
          class="control-btn control-btn--cancel"
          @click="screenPickerOpen = false"
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
</style>
