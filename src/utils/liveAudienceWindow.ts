/**
 * LivePresentationPort backed by a plain browser window plus BroadcastChannel — used identically
 * by both the mock/demo adapter and the real File System Access-backed web adapter, since it's
 * genuinely storage-independent (no filesystem access at all, just window.open() and browser
 * messaging). In place of the Tauri desktop build's native WebviewWindow plus emit/listen
 * (src/adapters/tauri/index.ts, src/views/PresentationView.vue). Renders through the exact same
 * SlideContentRenderer.vue every other live-content consumer uses (the Tauri presentation window,
 * the Remote Control phone mirror, and the operator's own preview thumbnails) — see
 * src/views/WebAudienceView.vue.
 *
 * Deliberately windowed by default rather than auto-fullscreening on a chosen monitor: an August
 * 2026 spike confirmed requestFullscreen({screen}) needs a genuine click inside the *new* window
 * itself (the opener's click doesn't count, even synchronously) and that cross-monitor
 * window.open() positioning isn't reliable — but a real display simply doesn't exist for many
 * operators (a laptop alone, or two people sharing one screen), so the audience window has to work
 * as an ordinary window regardless (decided August 8, 2026, notes/completion-audit.md's "Web-based
 * prep build" section). The operator can drag this window to a second monitor the normal OS way
 * and click "Go Fullscreen" there — plain requestFullscreen() with no {screen} targeting, which
 * fullscreens wherever the window currently is without needing the Window Management permission
 * or any screen-picker UI at all.
 */

import type { LivePresentationPort, LiveSlideContent } from '@/adapters/types'
import { AUDIENCE_CHANNEL_NAME, type AudienceMessage } from './audienceChannel'

/**
 * A structured-clone-safe copy of the live content.
 *
 * BroadcastChannel.postMessage structured-clones its payload, which throws DataCloneError on a
 * Proxy — and Vue's reactive stores hand out Proxies. `flattenService.ts` passes a library slide's
 * `scene` straight through from the slides store, so going live on a slide item posted a Proxy and
 * failed with "#<Object> could not be cloned", taking the whole presentation down.
 *
 * Normalising here rather than at each call site because the requirement belongs to this transport:
 * the Tauri port JSON-serializes over IPC and never had the problem, so a caller has no way to know
 * which rule applies. Anything reactive leaking into the payload later is covered too, and
 * presentation is the worst possible place to discover a new one.
 *
 * A JSON round-trip rather than structuredClone(toRaw(...)): toRaw only unwraps the outermost
 * proxy, and this content is plain JSON data throughout, so nothing is lost.
 */
function toCloneable(content: LiveSlideContent | null): LiveSlideContent | null {
  if (!content) return null
  return JSON.parse(JSON.stringify(content)) as LiveSlideContent
}

function buildAudienceUrl(): string {
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = '?presentation=1'
  return url.toString()
}

export function createLiveAudienceWindowPort(): LivePresentationPort {
  const channel = new BroadcastChannel(AUDIENCE_CHANNEL_NAME)
  let audienceWindow: Window | null = null
  let lastContent: LiveSlideContent | null = null
  let liveIndex = -1
  // Set by onNavigateRequest/onAudienceClosed below — at most one subscriber ever exists (one
  // useLiveTransport instance per operator tab), so a single slot each is simpler than a full
  // listener list.
  let navigateCallback: ((direction: 'next' | 'previous') => void) | undefined
  let audienceClosedCallback: (() => void) | undefined

  channel.onmessage = (event: MessageEvent<AudienceMessage>) => {
    if (event.data?.type === 'ready') {
      const message: AudienceMessage = { type: 'content', content: lastContent }
      channel.postMessage(message)
    } else if (event.data?.type === 'next') {
      navigateCallback?.('next')
    } else if (event.data?.type === 'previous') {
      navigateCallback?.('previous')
    } else if (event.data?.type === 'closed') {
      audienceClosedCallback?.()
    }
  }

  return {
    startPresenting: async () => {
      if (audienceWindow && !audienceWindow.closed) {
        audienceWindow.focus()
        return
      }
      audienceWindow = window.open(
        buildAudienceUrl(),
        'worship-studio-audience',
        'width=1280,height=720',
      )
      if (liveIndex === -1) liveIndex = 0
    },
    stopPresenting: async () => {
      // Broadcasting 'stop' (rather than relying solely on the direct .close() below) is what
      // actually works on iOS Safari — see audienceChannel.ts's doc comment on the 'stop' message.
      const message: AudienceMessage = { type: 'stop' }
      channel.postMessage(message)
      audienceWindow?.close()
      audienceWindow = null
      liveIndex = -1
    },
    goToIndex: async (index) => {
      liveIndex = index
    },
    next: async () => {
      liveIndex += 1
    },
    previous: async () => {
      liveIndex = Math.max(0, liveIndex - 1)
    },
    setLiveContent: async (content) => {
      // Normalised before it is stored, so the 'ready' replay above posts a cloneable copy too.
      lastContent = toCloneable(content ?? null)
      const message: AudienceMessage = { type: 'content', content: lastContent }
      channel.postMessage(message)
    },
    // The operator's own Previous/Current/Next preview thumbnails (useLiveTransport.ts) render
    // SlideContentRenderer at this exact size and CSS-scale it down, specifically so their
    // auto-fit font/wrapping decisions match what the audience window actually shows — without
    // this, they silently fall back to a hardcoded 1920x1080 assumption that has no reason to
    // match a windowed popup (1280x720 by default) or whatever real monitor it's later
    // fullscreened onto. Same-origin window properties, no special access needed.
    getPresentationSize: async () => {
      if (!audienceWindow || audienceWindow.closed) return undefined
      return { width: audienceWindow.innerWidth, height: audienceWindow.innerHeight }
    },
    onNavigateRequest: async (callback) => {
      navigateCallback = callback
      return () => {
        if (navigateCallback === callback) navigateCallback = undefined
      }
    },
    onAudienceClosed: async (callback) => {
      audienceClosedCallback = callback
      return () => {
        if (audienceClosedCallback === callback) audienceClosedCallback = undefined
      }
    },
  }
}
