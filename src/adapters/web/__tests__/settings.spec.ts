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

  it('returns first-run defaults for machine settings when localStorage is empty', async () => {
    const port = createWebSettingsPort(createFakeRoot())
    const settings = await port.getMachineSettings()
    expect(settings.hasCompletedSetup).toBe(false)
    // Deliberately never blank — this is the `updatedByDevice` stamp on every record saved from
    // this device, and an empty one makes two devices indistinguishable in SyncConflictsView.
    // Which name it lands on per platform is utils/__tests__/deviceName.spec.ts's concern.
    expect(settings.thisComputerName).not.toBe('')
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
