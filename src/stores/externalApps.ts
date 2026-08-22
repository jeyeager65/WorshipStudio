import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ExternalAppProfile } from '@/adapters/types'

/** Windows-only — the port itself is absent on the macOS/demo build, so `load()` just leaves
 * `profiles` empty there rather than erroring. */
export const useExternalAppsStore = defineStore('externalApps', () => {
  const profiles = ref<ExternalAppProfile[]>([])
  const asyncState = useAsyncStoreState('externalApps')

  async function load() {
    return asyncState.runLoad(async () => {
      profiles.value = (await getAdapter().externalApps?.listProfiles()) ?? []
    })
  }

  return { profiles, ...asyncState, load }
})
