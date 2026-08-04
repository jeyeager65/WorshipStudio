import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { Service } from '@/models/service'

export const useServicesStore = defineStore('services', () => {
  const services = ref<Service[]>([])
  const asyncState = useAsyncStoreState()
  // One-shot handoff for a just-created-but-not-yet-saved service (see CreateServiceView /
  // ServiceWorkspaceView) — set right before navigating to the workspace and consumed (and
  // cleared) there on mount, so the form's data survives the navigation without writing a
  // file to disk before the user has actually pressed Save.
  const draftService = ref<Service>()

  async function load() {
    return asyncState.runLoad(async () => {
      services.value = await getAdapter().services.list()
    })
  }

  async function save(service: Service) {
    await asyncState.runMutation(() => getAdapter().services.save(service))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().services.delete(id))
    await load()
  }

  return {
    services,
    ...asyncState,
    load,
    save,
    remove,
    draftService,
  }
})
