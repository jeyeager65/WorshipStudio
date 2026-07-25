import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Service } from '@/models/service'

export const useServicesStore = defineStore('services', () => {
  const services = ref<Service[]>([])
  const loaded = ref(false)
  // One-shot handoff for a just-created-but-not-yet-saved service (see CreateServiceView /
  // ServiceWorkspaceView) — set right before navigating to the workspace and consumed (and
  // cleared) there on mount, so the form's data survives the navigation without writing a
  // file to disk before the user has actually pressed Save.
  const draftService = ref<Service>()

  async function load() {
    services.value = await getAdapter().services.list()
    loaded.value = true
  }

  async function save(service: Service) {
    await getAdapter().services.save(service)
    await load()
  }

  return { services, loaded, load, save, draftService }
})
