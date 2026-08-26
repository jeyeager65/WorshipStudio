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
 * away), on window focus (covers alt-tabbing back within the same visible tab), a timer that
 * only runs while the tab is actually visible (paused otherwise, restarted on the next
 * visibility change — no point polling a backgrounded tab that can't run network calls reliably
 * anyway), and a debounced push a few seconds after the last local write.
 *
 * That last one is the push-only pass the original design plan called for. It was skipped at first
 * on the grounds that it "would mean threading a trigger through every individual store's
 * save/delete action" — but adapters/tablet/index.ts's dirty-tracking wrapper already sees every
 * local write from every port in one place, so the trigger is a subscription rather than a change
 * spread across the stores. Without it an edit made while sitting on the page waited for the next
 * tick, up to a full SYNC_INTERVAL_MS, which looked like the app simply not saving (see
 * notes/tablet-push-latency-plan.md).
 *
 * Nothing was ever *at risk* in that window — cloudSync.ts's pull() protects any dirty path from
 * being clobbered — but "not lost" and "visible to the rest of the church" are different promises,
 * and only the first was being kept. The manual "Sync Now" button (LibrarySyncSection.vue) still
 * covers "right now, this second."
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

/** How often a visible tablet runs a full cycle. Shortened from 5 minutes once pushes became
 *  near-immediate: leaving pulls at 5 made the two directions badly lopsided, so a device propped
 *  up during a service could show a service order five minutes out of date while its own edits left
 *  in seconds. A pull with nothing to fetch is one delta request that comes back empty — downloads
 *  only happen when something actually changed — so the extra ticks cost little beyond a radio
 *  wake-up, and the timer is paused entirely while the app is off screen. */
const SYNC_INTERVAL_MS = 90 * 1000
const FAST_RETRY_MS = 20 * 1000
const MAX_FAST_RETRIES = 3
/** How long after the *last* local write to push. Long enough that a burst of edits collapses into
 *  one upload rather than provoking the rate limits cloudSync.ts then has to back off from, short
 *  enough that another device sees the change while the operator still expects it to. */
const PUSH_DEBOUNCE_MS = 4 * 1000

export function useTabletSync(): void {
  const syncStore = useSyncStore()
  let intervalId: ReturnType<typeof setInterval> | undefined
  let fastRetryId: ReturnType<typeof setTimeout> | undefined
  let fastRetryCount = 0
  let pushDebounceId: ReturnType<typeof setTimeout> | undefined
  let stopLocalChanges: (() => void) | undefined

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

  function stopPushDebounce() {
    if (pushDebounceId !== undefined) clearTimeout(pushDebounceId)
    pushDebounceId = undefined
  }

  /** Restarted on every local write, so a run of edits results in one push after the last of them
   *  rather than one per save. Push-only on purpose: nothing needs fetching moments after this
   *  device typed something, and the interval/focus/visibility triggers above still run full
   *  cycles, so changes from other devices keep arriving on the same schedule as before. */
  function onLocalChange() {
    stopPushDebounce()
    pushDebounceId = setTimeout(() => {
      pushDebounceId = undefined
      void syncStore.runPush()
    }, PUSH_DEBOUNCE_MS)
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
    stopLocalChanges = getAdapter().sync.onLocalChange?.(onLocalChange)
  })

  onUnmounted(() => {
    stopInterval()
    stopFastRetry()
    stopPushDebounce()
    stopLocalChanges?.()
    stopLocalChanges = undefined
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onFocus)
  })
}
