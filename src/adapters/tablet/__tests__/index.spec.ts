import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeRoot } from '@/adapters/web/__tests__/fakeFsa'

const { getOpfsRoot } = vi.hoisted(() => ({ getOpfsRoot: vi.fn() }))
vi.mock('../opfs', () => ({ getOpfsRoot }))

function makeFakeSyncStore() {
  const dirty = new Map<string, { deleted: boolean; attempts: number; nextRetryAt: number }>()
  return {
    getCursor: async () => undefined,
    setCursor: async () => {},
    clearCursor: async () => {},
    getLastSyncedAt: async () => undefined,
    setLastSyncedAt: async () => {},
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

  it('a not-yet-implemented storage port throws a specific, honest error rather than behaving like an empty library', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    await expect(adapter.songs.list()).rejects.toThrow(/songs\.list\(\).*tablet build/)
  })

  it('writing through the settings port marks the path dirty for the sync engine', async () => {
    const adapter = await createTabletAdapter({ provider: 'dropbox', clientId: 'k', libraryFolderPath: '/Library' })
    const settings = await adapter.settings.getLibrarySettings()

    await adapter.settings.saveLibrarySettings(settings)

    expect(syncStore._dirty.has('library-settings.json')).toBe(true)
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
