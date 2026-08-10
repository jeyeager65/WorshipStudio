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

  async function requireToken(): Promise<string> {
    try {
      const token = await provider.getValidAccessToken()
      needsReconnect = false
      return token
    } catch (error) {
      if (error instanceof ProviderReauthRequiredError) needsReconnect = true
      throw error
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

  async function pull(): Promise<void> {
    const token = await requireToken()
    const cursor = await syncStore.getCursor()
    const page = await provider.listChanges(token, cursor)

    for (const entry of page.entries) {
      await applyEntry(entry)
    }
    await syncStore.setCursor(page.cursor)
    await syncStore.setLastSyncedAt(new Date().toISOString())
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

  async function pushOne(token: string, relativePath: string): Promise<void> {
    const entry = await syncStore.getDirty(relativePath)
    if (!entry) return

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
    const token = await requireToken()
    const now = Date.now()
    for (const [relativePath, entry] of await syncStore.getAllDirty()) {
      if (entry.nextRetryAt > now) continue
      if (await syncStore.getConflict(relativePath)) continue // waiting on resolveConflict()
      if (Date.now() < cooldownUntil) break

      try {
        await pushOne(token, relativePath)
      } catch (error) {
        if (error instanceof ProviderApiError && error.kind === 'rate-limit') {
          cooldownUntil = Date.now() + (error.retryAfterSeconds ?? 60) * 1000
          break
        }
        const attempts = entry.attempts + 1
        const retried: DirtyEntry = { ...entry, attempts, nextRetryAt: Date.now() + backoffMs(attempts) }
        await syncStore.setDirty(relativePath, retried)
      }
    }
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

  return { pull, push, runSync, getSyncStatus, resolveConflict }
}
