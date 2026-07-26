import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Volunteer } from '@/models/library'

export const useVolunteersStore = defineStore('volunteers', () => {
  const volunteers = ref<Volunteer[]>([])
  const loaded = ref(false)

  async function load() {
    volunteers.value = await getAdapter().volunteers.list()
    loaded.value = true
  }

  async function save(volunteer: Volunteer) {
    await getAdapter().volunteers.save(volunteer)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().volunteers.delete(id)
    await load()
  }

  return { volunteers, loaded, load, save, remove }
})
