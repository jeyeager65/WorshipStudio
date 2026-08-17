import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSettingsPort } from '../settings'
import { createFakeRoot } from './fakeFsa'
import { readJsonFile, writeJsonFile } from '../fsaStorage'

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
    expect(settings.defaultTranslationCode).toBe('KJV')
    expect(settings.bulletin.page1.title).toBe('Order of Worship')
    expect(settings.fontSizesPx.scripture).toEqual({ min: 72, max: 120 })
  })

  it('round-trips saved library settings through the picked folder', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const settings = await port.getLibrarySettings()
    settings.branding.churchName = 'Hope Church'
    await port.saveLibrarySettings(settings)

    const reloaded = await port.getLibrarySettings()
    expect(reloaded.branding.churchName).toBe('Hope Church')
  })

  // Mirrors src-tauri/src/commands/settings.rs's migrate_library_settings_shape tests exactly —
  // font sizes and bulletin settings used to be flat fields/flat bulletin keys, reshaped into
  // fontSizesPx/bulletin.page1/bulletin.page2 purely for readability. A real church's customized
  // values must survive the reshape, not silently reset to defaults.
  describe('font size and bulletin shape migration', () => {
    it('reshapes flat font-size and bulletin keys, preserving customized values', async () => {
      const root = createFakeRoot()
      await writeJsonFile(root, 'library-settings.json', {
        branding: { churchName: 'Hope Church', primaryColor: '#000', secondaryColor: '#000' },
        apiBibleTranslations: [],
        mediaMaxSyncedFileSizeMb: 50,
        scriptureMinFontSizePx: 80,
        scriptureMaxFontSizePx: 130,
        songMinFontSizePx: 20,
        songMaxFontSizePx: 110,
        slideHeaderFontSizePx: 40,
        slideFooterFontSizePx: 44,
        wayfindingMinFontSizePx: 60,
        wayfindingMaxFontSizePx: 140,
        bulletin: {
          page1Title: 'Custom Order Title',
          page2Title: 'Custom Announcements Title',
          page1FooterTitle: 'Custom Heart Prep',
          page1FooterEnabled: false,
          page2FooterTitle: 'Custom Thought',
          page2FooterEnabled: false,
          page2Enabled: false,
          showAnnouncements: false,
          showServingSchedule: false,
          servingScheduleRoleIds: ['role-nursery'],
        },
      })
      const port = createWebSettingsPort(root)

      const settings = await port.getLibrarySettings()

      expect(settings.fontSizesPx).toEqual({
        scripture: { min: 80, max: 130 },
        song: { min: 20, max: 110 },
        slide: { header: 40, footer: 44 },
        wayfinding: { min: 60, max: 140 },
      })
      expect(settings.bulletin).toEqual({
        page1: {
          title: 'Custom Order Title',
          footer: { title: 'Custom Heart Prep', enabled: false },
        },
        page2: {
          enabled: false,
          title: 'Custom Announcements Title',
          footer: { title: 'Custom Thought', enabled: false },
          announcements: { enabled: false },
          servingSchedule: { enabled: false, roleIds: ['role-nursery'] },
        },
      })

      // Persisted, not just returned in-memory — old flat keys must be gone on disk too.
      const raw = await readJsonFile<Record<string, unknown>>(root, 'library-settings.json')
      expect(raw?.scriptureMinFontSizePx).toBeUndefined()
      expect((raw?.bulletin as Record<string, unknown>).page1Title).toBeUndefined()
    })

    it('is a no-op once the file is already in the nested shape', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      const original = await port.getLibrarySettings()
      original.fontSizesPx.scripture.min = 99
      await port.saveLibrarySettings(original)

      const reloaded = await port.getLibrarySettings()

      expect(reloaded.fontSizesPx.scripture.min).toBe(99)
    })
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

  it('returns first-run defaults for credentials when credentials.json does not exist yet', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const credentials = await port.getLibraryCredentials()
    expect(credentials.canvaIntegration).toEqual({ clientId: '', clientSecret: '' })
    expect(credentials.dropboxIntegration).toEqual({ appKey: '' })
    expect(credentials.oneDriveIntegration).toEqual({ clientId: '' })
  })

  it('round-trips saved credentials through the picked folder, separate from library-settings.json', async () => {
    const root = createFakeRoot()
    const port = createWebSettingsPort(root)
    const credentials = await port.getLibraryCredentials()
    credentials.canvaIntegration = { clientId: 'church-id', clientSecret: 'church-secret' }
    await port.saveLibraryCredentials(credentials)

    const reloaded = await port.getLibraryCredentials()
    expect(reloaded.canvaIntegration.clientId).toBe('church-id')
    // Never written into library-settings.json — a real, separate file.
    await expect(readJsonFile(root, 'library-settings.json')).resolves.toBeNull()
  })

  // Mirrors src-tauri/src/commands/settings.rs's migrate_legacy_bible_api_keys tests exactly —
  // these keys used to live on MachineSettings (a mistake: they belong to the church's own
  // api.esv.org/api.bible account, not to any one device) and now live on LibraryCredentials,
  // with a one-time migration for anyone who already configured one the old way.
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
    it('moves a legacy machine-local key into library credentials on first load', async () => {
      const root = createFakeRoot()
      seedLegacyMachineBibleKeys()
      const port = createWebSettingsPort(root)

      const credentials = await port.getLibraryCredentials()

      expect(credentials.esvApiKey).toBe('legacy-esv-key')
      expect(credentials.apiBibleKey).toBe('legacy-api-bible-key')
    })

    it('clears the legacy machine-local keys once migrated, so they never resurface', async () => {
      const root = createFakeRoot()
      seedLegacyMachineBibleKeys()
      const port = createWebSettingsPort(root)

      await port.getLibraryCredentials()

      const machine = await port.getMachineSettings()
      expect(machine.esvApiKey).toBeUndefined()
      expect(machine.apiBibleKey).toBeUndefined()
    })

    it('never overwrites a key the church already configured', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      const credentials = await port.getLibraryCredentials()
      credentials.esvApiKey = 'church-esv-key'
      credentials.apiBibleKey = 'church-api-bible-key'
      await port.saveLibraryCredentials(credentials)
      seedLegacyMachineBibleKeys()

      const reloaded = await port.getLibraryCredentials()

      expect(reloaded.esvApiKey).toBe('church-esv-key')
      expect(reloaded.apiBibleKey).toBe('church-api-bible-key')
    })

    it('migrates ESV and api.bible independently, unlike a paired credential', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      // The church already configured api.bible (e.g. from another device) but never ESV.
      const credentials = await port.getLibraryCredentials()
      credentials.apiBibleKey = 'church-api-bible-key'
      await port.saveLibraryCredentials(credentials)
      seedLegacyMachineBibleKeys()

      const reloaded = await port.getLibraryCredentials()

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

  describe('clearSettingsListBackups', () => {
    it('removes the .backup sibling of each normalized settings list file', async () => {
      const root = createFakeRoot()
      const port = createWebSettingsPort(root)
      const filenames = [
        'song-collections.json',
        'service-types.json',
        'role-groups.json',
        'roles.json',
        'service-templates.json',
      ]
      // A .backup sibling only ever appears after a second write (see write_json_file's own
      // doc comment) — writing each file twice is what actually produces one, same as the
      // real ports (adapters/web/roles.ts etc.) do in normal use.
      for (const filename of filenames) {
        await writeJsonFile(root, filename, [{ id: '1' }])
        await writeJsonFile(root, filename, [{ id: '1' }, { id: '2' }])
      }
      await writeJsonFile(root, 'library-settings.json', { branding: {} })
      await writeJsonFile(root, 'library-settings.json', { branding: { churchName: 'Hope' } })

      await port.clearSettingsListBackups()

      for (const filename of filenames) {
        await expect(readJsonFile(root, `${filename}.backup`)).resolves.toBeNull()
        // The primary file itself must survive untouched — only its backup is cleared.
        await expect(readJsonFile(root, filename)).resolves.not.toBeNull()
      }
      // library-settings.json.backup is deliberately excluded — that file is never touched by
      // Clear Existing Data, so its own backup shouldn't be swept away either.
      await expect(readJsonFile(root, 'library-settings.json.backup')).resolves.not.toBeNull()
    })

    it('is a no-op when none of the backup files exist', async () => {
      const port = createWebSettingsPort(createFakeRoot())
      await expect(port.clearSettingsListBackups()).resolves.toBeUndefined()
    })
  })
})
