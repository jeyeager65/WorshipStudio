import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Song } from '@/models/song'

export const useSongsStore = defineStore('songs', () => {
  const songs = ref<Song[]>([])
  const loaded = ref(false)

  async function load() {
    songs.value = await getAdapter().songs.list()
    loaded.value = true
  }

  async function save(song: Song) {
    await getAdapter().songs.save(song)
    await load()
  }

  async function remove(id: string) {
    await getAdapter().songs.delete(id)
    await load()
  }

  async function importFromOpenSong() {
    const imported = await getAdapter().songs.importFromOpenSongFiles()
    if (imported.length > 0) await load()
    return imported
  }

  return { songs, loaded, load, save, remove, importFromOpenSong }
})
