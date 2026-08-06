import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

export const useSettingsStore = defineStore('settings', () => {
  const librarySettings = ref<LibrarySettings>()
  const machineSettings = ref<MachineSettings>()
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
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
        // Same story for the bulletin block — browser-demo localStorage saved before it existed
        // has no `bulletin` key at all, which crashed BulletinView's render (every field access
        // assumes librarySettings.bulletin itself, not just librarySettings, is always present).
        bulletin: library.bulletin ?? {
          page1Title: 'Order of Worship',
          page2Title: 'Announcements',
          page1FooterTitle: 'Heart Preparation',
          page1FooterEnabled: true,
          page2FooterTitle: 'Thought to Ponder',
          page2FooterEnabled: true,
          page2Enabled: true,
          showAnnouncements: true,
          showServingSchedule: true,
          servingScheduleRoles: [],
        },
      }
      machineSettings.value = machine
    })
  }

  async function save() {
    if (!librarySettings.value || !machineSettings.value) return
    // LibrarySettings is written beneath MachineSettings.libraryPath in the desktop adapter.
    // Persist the machine choice first so changing the library folder and saving in one action
    // writes shared settings into the newly selected folder, not the previously active one.
    await asyncState.runMutation(async () => {
      await getAdapter().settings.saveMachineSettings(machineSettings.value!)
      await getAdapter().settings.saveLibrarySettings(librarySettings.value!)
    })
  }

  return { librarySettings, machineSettings, ...asyncState, load, save }
})
