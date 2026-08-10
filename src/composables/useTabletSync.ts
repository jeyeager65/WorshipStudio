/**
 * Triggers the tablet adapter's cloud sync automatically, so an operator never has to remember
 * to press "Sync Now" — kept separate from cloudSync.ts itself for testability (that file is
 * pure orchestration logic with no notion of the DOM/timers at all). A no-op for every other
 * adapter kind, so it's safe to call unconditionally from App.vue regardless of which build is
 * running.
 *
 * Triggers: once on mount, on every tab-visible transition (covers switching back after minutes
 * away), on window focus (covers alt-tabbing back within the same visible tab), and a timer that
 * only runs while the tab is actually visible (paused otherwise, restarted on the next
 * visibility change — no point polling a backgrounded tab that can't run network calls reliably
 * anyway). The debounced push-only pass after each local save described in the original design
 * plan was deliberately not added: it would mean threading a trigger through every individual
 * store's save/delete action, and cloudSync.ts's pull() already protects any dirty (unpushed)
 * path from being clobbered by a concurrent pull — so a save is never at risk between now and
 * the next visibility/focus/interval tick, just not pushed quite as instantly. The manual "Sync
 * Now" button (LibrarySyncSection.vue) already covers "I want this synced right now."
 */
import { onMounted, onUnmounted } from 'vue'
import { getAdapter } from '@/adapters'

const SYNC_INTERVAL_MS = 5 * 60 * 1000

export function useTabletSync(): void {
  let intervalId: ReturnType<typeof setInterval> | undefined

  function runSync() {
    void getAdapter().sync.runSync?.()
  }

  function stopInterval() {
    if (intervalId !== undefined) clearInterval(intervalId)
    intervalId = undefined
  }

  function startInterval() {
    stopInterval()
    intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      runSync()
      startInterval()
    } else {
      stopInterval()
    }
  }

  function onFocus() {
    runSync()
  }

  onMounted(() => {
    if (getAdapter().kind !== 'tablet') return
    runSync()
    if (document.visibilityState === 'visible') startInterval()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
  })

  onUnmounted(() => {
    stopInterval()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onFocus)
  })
}
