import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { Song } from '@/models/song'

export const useSongsStore = defineStore('songs', () => {
  const songs = ref<Song[]>([])
  const asyncState = useAsyncStoreState('songs')

  async function load() {
    return asyncState.runLoad(async () => {
      songs.value = await getAdapter().songs.list()
    })
  }

  async function save(song: Song) {
    await asyncState.runMutation(() => getAdapter().songs.save(song))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().songs.delete(id))
    await load()
  }

  async function importFromOpenSong() {
    const imported = await asyncState.runMutation(() =>
      getAdapter().songs.importFromOpenSongFiles(),
    )
    if (imported.length > 0) await load()
    return imported
  }

  return { songs, ...asyncState, load, save, remove, importFromOpenSong }
})
