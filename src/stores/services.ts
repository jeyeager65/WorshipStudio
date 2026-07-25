import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Service } from '@/models/service'

export const useServicesStore = defineStore('services', () => {
  const services = ref<Service[]>([])
  const loaded = ref(false)

  async function load() {
    services.value = await getAdapter().services.list()
    loaded.value = true
  }

  async function save(service: Service) {
    await getAdapter().services.save(service)
    await load()
  }

  return { services, loaded, load, save }
})
