import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { SlideLibraryItem } from '@/models/library'

export const useSlidesStore = defineStore('slides', () => {
  const slides = ref<SlideLibraryItem[]>([])
  const asyncState = useAsyncStoreState('slides')

  async function load() {
    return asyncState.runLoad(async () => {
      slides.value = await getAdapter().slides.list()
    })
  }

  async function save(item: SlideLibraryItem) {
    await asyncState.runMutation(() => getAdapter().slides.save(item))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().slides.delete(id))
    await load()
  }

  return { slides, ...asyncState, load, save, remove }
})
