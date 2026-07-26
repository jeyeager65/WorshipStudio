import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Theme } from '@/models/library'

export const useThemesStore = defineStore('themes', () => {
  const themes = ref<Theme[]>([])
  const loaded = ref(false)

  async function load() {
    themes.value = await getAdapter().themes.list()
    loaded.value = true
  }

  async function save(theme: Theme) {
    await getAdapter().themes.save(theme)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().themes.delete(id)
    await load()
  }

  return { themes, loaded, load, save, remove }
})
