import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { MediaItem } from '@/models/library'

export const useMediaStore = defineStore('media', () => {
  const items = ref<MediaItem[]>([])
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      items.value = await getAdapter().media.list()
    })
  }

  async function save(item: MediaItem) {
    await asyncState.runMutation(() => getAdapter().media.save(item))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().media.delete(id))
    await load()
  }

  return { items, ...asyncState, load, save, remove }
})
