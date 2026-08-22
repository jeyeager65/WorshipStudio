import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { SongCollectionDefinition } from '@/models/settings'

export const useSongCollectionsStore = defineStore('songCollections', () => {
  const collections = ref<SongCollectionDefinition[]>([])
  const asyncState = useAsyncStoreState('songCollections')

  async function load() {
    return asyncState.runLoad(async () => {
      collections.value = await getAdapter().songCollections.list()
    })
  }

  async function save(collection: SongCollectionDefinition) {
    await asyncState.runMutation(() => getAdapter().songCollections.save(collection))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().songCollections.delete(id))
    await load()
  }

  return { collections, ...asyncState, load, save, remove }
})
