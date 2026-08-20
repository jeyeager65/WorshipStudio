import { onMounted, onUnmounted, ref } from 'vue'
import type { LiveSlideContent } from '@/adapters/types'

export interface SlideSummary {
  index: number
  label: string
}

/** Mirrors the Rust server's StatePayload (src-tauri/src/remote_server.rs). */
export interface RemoteState {
  deviceName: string
  isPresenting: boolean
  content?: LiveSlideContent
  accessLevel: 'view-only' | 'full-control'
  slides: SlideSummary[]
  externalAppActive: boolean
  /** The real audience display's own logical resolution — absent only if nothing has ever
   *  started presenting yet this app session (see remote_server.rs's `display_size`). */
  displaySize?: { width: number; height: number }
  isBlankScreen: boolean
  backgroundOnly: boolean
  /** True once a service is open on the operator side, regardless of `isPresenting` — see
   *  remote_server.rs's `service_open` doc comment. Full Control has nothing useful to show
   *  (no Start Presenting, no Prev/Next, no slide picker) until this is true. */
  serviceOpen: boolean
}

// A LAN-only server with at most a handful of paired devices polling a tiny JSON payload each —
// there's no real bandwidth/load concern that justifies a slow interval, and 1200ms (inherited
// unchanged from remote_page.html) reads as sluggish for something meant to mirror a live
// button press. 300ms keeps real headroom before overlapping requests could stack up while
// still feeling immediate.
const POLL_INTERVAL_MS = 300

/** Polls GET /api/state on an interval — plain polling, not WebSocket/SSE, matching the existing
 *  server (see remote_server.rs's own doc comment on why: a phone/tablet on a church's LAN,
 *  simplicity over the marginal latency win). A 401 means this device's pairing was revoked. */
export function usePoll() {
  const state = ref<RemoteState>()
  const connected = ref(true)
  const unpaired = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function poll() {
    try {
      const res = await fetch('/api/state')
      if (res.status === 401) {
        unpaired.value = true
        return
      }
      state.value = (await res.json()) as RemoteState
      connected.value = true
    } catch {
      connected.value = false
    } finally {
      // Chained setTimeout rather than setInterval — a single slow/hung request (a Wi-Fi
      // hiccup, the server briefly busy) can't pile up overlapping polls this way, since the
      // next one is only scheduled once the previous has actually finished.
      if (!stopped && !unpaired.value) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }
  }

  onMounted(() => {
    void poll()
  })
  onUnmounted(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  // After a device pairs itself from the unpaired screen (App.vue) — clears the flag and
  // restarts the poll loop, which stopped scheduling itself the moment unpaired became true
  // (see poll()'s own finally block above) and needs a fresh call to pick back up.
  function retryAfterPairing() {
    unpaired.value = false
    void poll()
  }

  return { state, connected, unpaired, retryAfterPairing }
}
