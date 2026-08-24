/**
 * Triggers the tablet adapter's cloud sync automatically, so an operator never has to remember
 * to press "Sync Now" — kept separate from cloudSync.ts itself for testability (that file is
 * pure orchestration logic with no notion of the DOM/timers at all). A no-op for every other
 * adapter kind, so it's safe to call unconditionally from App.vue regardless of which build is
 * running.
 *
 * Goes through useSyncStore's runSync() rather than calling the adapter directly, so every
 * trigger here — not just the manual "Sync Now" button — sets the shared `syncing` flag
 * (App.vue's app-bar indicator) and refreshes status.lastSyncedAt/pendingPushCount afterward.
 * Before this, an automatic background sync ran completely invisibly: no UI feedback anywhere
 * that it was happening, and the "Last synced" display only ever updated after a manual sync.
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
 *
 * Also schedules a short follow-up sync (FAST_RETRY_MS, capped at MAX_FAST_RETRIES) whenever a
 * run comes back with status.reauthFailurePending — one auth failure seen, but
 * cloudSync.ts's REAUTH_FAILURE_THRESHOLD needs a second consecutive one before it actually
 * flips needsReconnect and shows the banner. Left to the normal triggers above, that second
 * confirmation could otherwise wait up to a full SYNC_INTERVAL_MS if the operator isn't actively
 * switching tabs/focus — a real, reported delay before the reconnect prompt appeared at all.
 */
import { onMounted, onUnmounted } from 'vue'
import { getAdapter } from '@/adapters'
import { useSyncStore } from '@/stores/sync'

const SYNC_INTERVAL_MS = 5 * 60 * 1000
const FAST_RETRY_MS = 20 * 1000
const MAX_FAST_RETRIES = 3

export function useTabletSync(): void {
  const syncStore = useSyncStore()
  let intervalId: ReturnType<typeof setInterval> | undefined
  let fastRetryId: ReturnType<typeof setTimeout> | undefined
  let fastRetryCount = 0

  function stopFastRetry() {
    if (fastRetryId !== undefined) clearTimeout(fastRetryId)
    fastRetryId = undefined
  }

  function runSync() {
    stopFastRetry()
    void syncStore.runSync().finally(() => {
      if (syncStore.status?.reauthFailurePending && fastRetryCount < MAX_FAST_RETRIES) {
        fastRetryCount++
        fastRetryId = setTimeout(runSync, FAST_RETRY_MS)
      } else {
        fastRetryCount = 0
      }
    })
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
    stopFastRetry()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onFocus)
  })
}
