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
