import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSettingsPort } from '../settings'
import { createFakeRoot } from './fakeFsa'

const { storeLibraryHandle } = vi.hoisted(() => ({ storeLibraryHandle: vi.fn() }))
vi.mock('../handlePersistence', () => ({ storeLibraryHandle }))

beforeEach(() => {
  localStorage.clear()
  storeLibraryHandle.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWebSettingsPort', () => {
  it('returns first-run defaults when library-settings.json does not exist yet', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const settings = await port.getLibrarySettings()
    expect(settings.serviceTypes).toEqual([])
    expect(settings.defaultTranslationCode).toBe('KJV')
    expect(settings.bulletin.page1Title).toBe('Order of Worship')
  })

  it('round-trips saved library settings through the picked folder', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const settings = await port.getLibrarySettings()
    settings.branding.churchName = 'Hope Church'
    await port.saveLibrarySettings(settings)

    const reloaded = await port.getLibrarySettings()
    expect(reloaded.branding.churchName).toBe('Hope Church')
  })

  it('returns first-run defaults for machine settings when localStorage is empty', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const settings = await port.getMachineSettings()
    expect(settings.hasCompletedSetup).toBe(false)
    expect(settings.thisComputerName).toBe('')
  })

  it('persists machine settings to localStorage, not the picked folder', async () => {
    const root = createFakeRoot()
    const port = createWebSettingsPort(root)
    const settings = await port.getMachineSettings()
    await port.saveMachineSettings({ ...settings, thisComputerName: 'Volunteer Laptop' })

    // A second port instance against the same root, with no localStorage cleared, still sees it —
    // proving persistence isn't routed through the FSA root at all.
    const otherPort = createWebSettingsPort(root)
    expect((await otherPort.getMachineSettings()).thisComputerName).toBe('Volunteer Laptop')
  })

  it('falls back to defaults rather than throwing on a corrupt localStorage value', async () => {
    localStorage.setItem('worship-studio:web:machine-settings', '{not json')
    const port = createWebSettingsPort(createFakeRoot())
    await expect(port.getMachineSettings()).resolves.toMatchObject({ hasCompletedSetup: false })
  })

  // Mirrors src-tauri/src/commands/settings.rs's migrate_legacy_bible_api_keys tests exactly —
  // these keys used to live on MachineSettings (a mistake: they belong to the church's own
  // api.esv.org/api.bible account, not to any one device) and now live on LibrarySettings, with
  // a one-time migration for anyone who already configured one the old way.
  //
  // Legacy state is seeded via a direct localStorage write, not port.saveMachineSettings() — that
  // API now deliberately strips these two fields on every save (so a stale already-open tab can
  // never resurrect a key migration already cleared), which makes it useless for *creating* the
  // legacy state a real pre-upgrade install would already have sitting in localStorage from an
  // older app version that never had that stripping logic.
  const MACHINE_SETTINGS_KEY = 'worship-studio:web:machine-settings'
  function seedLegacyMachineBibleKeys() {
    localStorage.setItem(
      MACHINE_SETTINGS_KEY,
      JSON.stringify({ esvApiKey: 'legacy-esv-key', apiBibleKey: 'legacy-api-bible-key' }),
    )
  }

  describe('Bible API key migration', () => {
    it('moves a legacy machine-local key into library settings on first load', async () => {
      const root = createFakeRoot()
      seedLegacyMachineBibleKeys()
      const port = createWebSettingsPort(root)

      const library = await port.getLibrarySettings()

      expect(library.esvApiKey).toBe('legacy-esv-key')
      expect(library.apiBibleKey).toBe('legacy-api-bible-key')
    })

    it('clears the legacy machine-local keys once migrated, so they never resurface', async () => {
      const root = createFakeRoot()
      seedLegacyMachineBibleKeys()
      const port = createWebSettingsPort(root)

      await port.getLibrarySettings()

      const machine = await port.getMachineSettings()
      expect(machine.esvApiKey).toBeUndefined()
      expect(machine.apiBibleKey).toBeUndefined()
    })

    it('never overwrites a key the church already configured', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      const library = await port.getLibrarySettings()
      library.esvApiKey = 'church-esv-key'
      library.apiBibleKey = 'church-api-bible-key'
      await port.saveLibrarySettings(library)
      seedLegacyMachineBibleKeys()

      const reloaded = await port.getLibrarySettings()

      expect(reloaded.esvApiKey).toBe('church-esv-key')
      expect(reloaded.apiBibleKey).toBe('church-api-bible-key')
    })

    it('migrates ESV and api.bible independently, unlike a paired credential', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      // The church already configured api.bible (e.g. from another device) but never ESV.
      const library = await port.getLibrarySettings()
      library.apiBibleKey = 'church-api-bible-key'
      await port.saveLibrarySettings(library)
      seedLegacyMachineBibleKeys()

      const reloaded = await port.getLibrarySettings()

      expect(reloaded.esvApiKey).toBe('legacy-esv-key')
      expect(reloaded.apiBibleKey).toBe('church-api-bible-key')
    })
  })

  describe('pickLibraryFolder', () => {
    it('stores the newly picked handle and returns its name', async () => {
      const newHandle = { name: 'Church Library' } as FileSystemDirectoryHandle
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(newHandle))
      const port = createWebSettingsPort(createFakeRoot())

      const result = await port.pickLibraryFolder()

      expect(result).toBe('Church Library')
      expect(storeLibraryHandle).toHaveBeenCalledWith(newHandle)
    })

    it('returns undefined without storing anything when the user cancels the picker', async () => {
      const abortError = new DOMException('The user aborted a request.', 'AbortError')
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(abortError))
      const port = createWebSettingsPort(createFakeRoot())

      await expect(port.pickLibraryFolder()).resolves.toBeUndefined()
      expect(storeLibraryHandle).not.toHaveBeenCalled()
    })

    it('propagates non-cancellation errors', async () => {
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(new Error('boom')))
      const port = createWebSettingsPort(createFakeRoot())

      await expect(port.pickLibraryFolder()).rejects.toThrow('boom')
      expect(storeLibraryHandle).not.toHaveBeenCalled()
    })

    it('returns undefined when the browser has no File System Access support', async () => {
      const port = createWebSettingsPort(createFakeRoot())
      await expect(port.pickLibraryFolder()).resolves.toBeUndefined()
      expect(storeLibraryHandle).not.toHaveBeenCalled()
    })
  })
})
