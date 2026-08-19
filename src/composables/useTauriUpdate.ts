/**
 * Schedules background checks against the shared Tauri-updater store (stores/tauriUpdate.ts) —
 * App.vue calls this once and shows a banner when updateAvailable becomes true, applying the
 * update only once the operator taps it. Never auto-applies, mirroring usePwaUpdate.ts's own
 * "prompt, don't surprise mid-service" rule — a Tauri update needs a full app restart to take
 * effect, strictly more disruptive than a web page reload, so this is at least as careful, not
 * less.
 *
 * Checks are skipped entirely while useLiveSessionStore().isPresenting is true. A check itself
 * is harmless (just a network request) — what actually matters is applyUpdate() never running
 * mid-service, but gating the check too means the banner can't even appear and tempt a tap while
 * presenting. The manual "Check for Updates" button in Settings (AboutSection.vue) needs no
 * separate guard: Settings is unreachable while presenting at all (see liveSession.ts's own doc
 * comment on the router guard that blocks leaving the workspace mid-presentation).
 */
import { onMounted, onUnmounted } from 'vue'
import { getAdapter } from '@/adapters'
import { useTauriUpdateStore } from '@/stores/tauriUpdate'
import { useLiveSessionStore } from '@/stores/liveSession'

const CHECK_INTERVAL_MS = 30 * 60 * 1000

export function useTauriUpdate() {
  const store = useTauriUpdateStore()

  // A no-op everywhere but the real desktop build — @tauri-apps/plugin-updater's check() calls
  // through invoke(), which only works inside an actual Tauri webview; calling it from web/
  // tablet/mock would just surface a misleading "could not check for updates" error for a
  // feature that was never applicable there in the first place. Same asymmetric-guard shape as
  // usePwaUpdate.ts's own `if (getAdapter().kind === 'tauri') return`, just inverted.
  if (getAdapter().kind !== 'tauri') return store

  let intervalId: ReturnType<typeof setInterval> | undefined

  function maybeCheck() {
    if (useLiveSessionStore().isPresenting) return
    void store.checkForUpdate()
  }

  function stopInterval() {
    if (intervalId !== undefined) clearInterval(intervalId)
    intervalId = undefined
  }

  function startInterval() {
    stopInterval()
    intervalId = setInterval(maybeCheck, CHECK_INTERVAL_MS)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      maybeCheck()
      startInterval()
    } else {
      stopInterval()
    }
  }

  onMounted(() => {
    maybeCheck()
    if (document.visibilityState === 'visible') startInterval()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    stopInterval()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return store
}
