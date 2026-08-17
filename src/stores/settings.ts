import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { LibraryCredentials, LibrarySettings, MachineSettings } from '@/models/settings'

export const useSettingsStore = defineStore('settings', () => {
  const librarySettings = ref<LibrarySettings>()
  const libraryCredentials = ref<LibraryCredentials>()
  const machineSettings = ref<MachineSettings>()
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      const [library, credentials, machine] = await Promise.all([
        getAdapter().settings.getLibrarySettings(),
        getAdapter().settings.getLibraryCredentials(),
        getAdapter().settings.getMachineSettings(),
      ])
      librarySettings.value = {
        ...library,
        // Same story for the bulletin block — browser-demo localStorage saved before it existed
        // has no `bulletin` key at all, which crashed BulletinView's render (every field access
        // assumes librarySettings.bulletin itself, not just librarySettings, is always present).
        // adapters/web/settings.ts's own migrateLibrarySettingsShape only reshapes an *existing*
        // (old flat-shaped) bulletin block — it leaves a genuinely absent one alone, so this
        // fallback still covers that narrower case.
        bulletin: library.bulletin ?? {
          page1: {
            title: 'Order of Worship',
            footer: { title: 'Heart Preparation', enabled: true },
          },
          page2: {
            enabled: true,
            title: 'Announcements',
            footer: { title: 'Thought to Ponder', enabled: true },
            announcements: { enabled: true },
            servingSchedule: { enabled: true, roleIds: [] },
          },
        },
      }
      libraryCredentials.value = credentials
      machineSettings.value = machine
    })
  }

  async function save() {
    if (!librarySettings.value || !libraryCredentials.value || !machineSettings.value) return
    // LibrarySettings is written beneath MachineSettings.libraryPath in the desktop adapter.
    // Persist the machine choice first so changing the library folder and saving in one action
    // writes shared settings into the newly selected folder, not the previously active one.
    await asyncState.runMutation(async () => {
      await getAdapter().settings.saveMachineSettings(machineSettings.value!)
      await getAdapter().settings.saveLibrarySettings(librarySettings.value!)
      await getAdapter().settings.saveLibraryCredentials(libraryCredentials.value!)
    })
  }

  return { librarySettings, libraryCredentials, machineSettings, ...asyncState, load, save }
})
