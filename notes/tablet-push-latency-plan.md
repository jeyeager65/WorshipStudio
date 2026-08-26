# Tablet sync: pushing local edits sooner

Status: **BUILT 2026-08-26.** Opened the same day after a real observation while verifying writes
against a shared OneDrive folder; implemented as described below. Kept as the record of why the
cadence changed, since the reasoning it overturns was itself written down in the code.

## The symptom

An edit made on a tablet did not appear in the cloud for a while, then did; closing and reopening
the page immediately uploaded a couple of files. That is not a bug — it is exactly what the current
cadence does — but the operator's instinct that something was off is worth acting on.

## Why it happens

A save marks the file dirty and returns. The upload happens on the next sync tick, and
`useTabletSync.ts` only ticks on:

- mount,
- `visibilitychange`,
- window `focus`,
- a 5-minute interval, itself paused while the tab is hidden.

So an edit made while sitting on the page, without switching away, can wait up to five minutes.
Reopening the page explains the burst: mount runs a sync and pushes whatever was still queued.

## Why it was built this way, and why that reason no longer holds

From `useTabletSync.ts`'s own doc comment — worth reading before changing anything:

> The debounced push-only pass after each local save described in the original design plan was
> deliberately not added: it would mean threading a trigger through every individual store's
> save/delete action […] The manual "Sync Now" button already covers "I want this synced right now."

So the original design plan _did_ call for a push after each save. It was skipped on an
implementation-cost argument, not a correctness one. The safety point made alongside it — that
`cloudSync.ts`'s `pull()` protects any dirty path from being clobbered — is true and unaffected,
but it is about _not losing data_, not about how quickly an edit becomes visible to anyone else.

**The premise is now obsolete.** `createTabletAdapter` wraps the OPFS root in
`wrapWithDirtyTracking` (`adapters/tablet/index.ts`), whose callback fires on _every_ local write
from _every_ port, in exactly one place. That is precisely the central hook the comment says does
not exist — it was added for dirty tracking, and happens to be the trigger point the original plan
wanted. No per-store threading is required.

## Proposed change

1. Give the tablet adapter a "local change happened" notification, fed from the existing
   `wrapWithDirtyTracking` callback.
2. Have `useTabletSync` subscribe, debounce a few seconds after the _last_ write, and go through the
   same `useSyncStore.runSync()` path the other triggers use — so the shared `syncing` flag and
   `lastSyncedAt` refresh behave identically and there is no second code path.
3. Keep the interval, focus and visibility triggers exactly as they are, as the safety net.

Net effect: an edit reaches other devices seconds after typing stops, rather than on whatever tick
comes next.

### Two things to get right

- **Push-only, not a full cycle.** The adapter currently exposes only `runSync()`, a pull+push.
  Firing a full delta pull every few seconds is wasteful; `cloudSync` already has a separate
  `push()`, so this wants a push-only entry point on the sync port. The original plan specified
  push-only for exactly this reason.
- **Debounce on the last write, not the first**, and keep it at a few seconds. A burst of edits
  should collapse into one push — bursts of API calls are what rate limits punish. The existing
  global rate-limit cooldown in `cloudSync.ts` is a backstop, not a licence to provoke it.

## Related gap: the indicator says "synced" while changes are queued

`SyncStatus.pendingPushCount` exists and is already surfaced in Settings (Library & Sync) and in the
reconnect banner — but **the app-bar cloud indicator ignores it**. So during the wait the icon sits
on `mdi-cloud-check-outline`, which reads as "everything is saved to the cloud" while files are
still queued locally.

Same class of problem as the staleness warning added in v0.8.58 (see `src/utils/syncStaleness.ts`):
the indicator was reassuring exactly when it should not have been. A distinct pending state when
`pendingPushCount > 0` would have answered the original question without anyone reading the source.

Worth doing even if the debounce work is deferred — arguably _more_ worth doing in that case, since
the wait would remain.

## What was built

Exactly the shape proposed above.

- `cloudSync.ts` gained `runPush()`, and the guard/auth/logging that `runSync()` used to hold inline
  moved into a shared `runCycle()` — so a push-only run gets the same overlap guard and the same
  consecutive-reauth-failure accounting rather than a parallel path that drifts from it. A test
  covers that specifically: two failed `runPush()` calls flip `needsReconnect` exactly as two failed
  `runSync()` calls do.
- `SyncPort` gained `runPush()` and `onLocalChange(listener)`. The latter is a notification rather
  than a push, so debouncing and the decision to sync at all stay with `useTabletSync`, which
  already owns every other trigger.
- The tablet adapter feeds that from the existing `wrapWithDirtyTracking` callback — the single
  place every port's writes already funnel through. Listener errors are swallowed there: a
  subscriber must never break the write that triggered it.
- `useTabletSync` debounces **4 seconds from the last write**, then calls `runPush()` through
  `useSyncStore`, so the app-bar indicator and status refresh behave identically to every other
  trigger. The interval, focus and visibility triggers are untouched and still run full cycles, so
  changes from other devices arrive on the same schedule as before.
- The app-bar indicator gained a pending state: `mdi-cloud-upload-outline` with a tooltip naming the
  count, instead of the reassuring check it used to show while changes sat queued.

`useTabletSync`'s doc comment now explains the reversal, since the old one stated the opposite
conclusion as settled and would otherwise mislead the next reader.

### Deliberately unchanged

- **Editor saves are still not synchronous.** A save marks dirty and returns; the upload follows a
  few seconds later. That is the right trade — blocking a save on a network round trip is worse than
  a short delay — and the pending indicator is what makes the delay legible.
- **The 5-minute interval stays.** It is now the safety net rather than the primary path.
