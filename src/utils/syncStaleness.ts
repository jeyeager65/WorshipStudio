/**
 * "Has this tablet gone too long without a successful sync?" — a *predictor* of trouble, unlike
 * SyncStatus.needsReconnect, which is only ever set after a sync has actually run and its silent
 * reauth has failed twice consecutively (see cloudSync.ts's REAUTH_FAILURE_THRESHOLD).
 *
 * That distinction is the whole point. Syncs are only attempted while the app is running — on
 * visibilitychange, on focus, and on useTabletSync's 5-minute interval — and iOS suspends that
 * timer the moment the PWA is backgrounded. So an iPad left overnight wakes up with a connection
 * that OneDrive can no longer silently renew (its refresh tokens are capped at 24h; Dropbox's
 * don't expire on their own) but with needsReconnect still false, because nothing has tried yet.
 * The operator saw a green "all synced" check and only learned otherwise by forcing a sync by
 * hand — which is exactly what this exists to avoid.
 */

/** Six times useTabletSync's own 5-minute cadence.
 *
 *  The cadence is what sets the scale: a running, healthy app syncs every 5 minutes (plus on
 *  focus and visibility change), so its age essentially never exceeds that. Anything far past it
 *  means the app has been closed, or syncs are failing — and after being closed, the first thing
 *  the app does on open is sync, which resets this. So an age that *stays* high is a real signal,
 *  not idleness.
 *
 *  6x leaves comfortable margin for one slow or missed interval without flickering, while still
 *  surfacing a genuine failure within half an hour rather than half a day. An earlier draft used
 *  12h, reasoning from OneDrive's 24h refresh-token cap; that was the wrong anchor. The cap bounds
 *  when a connection *must* fail, not when it's worth mentioning that nothing has synced — and at
 *  144x the sync cadence it would have hidden exactly the overnight case this exists to catch.
 *
 *  The asymmetry supports erring short: a false positive costs a warning-coloured icon and a
 *  one-tap Sync Now, while a false negative leaves unsynced edits on a tablet believing itself
 *  fine. The transient case is already covered — the indicator shows its syncing spinner, not this
 *  warning, while a sync is actually in flight. */
export const SYNC_STALE_AFTER_MS = 30 * 60 * 1000

/** Milliseconds since the last successful sync, or undefined if it has never synced (or the
 *  stored timestamp is unparseable — treated the same, since neither can be aged). */
export function syncAgeMs(lastSyncedAt: string | undefined, now: number): number | undefined {
  if (!lastSyncedAt) return undefined
  const synced = Date.parse(lastSyncedAt)
  if (Number.isNaN(synced)) return undefined
  // A timestamp from the future (clock skew between devices sharing one library) is not stale.
  return Math.max(0, now - synced)
}

/** True when the last sync is older than `thresholdMs`, or when there has never been one.
 *
 *  Never-synced counts as stale on purpose: a tablet that has never completed a sync is the least
 *  trustworthy state of all, and showing it the same reassuring check as a just-synced device is
 *  the bug this is fixing. */
export function isSyncStale(
  lastSyncedAt: string | undefined,
  now: number,
  thresholdMs: number = SYNC_STALE_AFTER_MS,
): boolean {
  const age = syncAgeMs(lastSyncedAt, now)
  return age === undefined || age > thresholdMs
}

/** Compact "how long ago", for the app-bar indicator where there's room for a few words at most.
 *  Rounds down, so "1 day ago" never appears before a full day has passed. */
export function formatSyncAge(lastSyncedAt: string | undefined, now: number): string {
  const age = syncAgeMs(lastSyncedAt, now)
  if (age === undefined) return 'never synced'

  const minutes = Math.floor(age / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
