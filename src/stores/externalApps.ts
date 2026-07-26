import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { ExternalAppProfile } from '@/adapters/types'

/** Windows-only — the port itself is absent on the macOS/demo build, so `load()` just leaves
 * `profiles` empty there rather than erroring. */
export const useExternalAppsStore = defineStore('externalApps', () => {
  const profiles = ref<ExternalAppProfile[]>([])
  const loaded = ref(false)

  async function load() {
    profiles.value = (await getAdapter().externalApps?.listProfiles()) ?? []
    loaded.value = true
  }

  return { profiles, loaded, load }
})
