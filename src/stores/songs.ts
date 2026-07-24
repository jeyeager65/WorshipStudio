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

  return { songs, loaded, load, save }
})
