import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const { settingsPort } = vi.hoisted(() => ({
  settingsPort: {
    getLibrarySettings: vi.fn(),
    getLibraryCredentials: vi.fn(),
    getMachineSettings: vi.fn(),
    saveLibrarySettings: vi.fn(),
    saveLibraryCredentials: vi.fn(),
    saveMachineSettings: vi.fn(),
  },
}))
vi.mock('@/adapters', () => ({ getAdapter: () => ({ settings: settingsPort }) }))

function machineSettings() {
  return {
    thisComputerName: 'Booth Laptop',
    darkMode: true,
    libraryPath: 'D:/Church/Library',
    hasCompletedSetup: false,
    displayRoles: {},
  }
}

function librarySettings() {
  return {
    branding: { churchName: 'Grace Chapel', primaryColor: '#123456', secondaryColor: '#654321' },
    defaultTranslationCode: 'ESV',
  }
}

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(settingsPort).forEach((fn) => fn.mockReset())
    settingsPort.getLibrarySettings.mockResolvedValue(librarySettings())
    settingsPort.getLibraryCredentials.mockResolvedValue({})
    settingsPort.getMachineSettings.mockResolvedValue(machineSettings())
  })

  describe('saveMachineOnly', () => {
    // The Setup Wizard's Join mode depends on this: it changes libraryPath to point at a library
    // it never loaded, so writing the in-memory LibrarySettings would overwrite that library's
    // real branding and defaults for every device. See notes/setup-wizard-join-plan.md.
    it('persists machine settings without touching the shared library file', async () => {
      const store = useSettingsStore()
      await store.load()
      store.machineSettings!.libraryPath = 'D:/Church/SharedLibrary'

      await store.saveMachineOnly()

      expect(settingsPort.saveMachineSettings).toHaveBeenCalledWith(
        expect.objectContaining({ libraryPath: 'D:/Church/SharedLibrary' }),
      )
      expect(settingsPort.saveLibrarySettings).not.toHaveBeenCalled()
      expect(settingsPort.saveLibraryCredentials).not.toHaveBeenCalled()
    })

    it('does nothing before machine settings have loaded', async () => {
      const store = useSettingsStore()
      await store.saveMachineOnly()
      expect(settingsPort.saveMachineSettings).not.toHaveBeenCalled()
    })
  })

  describe('save', () => {
    // The counterpart behaviour, deliberately kept: on the Settings page the values *were* edited
    // on purpose and should follow the library folder when it moves — which is exactly why the
    // wizard needed its own machine-only path rather than reusing this one.
    it('writes machine settings before library settings so shared values land in the new folder', async () => {
      const store = useSettingsStore()
      await store.load()

      await store.save()

      expect(settingsPort.saveMachineSettings).toHaveBeenCalled()
      expect(settingsPort.saveLibrarySettings).toHaveBeenCalled()
      const machineOrder = settingsPort.saveMachineSettings.mock.invocationCallOrder[0]!
      const libraryOrder = settingsPort.saveLibrarySettings.mock.invocationCallOrder[0]!
      expect(machineOrder).toBeLessThan(libraryOrder)
    })
  })
})
