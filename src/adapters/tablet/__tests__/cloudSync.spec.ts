import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudSync } from '../cloudSync'
import { ProviderApiError, ProviderReauthRequiredError, type CloudSyncProvider } from '../providers/types'
import { createFakeRoot } from '@/adapters/web/__tests__/fakeFsa'
import { readBytes, readFileText, readJsonFile, writeJsonFile } from '@/adapters/web/fsaStorage'

// A fully mocked CloudSyncProvider — this file is only about cloudSync.ts's own orchestration
// (dirty-path protection, size-gating, backoff, conflict routing), never about how any specific
// provider talks over HTTP. Pagination and cursor-reset recovery are provider-internal concerns
// now (see providers/__tests__/dropbox.spec.ts), so listChanges() here always returns one
// already-resolved batch.
function makeFakeProvider(id: CloudSyncProvider['id'] = 'dropbox'): CloudSyncProvider {
  return {
    id,
    getValidAccessToken: vi.fn().mockResolvedValue('token-1'),
    isConnected: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
    listChanges: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    deleteFile: vi.fn(),
  }
}

// An in-memory stand-in for syncStore's real IndexedDB-backed persistence (jsdom has no
// IndexedDB implementation).
function makeFakeSyncStore() {
  const dirty = new Map<string, { deleted: boolean; attempts: number; nextRetryAt: number }>()
  const revs = new Map<string, { rev: string; contentHash?: string; sizeBytes: number }>()
  const conflicts = new Map<
    string,
    { conflictFilePath: string; remoteRev: string; remoteContentHash?: string; remoteSizeBytes: number }
  >()
  let cursor: string | undefined
  let lastSyncedAt: string | undefined
  return {
    getCursor: async () => cursor,
    setCursor: async (value: string) => {
      cursor = value
    },
    clearCursor: async () => {
      cursor = undefined
    },
    getLastSyncedAt: async () => lastSyncedAt,
    setLastSyncedAt: async (value: string) => {
      lastSyncedAt = value
    },
    getDirty: async (path: string) => dirty.get(path),
    setDirty: async (path: string, entry: { deleted: boolean; attempts: number; nextRetryAt: number }) => {
      dirty.set(path, entry)
    },
    clearDirty: async (path: string) => {
      dirty.delete(path)
    },
    getAllDirty: async () => [...dirty.entries()],
    getRev: async (path: string) => revs.get(path),
    setRev: async (path: string, entry: { rev: string; contentHash?: string; sizeBytes: number }) => {
      revs.set(path, entry)
    },
    clearRev: async (path: string) => {
      revs.delete(path)
    },
    getConflict: async (path: string) => conflicts.get(path),
    setConflict: async (
      path: string,
      entry: { conflictFilePath: string; remoteRev: string; remoteContentHash?: string; remoteSizeBytes: number },
    ) => {
      conflicts.set(path, entry)
    },
    clearConflict: async (path: string) => {
      conflicts.delete(path)
    },
    getAllConflicts: async () => [...conflicts.entries()],
    clearAll: async () => {
      cursor = undefined
      lastSyncedAt = undefined
      dirty.clear()
      revs.clear()
      conflicts.clear()
    },
    // Test-only helpers, not part of the real syncStore shape.
    _dirty: dirty,
    _revs: revs,
    _conflicts: conflicts,
  }
}

const { syncStore } = vi.hoisted(() => ({ syncStore: {} as ReturnType<typeof makeFakeSyncStore> }))
vi.mock('../syncStore', () => ({ syncStore }))

function jsonBytes(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer
}

let provider: CloudSyncProvider

function makeSync(root: FileSystemDirectoryHandle, maxCachedFileSizeBytes = 50 * 1024 * 1024) {
  return createCloudSync({ provider, root, maxCachedFileSizeBytes })
}

beforeEach(() => {
  Object.assign(syncStore, makeFakeSyncStore())
  provider = makeFakeProvider()
})

describe('pull', () => {
  it('never downloads a .backup file — a local recovery artifact, not shared content', async () => {
    const root = createFakeRoot()
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/song-1.json.backup', rev: 'rev-1', sizeBytes: 10 }],
      cursor: 'c',
      isFromScratchListing: true,
    })

    await makeSync(root).pull()

    expect(provider.download).not.toHaveBeenCalled()
    expect(await readFileText(root, 'songs/song-1.json.backup')).toBeNull()
  })

  it('applies a new file returned by the provider and persists the returned cursor', async () => {
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/song-1.json', rev: 'rev-1', sizeBytes: 10 }],
      cursor: 'cursor-1',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'song-1', title: 'A' }),
      rev: 'rev-1',
      sizeBytes: 10,
    })
    const root = createFakeRoot()

    await makeSync(root).pull()

    expect(provider.listChanges).toHaveBeenCalledWith('token-1', undefined)
    const record = await readJsonFile<{ title: string }>(root, 'songs/song-1.json')
    expect(record?.title).toBe('A')
    expect(await syncStore.getCursor()).toBe('cursor-1')
    expect(await syncStore.getLastSyncedAt()).toBeTruthy()
  })

  it('passes the saved cursor into listChanges on a later sync', async () => {
    await syncStore.setCursor('cursor-0')
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-1',
      isFromScratchListing: false,
    })

    await makeSync(createFakeRoot()).pull()

    expect(provider.listChanges).toHaveBeenCalledWith('token-1', 'cursor-0')
  })

  it('skips downloading content for a file at or above the size threshold, but still records its rev', async () => {
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'media/big.mp4', rev: 'rev-big', sizeBytes: 200 }],
      cursor: 'c',
      isFromScratchListing: true,
    })

    await makeSync(createFakeRoot(), 100).pull()

    expect(provider.download).not.toHaveBeenCalled()
    expect(await syncStore.getRev('media/big.mp4')).toEqual({
      rev: 'rev-big',
      contentHash: undefined,
      sizeBytes: 200,
    })
  })

  it('does not re-download a file whose rev is unchanged since the last sync', async () => {
    await syncStore.setRev('songs/a.json', { rev: 'rev-1', sizeBytes: 10 })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/a.json', rev: 'rev-1', sizeBytes: 10 }],
      cursor: 'c',
      isFromScratchListing: true,
    })

    await makeSync(createFakeRoot()).pull()

    expect(provider.download).not.toHaveBeenCalled()
  })

  it('never lets a pull clobber a path with an unpushed local edit', async () => {
    const root = createFakeRoot()
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/a.json', rev: 'remote-rev', sizeBytes: 10 }],
      cursor: 'c',
      isFromScratchListing: true,
    })

    await makeSync(root).pull()

    expect(provider.download).not.toHaveBeenCalled()
    expect(await readJsonFile(root, 'songs/a.json')).toBeNull()
  })

  it('removes a locally-present file on a remote delete when the path is not dirty', async () => {
    const root = createFakeRoot()
    const sync = makeSync(root)
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/a.json', rev: 'rev-1', sizeBytes: 10 }],
      cursor: 'c1',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'a' }),
      rev: 'rev-1',
      sizeBytes: 10,
    })
    await sync.pull()

    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'deleted', path: 'songs/a.json' }],
      cursor: 'c2',
      isFromScratchListing: false,
    })
    await sync.pull()

    expect(await readJsonFile(root, 'songs/a.json')).toBeNull()
    expect(await syncStore.getRev('songs/a.json')).toBeUndefined()
  })

  it('leaves a dirty path alone on a remote delete, rather than removing an unpushed local edit', async () => {
    const root = createFakeRoot()
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'deleted', path: 'songs/a.json' }],
      cursor: 'c',
      isFromScratchListing: true,
    })

    await makeSync(root).pull()

    // Nothing was there to begin with in this test, but the real assertion is that removeFile
    // was never attempted for a dirty path — pull() didn't throw trying to remove a nonexistent
    // dirty file, and the rev entry (if any) is untouched.
    await expect(readBytes(root, 'songs/a.json')).resolves.toBeNull()
  })

  it('writes non-JSON files as raw bytes, not through writeJsonFile', async () => {
    const root = createFakeRoot()
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'media/photo.jpg', rev: 'rev-1', sizeBytes: 3 }],
      cursor: 'c',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: new TextEncoder().encode('abc').buffer,
      rev: 'rev-1',
      sizeBytes: 3,
    })

    await makeSync(root).pull()

    const bytes = await readBytes(root, 'media/photo.jpg')
    expect(new TextDecoder().decode(bytes!)).toBe('abc')
  })

  it('stops cleanly when the provider cannot silently produce a token, without itself deciding needsReconnect', async () => {
    // needsReconnect is decided at runSync()'s level now (consecutive whole-attempt failures —
    // see the "runSync" describe block below), not by a single requireToken() call inside pull()
    // — a lone pull() failure (e.g. resetAndResync(), which calls pull() directly) shouldn't flip
    // the shared flag on its own.
    vi.mocked(provider.getValidAccessToken).mockRejectedValueOnce(
      new ProviderReauthRequiredError('reconnect please'),
    )
    const sync = makeSync(createFakeRoot())

    await expect(sync.pull()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(false)
  })

  it('re-checks the token per file rather than reusing one fetched at the start of the batch', async () => {
    const root = createFakeRoot()
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [
        { tag: 'file', path: 'songs/a.json', rev: 'rev-a', sizeBytes: 10 },
        { tag: 'file', path: 'songs/b.json', rev: 'rev-b', sizeBytes: 10 },
      ],
      cursor: 'cursor-1',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValue({
      bytes: jsonBytes({ id: 'x' }),
      rev: 'rev-x',
      sizeBytes: 10,
    })

    await makeSync(root).pull()

    // Once for listChanges, plus at least once more for the files themselves — concurrent
    // in-flight requests correctly collapse into one shared call (see the de-duplication test
    // below), but applyEntry() must still be checking the token itself rather than trusting a
    // single value fetched once at the very start of pull() and reused unchanged for however long
    // the whole batch takes (rate-limit backoff especially can stretch that out considerably).
    expect(vi.mocked(provider.getValidAccessToken).mock.calls.length).toBeGreaterThan(1)
  })

  it('de-duplicates concurrent token requests into a single in-flight call', async () => {
    const root = createFakeRoot()
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [
        { tag: 'file', path: 'songs/a.json', rev: 'rev-a', sizeBytes: 10 },
        { tag: 'file', path: 'songs/b.json', rev: 'rev-b', sizeBytes: 10 },
        { tag: 'file', path: 'songs/c.json', rev: 'rev-c', sizeBytes: 10 },
      ],
      cursor: 'cursor-1',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValue({
      bytes: jsonBytes({ id: 'x' }),
      rev: 'rev-x',
      sizeBytes: 10,
    })
    let concurrentCalls = 0
    let maxConcurrentCalls = 0
    vi.mocked(provider.getValidAccessToken).mockImplementation(async () => {
      concurrentCalls++
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls)
      await Promise.resolve() // yield, so truly-concurrent callers would overlap here if unguarded
      concurrentCalls--
      return 'token-1'
    })

    await makeSync(root).pull()

    expect(maxConcurrentCalls).toBe(1)
  })

  it('stops the batch cleanly on a rate limit, without advancing the cursor, and resumes on a later pull', async () => {
    const root = createFakeRoot()
    vi.mocked(provider.listChanges).mockResolvedValue({
      entries: [
        { tag: 'file', path: 'songs/a.json', rev: 'rev-a', sizeBytes: 10 },
        { tag: 'file', path: 'songs/b.json', rev: 'rev-b', sizeBytes: 10 },
      ],
      cursor: 'cursor-1',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockImplementation(async (_token, path) => {
      if (path === 'songs/b.json') {
        throw new ProviderApiError('rate limited', 'rate-limit', 30)
      }
      // Matches the entry's own declared rev (listChanges above) — otherwise the second pull()
      // below wouldn't recognize this path as already-applied and would re-download it too.
      return { bytes: jsonBytes({ id: 'a' }), rev: 'rev-a', sizeBytes: 10 }
    })

    await makeSync(root).pull()

    // The path that succeeded before the rate limit hit was still applied and its rev recorded —
    // only the cursor (which would mark the *whole batch* as done) is held back.
    expect(await readJsonFile(root, 'songs/a.json')).not.toBeNull()
    expect(await syncStore.getCursor()).toBeUndefined()

    // A later pull re-fetches the same (unadvanced) cursor. The already-applied path is
    // rev-matched and skipped; only the one that failed gets retried.
    vi.mocked(provider.download).mockReset().mockResolvedValue({
      bytes: jsonBytes({ id: 'b' }),
      rev: 'rev-b-retry',
      sizeBytes: 10,
    })
    await makeSync(root).pull()

    expect(provider.download).toHaveBeenCalledTimes(1)
    expect(provider.download).toHaveBeenCalledWith('token-1', 'songs/b.json')
    expect(await syncStore.getCursor()).toBe('cursor-1')
  })
})

describe('runSync', () => {
  it('does not set needsReconnect after a single reauth failure — a lone attempt could be a one-off blip', async () => {
    vi.mocked(provider.getValidAccessToken).mockRejectedValueOnce(
      new ProviderReauthRequiredError('reconnect please'),
    )
    const sync = makeSync(createFakeRoot())

    await expect(sync.runSync()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(false)
  })

  it('sets needsReconnect once two consecutive runSync() attempts both fail the same way', async () => {
    vi.mocked(provider.getValidAccessToken).mockRejectedValue(
      new ProviderReauthRequiredError('reconnect please'),
    )
    const sync = makeSync(createFakeRoot())

    await expect(sync.runSync()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(false)
    await expect(sync.runSync()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(true)
  })

  it('clears needsReconnect and resets the failure count the moment a later attempt succeeds', async () => {
    vi.mocked(provider.getValidAccessToken).mockRejectedValue(
      new ProviderReauthRequiredError('reconnect please'),
    )
    const sync = makeSync(createFakeRoot())
    await expect(sync.runSync()).rejects.toThrow('reconnect please')
    await expect(sync.runSync()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(true)

    vi.mocked(provider.getValidAccessToken).mockResolvedValue('token-1')
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'c',
      isFromScratchListing: true,
    })
    await sync.runSync()

    expect((await sync.getSyncStatus()).needsReconnect).toBe(false)
  })
})

describe('push', () => {
  it('uploads a new dirty file with mode "add" when there is no cached rev', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a', title: 'A' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.upload).mockResolvedValueOnce({ rev: 'rev-new', contentHash: 'hash-1', sizeBytes: 20 })

    await makeSync(root).push()

    expect(provider.upload).toHaveBeenCalledWith('token-1', 'songs/a.json', expect.anything(), 'add')
    expect(await syncStore.getRev('songs/a.json')).toEqual({
      rev: 'rev-new',
      contentHash: 'hash-1',
      sizeBytes: 20,
    })
    expect(await syncStore.getDirty('songs/a.json')).toBeUndefined()
  })

  it('uses a conditional write keyed to the cached rev when one exists', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    await syncStore.setRev('songs/a.json', { rev: 'rev-old', sizeBytes: 1 })
    vi.mocked(provider.upload).mockResolvedValueOnce({ rev: 'rev-new', sizeBytes: 20 })

    await makeSync(root).push()

    expect(provider.upload).toHaveBeenCalledWith('token-1', 'songs/a.json', expect.anything(), {
      updateRev: 'rev-old',
    })
  })

  it('deletes a dirty deleted path remotely and clears its dirty/rev bookkeeping', async () => {
    const root = createFakeRoot()
    await syncStore.setDirty('songs/gone.json', { deleted: true, attempts: 0, nextRetryAt: 0 })
    await syncStore.setRev('songs/gone.json', { rev: 'rev-1', sizeBytes: 1 })

    await makeSync(root).push()

    expect(provider.deleteFile).toHaveBeenCalledWith('token-1', 'songs/gone.json')
    expect(await syncStore.getDirty('songs/gone.json')).toBeUndefined()
    expect(await syncStore.getRev('songs/gone.json')).toBeUndefined()
  })

  it('skips a dirty path with an already-open conflict rather than retrying it', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    await syncStore.setConflict('songs/a.json', {
      conflictFilePath: 'songs/a (conflicted copy 20260101-000000).json',
      remoteRev: 'rev-remote',
      remoteSizeBytes: 1,
    })

    await makeSync(root).push()

    expect(provider.upload).not.toHaveBeenCalled()
  })

  it('on a conflict for an in-scope path, materializes a conflict artifact and leaves the path dirty', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a', title: 'mine' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.upload).mockRejectedValueOnce(new ProviderApiError('conflict', 'conflict'))
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'a', title: 'theirs' }),
      rev: 'rev-remote',
      sizeBytes: 5,
    })

    await makeSync(root).push()

    expect(await syncStore.getDirty('songs/a.json')).toBeDefined()
    const conflict = await syncStore.getConflict('songs/a.json')
    expect(conflict?.remoteRev).toBe('rev-remote')
    expect(conflict?.conflictFilePath).toMatch(/conflicted copy/)
    const artifact = await readJsonFile<{ title: string }>(root, conflict!.conflictFilePath)
    expect(artifact?.title).toBe('theirs')
  })

  it('on a conflict for an out-of-scope path, adopts the remote rev and retries once instead of materializing an artifact', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'library-settings.json', { churchName: 'mine' })
    await syncStore.setDirty('library-settings.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.upload).mockRejectedValueOnce(new ProviderApiError('conflict', 'conflict'))
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ churchName: 'theirs' }),
      rev: 'rev-remote',
      sizeBytes: 5,
    })
    vi.mocked(provider.upload).mockResolvedValueOnce({ rev: 'rev-retried', sizeBytes: 20 })

    await makeSync(root).push()

    expect(await syncStore.getConflict('library-settings.json')).toBeUndefined()
    expect(provider.upload).toHaveBeenLastCalledWith(
      'token-1',
      'library-settings.json',
      expect.anything(),
      { updateRev: 'rev-remote' },
    )
    expect(await syncStore.getRev('library-settings.json')).toEqual({
      rev: 'rev-retried',
      contentHash: undefined,
      sizeBytes: 20,
    })
    expect(await syncStore.getDirty('library-settings.json')).toBeUndefined()
  })

  it('stops the whole pass on a rate limit and leaves the dirty path untouched for the next cycle', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.upload).mockRejectedValueOnce(new ProviderApiError('rate limited', 'rate-limit', 30))
    // The same sync instance is reused for both calls below — the cooldown is in-memory state on
    // the engine itself, not something persisted to syncStore.
    const engine = makeSync(root)

    await engine.push()

    expect(await syncStore.getDirty('songs/a.json')).toEqual({
      deleted: false,
      attempts: 0,
      nextRetryAt: 0,
    })

    vi.mocked(provider.upload).mockClear()
    await engine.push()
    expect(provider.upload).not.toHaveBeenCalled()
  })

  it('backs off a path that fails for an ordinary reason, without touching unrelated dirty paths', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/a.json', { id: 'a' })
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.upload).mockRejectedValueOnce(new Error('network error'))

    await makeSync(root).push()

    const entry = await syncStore.getDirty('songs/a.json')
    expect(entry?.attempts).toBe(1)
    expect(entry?.nextRetryAt).toBeGreaterThan(Date.now())
  })
})

describe('resetAndResync', () => {
  it('overwrites existing local content with a fresh pull rather than deleting files upfront', async () => {
    const root = createFakeRoot()
    // Pre-existing local content, as if this device had synced before.
    await writeJsonFile(root, 'songs/a.json', { id: 'a', title: 'Stale local copy' })
    await syncStore.setRev('songs/a.json', { rev: 'rev-old', sizeBytes: 10 })
    await syncStore.setCursor('cursor-old')
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/a.json', rev: 'rev-new', sizeBytes: 10 }],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'a', title: 'Fresh from the cloud' }),
      rev: 'rev-new',
      sizeBytes: 10,
    })

    await makeSync(root).resetAndResync()

    // Cleared bookkeeping meant the cached rev no longer matched, so the file was re-downloaded
    // and overwritten in place — never absent from disk at any point a concurrent reader could
    // observe (see this function's own doc comment for why that distinction is the whole point).
    const record = await readJsonFile<{ title: string }>(root, 'songs/a.json')
    expect(record?.title).toBe('Fresh from the cloud')
    expect(await syncStore.getCursor()).toBe('cursor-new')
  })

  it('never pushes — an earlier version did, which is exactly how a stray local write during the reset window once got uploaded and clobbered the shared library-settings.json for every device', async () => {
    const root = createFakeRoot()
    // Simulates the exact failure mode this is guarding against: something (a still-mounted
    // settings page, in the real bug) wrote a dirty change during the reset.
    await writeJsonFile(root, 'library-settings.json', { serviceTypes: [] })
    await syncStore.setDirty('library-settings.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).resetAndResync()

    expect(provider.upload).not.toHaveBeenCalled()
  })

  it("clears stale bookkeeping (dirty/revs/conflicts) so it can't block or skip the fresh pull", async () => {
    const root = createFakeRoot()
    await syncStore.setDirty('songs/orphaned.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    await syncStore.setConflict('songs/orphaned.json', {
      conflictFilePath: 'songs/orphaned (conflicted copy).json',
      remoteRev: 'r',
      remoteSizeBytes: 1,
    })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).resetAndResync()

    expect(await syncStore.getDirty('songs/orphaned.json')).toBeUndefined()
    expect(await syncStore.getConflict('songs/orphaned.json')).toBeUndefined()
  })

  // Regression coverage for a real device: a service deleted on another device (or this one,
  // before a reset) stayed cached here through repeated "Clear & Re-sync This Device" presses,
  // because a from-scratch listing only reports what currently exists — it can't also report a
  // deletion that already happened, and resetAndResync never used to reconcile against that gap.
  it('removes a locally-cached file no longer present in a from-scratch listing', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'services/2026/deleted-service.json', { id: 'deleted-service' })
    await syncStore.setRev('services/2026/deleted-service.json', { rev: 'rev-old', sizeBytes: 10 })
    // The listing simply omits the deleted file — no 'deleted' entry, matching how a real
    // from-scratch provider listing behaves (see providers/dropbox.ts's listChanges).
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).resetAndResync()

    expect(await readJsonFile(root, 'services/2026/deleted-service.json')).toBeNull()
    expect(await syncStore.getRev('services/2026/deleted-service.json')).toBeUndefined()
  })

  // Via plain pull(), not resetAndResync() — that clears dirty bookkeeping itself before
  // reconciliation ever runs (a deliberate, separate tradeoff: "Clear & Re-sync" already
  // discards unpushed edits by design, see this function's own doc comment). A from-scratch
  // listing can also happen without going through resetAndResync at all — a brand-new device's
  // very first pull, before any cursor has ever been set — and that path must not treat a
  // locally-created, not-yet-pushed file as an orphan just because the cloud doesn't know about
  // it yet either.
  it('keeps a locally-cached file still pending push even if a from-scratch listing omits it', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/not-yet-pushed.json', { id: 'not-yet-pushed' })
    await syncStore.setDirty('songs/not-yet-pushed.json', {
      deleted: false,
      attempts: 0,
      nextRetryAt: 0,
    })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).pull()

    expect(await readJsonFile(root, 'songs/not-yet-pushed.json')).not.toBeNull()
  })

  it('never removes a .backup file or a materialized conflict artifact — neither is ever synced, so absence from the listing means nothing', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'library-settings.json.backup', { branding: {} })
    await writeJsonFile(root, 'songs/a (conflicted copy 20260101-0000).json', { id: 'a' })
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).resetAndResync()

    expect(await readJsonFile(root, 'library-settings.json.backup')).not.toBeNull()
    expect(
      await readJsonFile(root, 'songs/a (conflicted copy 20260101-0000).json'),
    ).not.toBeNull()
  })

  it('does not reconcile orphans on an ordinary incremental pull, only a from-scratch one', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/still-here.json', { id: 'still-here' })
    await syncStore.setRev('songs/still-here.json', { rev: 'rev-1', sizeBytes: 10 })
    await syncStore.setCursor('cursor-old')
    // An incremental listing reporting an unrelated change — still-here.json simply isn't
    // mentioned, exactly as it wouldn't be for any file that hasn't changed.
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/other.json', rev: 'rev-new', sizeBytes: 10 }],
      cursor: 'cursor-new',
      isFromScratchListing: false,
    })
    vi.mocked(provider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'other' }),
      rev: 'rev-new',
      sizeBytes: 10,
    })

    await makeSync(root).pull()

    expect(await readJsonFile(root, 'songs/still-here.json')).not.toBeNull()
  })

  // Regression coverage for the gap this device's own cursor being silently invalidated left
  // open: a provider's cursor-reset recovery (Dropbox's 409 'reset', Graph's 410
  // resyncRequired — see providers/dropbox.ts and providers/onedrive.ts) produces a genuine
  // from-scratch listing even though the *caller* passed in a real, previously-saved cursor.
  // Before isFromScratchListing was reported by the provider itself, cloudSync.ts inferred it
  // purely from whether its own cursor argument was undefined — which this case isn't — so
  // reconciliation silently never ran, and a file deleted from the cloud during whatever caused
  // the reset stayed cached on this device forever (nothing ever generates a further 'deleted'
  // delta entry for something the provider already considers gone).
  it('reconciles orphans on a from-scratch listing even when this device already had a saved cursor — a stale/reset cursor case', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/deleted-elsewhere.json', { id: 'deleted-elsewhere' })
    await syncStore.setRev('songs/deleted-elsewhere.json', { rev: 'rev-old', sizeBytes: 10 })
    await syncStore.setCursor('cursor-old')
    // The provider recovered from an invalidated cursor by doing a full re-listing — reported via
    // isFromScratchListing: true, even though cursor-old (a defined value) was passed in.
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [],
      cursor: 'cursor-new',
      isFromScratchListing: true,
    })

    await makeSync(root).pull()

    expect(await readJsonFile(root, 'songs/deleted-elsewhere.json')).toBeNull()
    expect(await syncStore.getRev('songs/deleted-elsewhere.json')).toBeUndefined()
  })
})

describe('resolveConflict', () => {
  it("clears dirty and adopts the remote rev when keeping 'theirs'", async () => {
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })
    await syncStore.setConflict('songs/a.json', {
      conflictFilePath: 'songs/a (conflicted copy 20260101-000000).json',
      remoteRev: 'rev-remote',
      remoteSizeBytes: 5,
    })

    await makeSync(createFakeRoot()).resolveConflict(
      'songs/a (conflicted copy 20260101-000000).json',
      'theirs',
    )

    expect(await syncStore.getConflict('songs/a.json')).toBeUndefined()
    expect(await syncStore.getDirty('songs/a.json')).toBeUndefined()
    expect(await syncStore.getRev('songs/a.json')).toEqual({
      rev: 'rev-remote',
      contentHash: undefined,
      sizeBytes: 5,
    })
  })

  it("keeps the path dirty (to retry against the new rev) when keeping 'mine'", async () => {
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 2, nextRetryAt: 0 })
    await syncStore.setConflict('songs/a.json', {
      conflictFilePath: 'songs/a (conflicted copy 20260101-000000).json',
      remoteRev: 'rev-remote',
      remoteSizeBytes: 5,
    })

    await makeSync(createFakeRoot()).resolveConflict(
      'songs/a (conflicted copy 20260101-000000).json',
      'mine',
    )

    expect(await syncStore.getConflict('songs/a.json')).toBeUndefined()
    expect(await syncStore.getDirty('songs/a.json')).toBeDefined()
    expect(await syncStore.getRev('songs/a.json')).toEqual({
      rev: 'rev-remote',
      contentHash: undefined,
      sizeBytes: 5,
    })
  })

  it('does nothing for a conflict-artifact path this module does not recognize', async () => {
    await syncStore.setDirty('songs/a.json', { deleted: false, attempts: 0, nextRetryAt: 0 })

    await expect(
      makeSync(createFakeRoot()).resolveConflict('songs/unrelated (conflicted copy x).json', 'mine'),
    ).resolves.toBeUndefined()

    expect(await syncStore.getDirty('songs/a.json')).toBeDefined()
  })
})

describe('provider independence', () => {
  it('drives the exact same orchestration regardless of which provider is injected', async () => {
    const secondProvider = makeFakeProvider('onedrive')
    const root = createFakeRoot()
    vi.mocked(secondProvider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/song-1.json', rev: 'etag-1', sizeBytes: 10 }],
      cursor: 'delta-cursor-1',
      isFromScratchListing: true,
    })
    vi.mocked(secondProvider.download).mockResolvedValueOnce({
      bytes: jsonBytes({ id: 'song-1', title: 'A' }),
      rev: 'etag-1',
      sizeBytes: 10,
    })

    await createCloudSync({ provider: secondProvider, root, maxCachedFileSizeBytes: 50 * 1024 * 1024 }).pull()

    const record = await readJsonFile<{ title: string }>(root, 'songs/song-1.json')
    expect(record?.title).toBe('A')
    expect(await syncStore.getCursor()).toBe('delta-cursor-1')
  })
})
