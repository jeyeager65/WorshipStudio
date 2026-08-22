import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { Theme } from '@/models/library'

export const useThemesStore = defineStore('themes', () => {
  const themes = ref<Theme[]>([])
  const asyncState = useAsyncStoreState('themes')

  async function load() {
    return asyncState.runLoad(async () => {
      themes.value = await getAdapter().themes.list()
    })
  }

  async function save(theme: Theme) {
    await asyncState.runMutation(() => getAdapter().themes.save(theme))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().themes.delete(id))
    await load()
  }

  return { themes, ...asyncState, load, save, remove }
})
