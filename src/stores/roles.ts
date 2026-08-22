import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { RoleDefinition } from '@/models/settings'

export const useRolesStore = defineStore('roles', () => {
  const roles = ref<RoleDefinition[]>([])
  const asyncState = useAsyncStoreState('roles')

  async function load() {
    return asyncState.runLoad(async () => {
      roles.value = await getAdapter().roles.list()
    })
  }

  async function save(role: RoleDefinition) {
    await asyncState.runMutation(() => getAdapter().roles.save(role))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().roles.delete(id))
    await load()
  }

  return { roles, ...asyncState, load, save, remove }
})
