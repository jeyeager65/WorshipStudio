import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ServiceTypeDefinition } from '@/models/settings'

export const useServiceTypesStore = defineStore('serviceTypes', () => {
  const serviceTypes = ref<ServiceTypeDefinition[]>([])
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      serviceTypes.value = await getAdapter().serviceTypes.list()
    })
  }

  async function save(serviceType: ServiceTypeDefinition) {
    await asyncState.runMutation(() => getAdapter().serviceTypes.save(serviceType))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().serviceTypes.delete(id))
    await load()
  }

  return { serviceTypes, ...asyncState, load, save, remove }
})
