import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { SlideLibraryItem } from '@/models/library'

export const useSlidesStore = defineStore('slides', () => {
  const slides = ref<SlideLibraryItem[]>([])
  const loaded = ref(false)

  async function load() {
    slides.value = await getAdapter().slides.list()
    loaded.value = true
  }

  async function save(item: SlideLibraryItem) {
    await getAdapter().slides.save(item)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().slides.delete(id)
    await load()
  }

  return { slides, loaded, load, save, remove }
})
