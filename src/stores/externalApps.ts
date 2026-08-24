import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ExternalAppProfile } from '@/adapters/types'

/** Profile CRUD works on every adapter (shared/synced data) — `implementations` (this computer's
 *  executable path for each profile) only ever populates on Tauri, since `getImplementation` is
 *  Windows/filesystem-only; it stays an empty Map everywhere else. */
export const useExternalAppsStore = defineStore('externalApps', () => {
  const profiles = ref<ExternalAppProfile[]>([])
  /** profileId -> this computer's executable path, for whichever profiles have one set up here. */
  const implementations = ref(new Map<string, string>())
  const asyncState = useAsyncStoreState('externalApps')

  async function load() {
    return asyncState.runLoad(async () => {
      profiles.value = await getAdapter().externalApps.listProfiles()
      const getImplementation = getAdapter().externalApps.getImplementation
      if (!getImplementation) {
        implementations.value = new Map()
        return
      }
      const entries = await Promise.all(
        profiles.value.map(async (profile) => {
          const implementation = await getImplementation(profile.id)
          return implementation
            ? ([profile.id, implementation.executablePath] as const)
            : undefined
        }),
      )
      implementations.value = new Map(
        entries.filter((entry): entry is readonly [string, string] => entry !== undefined),
      )
    })
  }

  return { profiles, implementations, ...asyncState, load }
})
