<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import type { LiveMediaRef, LiveSlideContent } from '@/adapters/types'
import type { ExternalAppCommandSummary } from '../composables/usePoll'
import { useRemoteAction } from '../composables/useRemoteAction'

const props = defineProps<{
  content?: LiveSlideContent
  externalAppActive?: boolean
  /** Every command on the live external-app profile (spec section 12's Basic Remote Controls) —
   *  same set ServiceWorkspaceView's own live-item panel shows as buttons. */
  externalAppCommands?: ExternalAppCommandSummary[]
  /** Distinguishes "screen intentionally blanked while presenting" from "not presenting at
   *  all" — both leave `content` empty (the operator's own blank-screen override clears the
   *  live slide), but they're different states worth different placeholder copy. */
  isBlankScreen?: boolean
  /** The real audience display's own logical resolution (see usePoll.ts) — letterboxed/
   *  pillarboxed to when its aspect ratio doesn't match this box's, rather than stretched. */
  displaySize?: { width: number; height: number }
  /** Full Control only — View Only is look-but-don't-touch, so it gets the auto-refreshing
   *  screenshot like anyone else but not a tappable action button on top of it. */
  hasControls?: boolean
}>()

// `LiveMediaRef.url` is a `convertFileSrc` URL, only meaningful inside the operator's own
// webviews (see its own doc comment in adapters/types.ts) — a phone's browser can't resolve it
// at all. `mediaId` is what this bundle actually renders from, via the same auth-gated
// /api/media/:id endpoint RemoteMirror already uses for the mock/preview shim's media port.
function remapMedia(media: LiveMediaRef | undefined): LiveMediaRef | undefined {
  if (!media) return undefined
  return { ...media, url: `/api/media/${encodeURIComponent(media.mediaId)}` }
}

const remappedContent = computed<LiveSlideContent | undefined>(() => {
  if (!props.content) return undefined
  return {
    ...props.content,
    media: remapMedia(props.content.media),
    presentationTheme: props.content.presentationTheme
      ? {
          ...props.content.presentationTheme,
          backgroundMedia: remapMedia(props.content.presentationTheme.backgroundMedia),
        }
      : undefined,
  }
})

// A real screenshot of the audience display, for the one case the mirror otherwise has nothing
// to show: while an External App Hand-off item is live, `content` is empty (nothing Worship
// Studio rendered is on screen), so the only way to see what's actually up there is a capture
// of the real presentation window (see remote_server.rs's `/api/screenshot`, win32.rs's
// `capture_window_png`). Refreshed on an interval rather than every poll tick — a full window
// capture is real work server-side, not a cheap JSON read — plus a manual tap for "I want to
// see it right now" without waiting out the interval.
const SCREENSHOT_REFRESH_MS = 4000
const screenshotSrc = ref<string>()
const screenshotFailed = ref(false)
let screenshotTimer: ReturnType<typeof setInterval> | undefined

function refreshScreenshot() {
  screenshotSrc.value = `/api/screenshot?t=${Date.now()}`
}

// Same "Reopen App"/"Close App" actions the operator's own transport bar shows while an
// External App Hand-off item is live (see useExternalAppHandoff.ts's retryExternalApp/
// closeExternalApp) — Full Control only, matching every other action button here.
const { pending: externalAppActionPending, sendAction: sendExternalAppAction } = useRemoteAction()

watch(
  () => props.externalAppActive,
  (active) => {
    if (screenshotTimer) clearInterval(screenshotTimer)
    screenshotTimer = undefined
    if (active) {
      screenshotFailed.value = false
      refreshScreenshot()
      screenshotTimer = setInterval(refreshScreenshot, SCREENSHOT_REFRESH_MS)
    } else {
      screenshotSrc.value = undefined
      screenshotFailed.value = false
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  if (screenshotTimer) clearInterval(screenshotTimer)
})

const isVideo = computed(() => props.content?.media?.kind === 'video')
// Muted by default (avoids feedback/echo from a phone speaker near the platform — the room's
// own sound system already carries video audio) — reset on every new video slide rather than a
// sticky cross-slide preference, so muting one video doesn't silently carry into the next.
const muted = ref(true)
watch(
  () => props.content?.media?.url,
  () => {
    muted.value = true
  },
)

// SlideContentRenderer's root is hardcoded to 100vw/100vh unless given a `fixedSize` — correct
// for the real Audience presentation window (that Tauri window IS already sized to exactly
// match the display), wrong here, since this is an arbitrary-sized box on an arbitrary phone
// screen. The operator's own Previous/Current/Next preview thumbnails
// (src/views/ServiceWorkspaceView.vue) solve this exact problem the same way: render at a fixed
// "virtual" size, then visually scale the whole thing down with a CSS transform, so the *same*
// auto-fit math (which only cares about the root's own literal width/height) decides
// proportions, and only the final on-screen size differs.
//
// The virtual size is the *real* display's own resolution (props.displaySize), not derived from
// this box's own shape — a phone's screen is rarely the same aspect ratio as the configured
// audience display, so the mirror is scaled to *contain* (never crop) the real display's full
// picture and letterboxed/pillarboxed with black bars for the remainder, matching what someone
// standing in front of the real display actually sees, rather than stretching to fill the phone.
const DEFAULT_DISPLAY_SIZE = { width: 1920, height: 1080 }

const wrapRef = ref<HTMLElement>()
const wrapWidth = ref(DEFAULT_DISPLAY_SIZE.width)
const wrapHeight = ref(DEFAULT_DISPLAY_SIZE.height)
let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (entry) {
      wrapWidth.value = entry.contentRect.width
      wrapHeight.value = entry.contentRect.height
    }
  })
  if (wrapRef.value) resizeObserver.observe(wrapRef.value)
})
onUnmounted(() => resizeObserver?.disconnect())

const virtualSize = computed(() => props.displaySize ?? DEFAULT_DISPLAY_SIZE)
// "Contain" fit — the smaller of the two ratios, so the whole display is always visible with
// bars on the other axis, never cropped off the top/bottom or sides.
const scale = computed(() =>
  Math.min(wrapWidth.value / virtualSize.value.width, wrapHeight.value / virtualSize.value.height),
)
const scaledWidth = computed(() => virtualSize.value.width * scale.value)
const scaledHeight = computed(() => virtualSize.value.height * scale.value)
const offsetX = computed(() => Math.max((wrapWidth.value - scaledWidth.value) / 2, 0))
const offsetY = computed(() => Math.max((wrapHeight.value - scaledHeight.value) / 2, 0))
</script>

<template>
  <div ref="wrapRef" class="mirror-wrap">
    <div v-if="externalAppActive" class="external-app">
      <img
        v-if="screenshotSrc && !screenshotFailed"
        :src="screenshotSrc"
        class="screenshot-img"
        alt="A live screenshot of the presentation display"
        @error="screenshotFailed = true"
        @load="screenshotFailed = false"
      />
      <div v-if="!screenshotSrc || screenshotFailed" class="mirror-empty external-app-fallback">
        An external app is on screen.<br />Use the buttons below to control it.
      </div>
      <div v-if="hasControls" class="external-app-actions">
        <button
          v-for="command in externalAppCommands"
          :key="command.id"
          type="button"
          class="action-btn"
          :disabled="externalAppActionPending"
          @click="sendExternalAppAction('external-app-command', { commandId: command.id })"
        >
          {{ command.label }}
        </button>
        <button
          type="button"
          class="action-btn"
          :disabled="externalAppActionPending"
          @click="sendExternalAppAction('external-app-relaunch')"
        >
          🔁 Reopen App
        </button>
        <button
          type="button"
          class="action-btn"
          :disabled="externalAppActionPending"
          @click="sendExternalAppAction('external-app-close')"
        >
          ✖ Close App
        </button>
        <button type="button" class="refresh-btn" aria-label="Refresh screenshot" @click="refreshScreenshot">
          🔄 Refresh
        </button>
      </div>
    </div>
    <SlideContentRenderer
      v-else-if="remappedContent"
      :content="remappedContent"
      :fixed-size="virtualSize"
      :video-controls="false"
      :video-muted="muted"
      :style="{
        position: 'absolute',
        left: `${offsetX}px`,
        top: `${offsetY}px`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }"
    />
    <div v-else-if="isBlankScreen" class="mirror-empty">Screen is blanked</div>
    <div v-else class="mirror-empty">Not presenting</div>
    <button
      v-if="isVideo && !externalAppActive"
      type="button"
      class="mute-toggle"
      :aria-label="muted ? 'Unmute video' : 'Mute video'"
      @click="muted = !muted"
    >
      {{ muted ? '🔇 Unmute' : '🔊 Mute' }}
    </button>
  </div>
</template>

<style scoped>
.mirror-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
}
.mirror-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ws-text-secondary);
  font-size: 0.85rem;
  text-align: center;
}
.external-app {
  position: absolute;
  inset: 0;
}
.screenshot-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.external-app-actions {
  position: absolute;
  right: var(--ws-space-2);
  bottom: var(--ws-space-2);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ws-space-2);
  max-width: calc(100% - var(--ws-space-4));
}
.refresh-btn,
.action-btn {
  padding: var(--ws-space-1) var(--ws-space-3);
  border: none;
  border-radius: var(--ws-radius-lg);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.refresh-btn:active,
.action-btn:active:not(:disabled) {
  background: rgba(0, 0, 0, 0.8);
}
.action-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.mute-toggle {
  position: absolute;
  right: var(--ws-space-2);
  bottom: var(--ws-space-2);
  padding: var(--ws-space-1) var(--ws-space-3);
  border: none;
  border-radius: var(--ws-radius-lg);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mute-toggle:active {
  background: rgba(0, 0, 0, 0.8);
}
</style>
