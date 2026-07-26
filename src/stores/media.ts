import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { MediaItem } from '@/models/library'

export const useMediaStore = defineStore('media', () => {
  const items = ref<MediaItem[]>([])
  const loaded = ref(false)

  async function load() {
    items.value = await getAdapter().media.list()
    loaded.value = true
  }

  async function save(item: MediaItem) {
    await getAdapter().media.save(item)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().media.delete(id)
    await load()
  }

  return { items, loaded, load, save, remove }
})
