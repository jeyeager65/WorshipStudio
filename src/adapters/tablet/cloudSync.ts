/**
 * The tablet's sync engine — reconciles the local OPFS cache against whichever cloud storage
 * provider this device connected through (providers/dropbox.ts, providers/onedrive.ts), entirely
 * through the provider-agnostic CloudSyncProvider interface (providers/types.ts). Nothing in this
 * file knows which provider it's driving — see that interface's doc comment for what's already
 * been resolved before an entry or error ever reaches here.
 *
 * Operates entirely against a *raw* (non-dirty-tracked) FileSystemDirectoryHandle passed in as
 * `config.root`: applying a pulled remote change must never itself mark that path dirty (nothing
 * to push back for something that just came from the server), and a materialized conflict
 * artifact is a local-only marker, never meant to be pushed either — see adapters/tablet/index.ts
 * for how the raw root and the dirty-tracked root (handed to the ordinary web/*.ts ports instead)
 * are two different handles over the same OPFS directory. resolveConflict() below is handed that
 * same raw root by index.ts for the same reason: removing a conflict artifact (never itself
 * pushed) and rewriting the original file on a 'theirs' resolution (whose rev this module already
 * knows precisely) must not go through the generic dirty-tracking path a second time.
 */

import {
  ProviderApiError,
  ProviderReauthRequiredError,
  type CloudSyncProvider,
  type ProviderEntry,
  type ProviderWriteMode,
} from './providers/types'
import { syncStore, type ConflictEntry, type DirtyEntry } from './syncStore'
import { readBytes, removeFile, writeBytes, writeJsonFile } from '@/adapters/web/fsaStorage'
import type { SyncProgress } from '@/adapters/types'

/** Mirrors web/sync.ts's CONFLICT_PATTERN scope exactly — only paths under these top-level
 *  folders are ever scanned by detectConflicts(), so only pushes to these are worth
 *  materializing a conflict artifact for; anything else falls back to last-write-wins (see
 *  handlePushConflict below). */
const CONFLICT_SCANNED_TOP_DIRS = new Set(['songs', 'slides', 'media-items', 'themes', 'people', 'services'])

function isInConflictScannedScope(relativePath: string): boolean {
  const top = relativePath.split('/')[0]
  return top !== undefined && CONFLICT_SCANNED_TOP_DIRS.has(top)
}

/** Builds a filename that matches web/sync.ts's CONFLICT_PATTERN regex exactly, so the existing
 *  conflict-detection UI picks up artifacts this module writes with zero changes on that side. */
function conflictArtifactPath(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  const dir = slash === -1 ? '' : relativePath.slice(0, slash + 1)
  const filename = slash === -1 ? relativePath : relativePath.slice(slash + 1)
  const dot = filename.lastIndexOf('.')
  const stem = dot === -1 ? filename : filename.slice(0, dot)
  const ext = dot === -1 ? '' : filename.slice(dot)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `${dir}${stem} (conflicted copy ${stamp})${ext}`
}

// Exponential backoff with jitter, capped at 5 minutes — matches the plan's "per-path exponential
// backoff with jitter" for ordinary push failures (rate limits use a separate global cooldown).
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** attempts, 5 * 60_000) + Math.random() * 1_000
}

export interface CloudSyncConfig {
  provider: CloudSyncProvider
  /** The *raw*, non-dirty-tracked OPFS root — see this module's own doc comment for why. */
  root: FileSystemDirectoryHandle
  /** Files at or above this size never have their content pulled into this device's cache. */
  maxCachedFileSizeBytes: number
}

export function createCloudSync(config: CloudSyncConfig) {
  const { provider } = config
  let syncing = false
  // A rate limit stops the *whole* push pass, not just the one path that hit it — provider rate
  // limits are account-wide, so retrying a different path immediately would just draw another one.
  let cooldownUntil = 0
  // Set by requireToken() whenever the provider can't silently produce a token (e.g. OneDrive's
  // 24h SPA refresh-token cap) and cleared the next time it succeeds — surfaced via
  // getSyncStatus() so the UI can prompt a visible reconnect instead of pulls/pushes silently
  // failing forever.
  let needsReconnect = false
  // Live snapshot of whichever phase is currently running — set at the top of each loop
  // iteration in pull()/push() below and cleared once that phase finishes, so getProgress() (and
  // by extension stores/sync.ts's poll while syncing) always reflects real numbers rather than
  // just "a sync is happening somewhere."
  let progress: SyncProgress | undefined
  // De-duplicates concurrent requireToken() calls into the single in-flight request, rather than
  // each of pull()'s concurrent workers independently deciding a refresh is needed and firing its
  // own — confirmed on a real device this was a real risk, not theoretical: a 401 partway through
  // a sync that looked like a garbled/invalid token is consistent with two refresh_token grants
  // racing (Microsoft rotates the refresh token on every use, so the loser of that race is left
  // holding tokens the server already considers stale).
  let inFlightTokenRequest: Promise<string> | undefined

  /** Every call gets a currently-valid token, checked fresh — not just fetched once and reused for
   *  an entire pull()/push() batch, which is exactly how a long-running sync (rate-limit backoff
   *  especially can stretch one out) let the token quietly expire partway through on a real
   *  device, since nothing re-checked it until the *next* whole pull()/push() call. Cheap to call
   *  this often: provider.getValidAccessToken() only makes a network call when actually near
   *  expiry, otherwise it's just a local storage read (also cached now — see
   *  onedriveAuthStorage.ts/dropboxAuthStorage.ts). */
  async function requireToken(): Promise<string> {
    if (!inFlightTokenRequest) {
      inFlightTokenRequest = (async () => {
        try {
          const token = await provider.getValidAccessToken()
          needsReconnect = false
          return token
        } catch (error) {
          if (error instanceof ProviderReauthRequiredError) needsReconnect = true
          throw error
        }
      })()
    }
    const request = inFlightTokenRequest
    try {
      return await request
    } finally {
      if (inFlightTokenRequest === request) inFlightTokenRequest = undefined
    }
  }

  async function applyEntry(entry: ProviderEntry): Promise<void> {
    const relativePath = entry.path

    if (entry.tag === 'deleted') {
      const dirty = await syncStore.getDirty(relativePath)
      if (dirty) return // an unpushed local edit wins over a remote delete
      await removeFile(config.root, relativePath)
      await syncStore.clearRev(relativePath)
      return
    }

    const dirty = await syncStore.getDirty(relativePath)
    if (dirty) return // an unpushed local edit wins — don't let a pull clobber it

    const cachedRev = await syncStore.getRev(relativePath)
    if (cachedRev?.rev === entry.rev) return // unchanged since the last sync

    if (entry.sizeBytes >= config.maxCachedFileSizeBytes) {
      // Too big for this device's cache. Still record the rev so future pulls don't keep
      // re-checking it every cycle — the content itself is never downloaded. Any port reading
      // it (MediaPort.getPreviewUrl) already degrades to undefined for a missing file, same as
      // any other not-locally-available case, so nothing downstream needs to change for this.
      await syncStore.setRev(relativePath, {
        rev: entry.rev,
        contentHash: entry.contentHash,
        sizeBytes: entry.sizeBytes,
      })
      return
    }

    const token = await requireToken()
    const downloaded = await provider.download(token, relativePath)
    if (relativePath.endsWith('.json')) {
      const text = new TextDecoder().decode(downloaded.bytes)
      await writeJsonFile(config.root, relativePath, JSON.parse(text))
    } else {
      await writeBytes(config.root, relativePath, downloaded.bytes)
    }
    await syncStore.setRev(relativePath, {
      rev: downloaded.rev,
      contentHash: downloaded.contentHash,
      sizeBytes: downloaded.sizeBytes,
    })
  }

  // A handful of concurrent downloads rather than one file at a time — for many small files
  // (the common case: songs/services/slides are all tiny JSON), the dominant cost per file is
  // pure network round-trip latency, not bandwidth, so doing them strictly sequentially meant
  // wall-clock time scaled directly with file count (observed as ~1s per tiny file on a real
  // device). Kept modest — confirmed on a real device that 6 was enough to trip Microsoft Graph's
  // rate limiting for OneDrive (whose download() makes two requests per file, content plus a
  // separate metadata read, so 6 concurrent files was already up to 12 simultaneous requests).
  const PULL_CONCURRENCY = 3

  async function pull(): Promise<void> {
    const token = await requireToken()
    const cursor = await syncStore.getCursor()
    const page = await provider.listChanges(token, cursor)

    const total = page.entries.length
    let nextIndex = 0
    let completed = 0
    // Set the moment any worker hits a rate limit, checked by every worker (including ones
    // already mid-loop) before starting their next entry — stops the whole batch from continuing
    // to hammer the provider once one request has already been throttled, rather than letting
    // Promise.all's rejection just cut the *caller* loose while other workers keep firing.
    let rateLimitedAt: number | undefined

    async function runWorker(): Promise<void> {
      for (;;) {
        if (rateLimitedAt !== undefined) return
        const index = nextIndex++
        if (index >= total) return
        const entry = page.entries[index]!
        progress = { phase: 'pull', completed, total, currentPath: entry.path }
        try {
          await applyEntry(entry)
        } catch (error) {
          if (!(error instanceof ProviderApiError) || error.kind !== 'rate-limit') throw error
          cooldownUntil = Date.now() + (error.retryAfterSeconds ?? 60) * 1000
          rateLimitedAt = Date.now()
          return
        }
        completed++
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PULL_CONCURRENCY, total) }, () => runWorker()),
    )

    progress = undefined
    // A rate limit mid-batch leaves the cursor unadvanced on purpose — the next pull (the
    // automatic 5-minute retry, or the next app launch) re-fetches the same page with the same
    // cursor, but every entry already applied this time round is now rev-matched and skipped
    // without re-downloading, so only whatever didn't finish actually gets retried.
    if (rateLimitedAt === undefined) {
      await syncStore.setCursor(page.cursor)
      await syncStore.setLastSyncedAt(new Date().toISOString())
    }
  }

  /** A push landed a conflict (the remote rev moved since this device last saw it). Downloads the
   *  current remote content once and either materializes a conflict artifact (in-scope paths,
   *  left for the user to resolve via the existing conflict UI) or adopts the new rev and retries
   *  immediately (out-of-scope paths — nothing ever scans for an artifact there, so last-write-
   *  wins is the accepted behavior; see the plan's "Conflict on push" section). */
  async function handlePushConflict(token: string, relativePath: string): Promise<void> {
    const remote = await provider.download(token, relativePath)

    if (isInConflictScannedScope(relativePath)) {
      const artifactPath = conflictArtifactPath(relativePath)
      if (artifactPath.endsWith('.json')) {
        await writeJsonFile(config.root, artifactPath, JSON.parse(new TextDecoder().decode(remote.bytes)))
      } else {
        await writeBytes(config.root, artifactPath, remote.bytes)
      }
      const conflict: ConflictEntry = {
        conflictFilePath: artifactPath,
        remoteRev: remote.rev,
        remoteContentHash: remote.contentHash,
        remoteSizeBytes: remote.sizeBytes,
      }
      await syncStore.setConflict(relativePath, conflict)
      // Dirty stays set — still needs pushing once resolveConflict() below clears this entry —
      // but push() skips any path with an open conflict, so this won't retry (and re-conflict)
      // every cycle in the meantime.
      return
    }

    await syncStore.setRev(relativePath, {
      rev: remote.rev,
      contentHash: remote.contentHash,
      sizeBytes: remote.sizeBytes,
    })
    const freshBytes = await readBytes(config.root, relativePath)
    if (freshBytes === null) {
      // The path was deleted locally in the time it took to detect this conflict — nothing left
      // to retry pushing.
      await syncStore.clearDirty(relativePath)
      return
    }
    const retried = await provider.upload(token, relativePath, freshBytes, { updateRev: remote.rev })
    await syncStore.setRev(relativePath, {
      rev: retried.rev,
      contentHash: retried.contentHash,
      sizeBytes: retried.sizeBytes,
    })
    await syncStore.clearDirty(relativePath)
  }

  async function pushOne(relativePath: string): Promise<void> {
    const entry = await syncStore.getDirty(relativePath)
    if (!entry) return
    const token = await requireToken()

    if (entry.deleted) {
      // The provider already treats "already gone" as success, so a real conflict here (someone
      // else edited what we're deleting) just silently removes their edit too — an accepted
      // last-write-wins gap for deletes, matching this design's existing gap for out-of-scope-
      // path conflicts above.
      await provider.deleteFile(token, relativePath)
      await syncStore.clearDirty(relativePath)
      await syncStore.clearRev(relativePath)
      return
    }

    const bytes = await readBytes(config.root, relativePath)
    if (bytes === null) {
      // Written then deleted again locally before this ever got pushed — nothing to upload.
      const cachedRev = await syncStore.getRev(relativePath)
      if (cachedRev) {
        await provider.deleteFile(token, relativePath)
        await syncStore.clearRev(relativePath)
      }
      await syncStore.clearDirty(relativePath)
      return
    }

    const cachedRev = await syncStore.getRev(relativePath)
    const mode: ProviderWriteMode = cachedRev ? { updateRev: cachedRev.rev } : 'add'
    try {
      const uploaded = await provider.upload(token, relativePath, bytes, mode)
      await syncStore.setRev(relativePath, {
        rev: uploaded.rev,
        contentHash: uploaded.contentHash,
        sizeBytes: uploaded.sizeBytes,
      })
      await syncStore.clearDirty(relativePath)
    } catch (error) {
      if (!(error instanceof ProviderApiError) || error.kind !== 'conflict') throw error
      await handlePushConflict(token, relativePath)
    }
  }

  async function push(): Promise<void> {
    if (Date.now() < cooldownUntil) return
    const now = Date.now()
    const allDirty = await syncStore.getAllDirty()
    let completed = 0
    for (const [relativePath, entry] of allDirty) {
      if (entry.nextRetryAt > now) {
        completed++
        continue
      }
      if (await syncStore.getConflict(relativePath)) {
        completed++
        continue // waiting on resolveConflict()
      }
      if (Date.now() < cooldownUntil) break

      progress = { phase: 'push', completed, total: allDirty.length, currentPath: relativePath }
      try {
        await pushOne(relativePath)
      } catch (error) {
        if (error instanceof ProviderApiError && error.kind === 'rate-limit') {
          cooldownUntil = Date.now() + (error.retryAfterSeconds ?? 60) * 1000
          break
        }
        const attempts = entry.attempts + 1
        const retried: DirtyEntry = { ...entry, attempts, nextRetryAt: Date.now() + backoffMs(attempts) }
        await syncStore.setDirty(relativePath, retried)
      }
      completed++
    }
    progress = undefined
  }

  /** Applies the user's keep/discard choice from the (unmodified) web conflict-resolution UI back
   *  to this module's own rev/dirty bookkeeping. `conflictFilePath` is matched against every open
   *  conflict this module tracks rather than derived from the filename, so it stays correct even
   *  if web/sync.ts's artifact-naming convention ever changes. index.ts calls this *after* the
   *  raw-root file rewrite/removal (see web/sync.ts's resolveConflict) so this always has the
   *  final say on dirty/rev state. */
  async function resolveConflict(conflictFilePath: string, keep: 'mine' | 'theirs'): Promise<void> {
    const found = (await syncStore.getAllConflicts()).find(
      ([, entry]) => entry.conflictFilePath === conflictFilePath,
    )
    if (!found) return
    const [relativePath, conflict] = found
    await syncStore.clearConflict(relativePath)
    await syncStore.setRev(relativePath, {
      rev: conflict.remoteRev,
      contentHash: conflict.remoteContentHash,
      sizeBytes: conflict.remoteSizeBytes,
    })
    // 'mine': the local edit is still queued to push, now against the rev just learned above so
    // the next attempt's conditional write succeeds instead of conflicting again. 'theirs': local
    // content now equals what's already on the provider at that rev, so there's nothing left to
    // push.
    if (keep === 'theirs') await syncStore.clearDirty(relativePath)
  }

  async function runSync(): Promise<void> {
    if (syncing) return
    syncing = true
    try {
      await pull()
      await push()
    } finally {
      syncing = false
    }
  }

  /** Clears this device's sync bookkeeping (cursor/dirty/rev/conflict) and re-pulls the whole
   *  library, overwriting every file this device already has with a fresh copy from the cloud —
   *  as close to "as if this were a brand-new device" as it's safe to get. Exists for two real
   *  cases: making the from-scratch sync path (BootGate.vue's initial-sync screen) repeatable for
   *  testing without reconnecting a fresh device each time, and as a deliberate "trust the cloud,
   *  discard whatever's wrong locally" recovery lever if this device's cache ever ends up in a
   *  bad state.
   *
   *  Deliberately does NOT delete local files before pulling (an earlier version did) and does
   *  NOT push afterward (ditto) — confirmed on a real device that pre-deleting created a window
   *  where library-settings.json was genuinely missing on disk, long enough for another
   *  already-open page to read it, get defaultLibrarySettings() back, and save that default over
   *  the real thing; the trailing push() then happily uploaded it, clobbering the shared library
   *  config for every device with no conflict UI ever catching it (library-settings.json sits
   *  outside CONFLICT_SCANNED_TOP_DIRS, so a push "conflict" there is last-write-wins by design).
   *  Clearing the cursor/revs alone already forces pull() to treat every remote entry as changed
   *  and overwrite it via the same atomic temp-file-then-move write fsaStorage.ts's fallback path
   *  uses — a concurrent reader sees the old content or the new content, never a missing file. The
   *  one thing this no longer does that the old version did: a file this device deleted from the
   *  cloud *before* this reset, and never resynced, won't get locally cleaned up (a full listing
   *  has no way to report a deletion that already happened) — an accepted, far smaller gap than
   *  the corruption risk it replaces. Any not-yet-pushed local edit on this device is still
   *  discarded (its dirty flag is cleared along with everything else, and nothing is pushed) —
   *  callers must make that tradeoff explicit to the operator before calling this (see
   *  LibrarySyncSection.vue's confirmation dialog). */
  async function resetAndResync(): Promise<void> {
    if (syncing) return
    syncing = true
    try {
      await syncStore.clearAll()
      await pull()
    } finally {
      syncing = false
    }
  }

  async function getSyncStatus(): Promise<{
    lastSyncedAt?: string
    pendingPushCount: number
    needsReconnect: boolean
  }> {
    const [lastSyncedAt, dirty] = await Promise.all([
      syncStore.getLastSyncedAt(),
      syncStore.getAllDirty(),
    ])
    return { lastSyncedAt, pendingPushCount: dirty.length, needsReconnect }
  }

  async function getProgress(): Promise<SyncProgress | undefined> {
    return progress
  }

  return { pull, push, runSync, resetAndResync, getSyncStatus, getProgress, resolveConflict }
}
