import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { RoleGroupDefinition } from '@/models/settings'

export const useRoleGroupsStore = defineStore('roleGroups', () => {
  const roleGroups = ref<RoleGroupDefinition[]>([])
  const asyncState = useAsyncStoreState('roleGroups')

  async function load() {
    return asyncState.runLoad(async () => {
      roleGroups.value = await getAdapter().roleGroups.list()
    })
  }

  async function save(roleGroup: RoleGroupDefinition) {
    await asyncState.runMutation(() => getAdapter().roleGroups.save(roleGroup))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().roleGroups.delete(id))
    await load()
  }

  return { roleGroups, ...asyncState, load, save, remove }
})
