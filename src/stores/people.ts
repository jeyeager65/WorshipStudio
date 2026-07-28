import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Person } from '@/models/library'

export const usePeopleStore = defineStore('people', () => {
  const people = ref<Person[]>([])
  const loaded = ref(false)

  async function load() {
    people.value = await getAdapter().people.list()
    loaded.value = true
  }

  async function save(person: Person) {
    await getAdapter().people.save(person)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().people.delete(id)
    await load()
  }

  return { people, loaded, load, save, remove }
})
