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
    librarySettings.value = library
    machineSettings.value = machine
    loaded.value = true
  }

  async function save() {
    if (!librarySettings.value || !machineSettings.value) return
    await Promise.all([
      getAdapter().settings.saveLibrarySettings(librarySettings.value),
      getAdapter().settings.saveMachineSettings(machineSettings.value),
    ])
  }

  return { librarySettings, machineSettings, loaded, load, save }
})
