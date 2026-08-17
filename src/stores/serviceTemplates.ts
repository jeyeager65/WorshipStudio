import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ServiceTemplate } from '@/models/service'

export const useServiceTemplatesStore = defineStore('serviceTemplates', () => {
  const serviceTemplates = ref<ServiceTemplate[]>([])
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      serviceTemplates.value = await getAdapter().serviceTemplates.list()
    })
  }

  async function save(serviceTemplate: ServiceTemplate) {
    await asyncState.runMutation(() => getAdapter().serviceTemplates.save(serviceTemplate))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().serviceTemplates.delete(id))
    await load()
  }

  return { serviceTemplates, ...asyncState, load, save, remove }
})
