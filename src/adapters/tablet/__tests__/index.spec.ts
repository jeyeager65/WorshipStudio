import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeRoot } from '@/adapters/web/__tests__/fakeFsa'

const { getOpfsRoot } = vi.hoisted(() => ({ getOpfsRoot: vi.fn() }))
vi.mock('../opfs', () => ({ getOpfsRoot }))

vi.mock('@/adapters/mock/pickFiles', () => ({ pickFilesInBrowser: vi.fn() }))
import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'

function makeFakeSyncStore() {
  const dirty = new Map<string, { deleted: boolean; attempts: number; nextRetryAt: number }>()
  return {
    getCursor: async () => undefined,
    setCursor: async () => {},
    clearCursor: async () => {},
    getLastSyncedAt: async () => undefined,
    setLastSyncedAt: async () => {},
    getConsecutiveReauthFailures: async () => 0,
    setConsecutiveReauthFailures: async () => {},
    getDirty: async (path: string) => dirty.get(path),
    setDirty: async (
      path: string,
      entry: { deleted: boolean; attempts: number; nextRetryAt: number },
    ) => {
      dirty.set(path, entry)
    },
    clearDirty: async (path: string) => {
      dirty.delete(path)
    },
    getAllDirty: async () => [...dirty.entries()],
    getRev: async () => undefined,
    setRev: async () => {},
    clearRev: async () => {},
    getConflict: async () => undefined,
    setConflict: async () => {},
    clearConflict: async () => {},
    getAllConflicts: async () => [],
    _dirty: dirty,
  }
}

const { syncStore } = vi.hoisted(() => ({ syncStore: {} as ReturnType<typeof makeFakeSyncStore> }))
vi.mock('../syncStore', () => ({ syncStore }))

// createTabletAdapter is imported after the mocks above are registered (vi.mock calls are
// hoisted, but the dynamic import keeps this file's intent explicit).
const { createTabletAdapter } = await import('../index')

beforeEach(() => {
  Object.assign(syncStore, makeFakeSyncStore())
  getOpfsRoot.mockReset().mockResolvedValue(createFakeRoot())
  vi.mocked(pickFilesInBrowser).mockReset()
})

describe('createTabletAdapter', () => {
  it('reports kind "tablet"', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    expect(adapter.kind).toBe('tablet')
  })

  it('settings is real and works against the OPFS root', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const settings = await adapter.settings.getLibrarySettings()
    expect(settings.defaultTranslationCode).toBe('KJV')

    settings.branding.churchName = 'Test Church'
    await adapter.settings.saveLibrarySettings(settings)
    const reloaded = await adapter.settings.getLibrarySettings()
    expect(reloaded.branding.churchName).toBe('Test Church')
  })

  it('every storage-shaped port is real and works against the OPFS root', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })

    await adapter.songs.save({
      id: 'song-1',
      title: 'Amazing Grace',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })

    const songs = await adapter.songs.list()
    expect(songs.map((s) => s.id)).toContain('song-1')
  })

  it('diagnostics.getSummary reports real library counts and installationMode "tablet"', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const summary = await adapter.diagnostics.getSummary()
    expect(summary.installationMode).toBe('tablet')
    expect(summary.libraryItems.songs).toBe(0)
  })

  it("media's local-only items land in a separate OPFS subfolder never marked dirty for push", async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['bytes'], 'clip.mp4')])
    const [staged] = await adapter.media.pickFilesToImport()

    await adapter.media.commitImport([
      { path: staged!.path, filename: 'clip.mp4', title: 'Clip', tags: [], location: 'local' },
    ])

    const dirtyPaths = [...syncStore._dirty.keys()]
    expect(dirtyPaths.some((path) => path.startsWith('local-media/'))).toBe(false)
  })

  it('writing through the settings port marks the path dirty for the sync engine', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const settings = await adapter.settings.getLibrarySettings()

    await adapter.settings.saveLibrarySettings(settings)

    expect(syncStore._dirty.has('library-settings.json')).toBe(true)
  })

  it('never marks a .backup file dirty — a local recovery artifact, never pushed', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const settings = await adapter.settings.getLibrarySettings()
    await adapter.settings.saveLibrarySettings(settings)
    // The *second* write is what actually creates library-settings.json.backup
    // (fsaStorage.ts's writeJsonFile only backs up a version that already existed).
    await adapter.settings.saveLibrarySettings(settings)

    expect(syncStore._dirty.has('library-settings.json')).toBe(true)
    expect(syncStore._dirty.has('library-settings.json.backup')).toBe(false)
  })

  it('sync.getStatus reflects a clean, freshly-created cache', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const status = await adapter.sync.getStatus()
    expect(status.conflictCount).toBe(0)
    expect(status.recoveryCount).toBe(0)
    expect(status.pendingPushCount).toBe(0)
  })

  it('sync.runSync is present (tablet-only SyncPort extension)', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    expect(adapter.sync.runSync).toBeTypeOf('function')
  })
})
