import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { Person } from '@/models/library'

export const usePeopleStore = defineStore('people', () => {
  const people = ref<Person[]>([])
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      people.value = await getAdapter().people.list()
    })
  }

  async function save(person: Person) {
    await asyncState.runMutation(() => getAdapter().people.save(person))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().people.delete(id))
    await load()
  }

  return { people, ...asyncState, load, save, remove }
})
