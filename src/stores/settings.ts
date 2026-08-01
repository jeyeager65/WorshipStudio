import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

export const useSettingsStore = defineStore('settings', () => {
  const librarySettings = ref<LibrarySettings>()
  const machineSettings = ref<MachineSettings>()
  const loaded = ref(false)

  async function load() {
    const [library, machine] = await Promise.all([
      getAdapter().settings.getLibrarySettings(),
      getAdapter().settings.getMachineSettings(),
    ])
    librarySettings.value = {
      ...library,
      // Browser-demo localStorage and older library-settings.json files predate the shared
      // Canva integration block. Normalize once at the store boundary so every view can rely
      // on the current shape.
      canvaIntegration: library.canvaIntegration ?? { clientId: '', clientSecret: '' },
    }
    machineSettings.value = machine
    loaded.value = true
  }

  async function save() {
    if (!librarySettings.value || !machineSettings.value) return
    // LibrarySettings is written beneath MachineSettings.libraryPath in the desktop adapter.
    // Persist the machine choice first so changing the library folder and saving in one action
    // writes shared settings into the newly selected folder, not the previously active one.
    await getAdapter().settings.saveMachineSettings(machineSettings.value)
    await getAdapter().settings.saveLibrarySettings(librarySettings.value)
  }

  return { librarySettings, machineSettings, loaded, load, save }
})
