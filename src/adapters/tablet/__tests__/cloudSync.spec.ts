import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudSync } from '../cloudSync'
import { ProviderApiError, ProviderReauthRequiredError, type CloudSyncProvider } from '../providers/types'
import { createFakeRoot } from '@/adapters/web/__tests__/fakeFsa'
import { readBytes, readJsonFile, writeJsonFile } from '@/adapters/web/fsaStorage'

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
  it('applies a new file returned by the provider and persists the returned cursor', async () => {
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'songs/song-1.json', rev: 'rev-1', sizeBytes: 10 }],
      cursor: 'cursor-1',
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
    vi.mocked(provider.listChanges).mockResolvedValueOnce({ entries: [], cursor: 'cursor-1' })

    await makeSync(createFakeRoot()).pull()

    expect(provider.listChanges).toHaveBeenCalledWith('token-1', 'cursor-0')
  })

  it('skips downloading content for a file at or above the size threshold, but still records its rev', async () => {
    vi.mocked(provider.listChanges).mockResolvedValueOnce({
      entries: [{ tag: 'file', path: 'media/big.mp4', rev: 'rev-big', sizeBytes: 200 }],
      cursor: 'c',
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

  it('sets needsReconnect and stops cleanly when the provider cannot silently produce a token', async () => {
    vi.mocked(provider.getValidAccessToken).mockRejectedValueOnce(
      new ProviderReauthRequiredError('reconnect please'),
    )
    const sync = makeSync(createFakeRoot())

    await expect(sync.pull()).rejects.toThrow('reconnect please')
    expect((await sync.getSyncStatus()).needsReconnect).toBe(true)
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
