<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Song } from '@/models/song'

const songs = ref<Song[]>([])

onMounted(async () => {
  songs.value = await getAdapter().songs.list()
})
</script>

<template>
  <v-container>
    <h1 class="text-h5 mb-4">Song Library</h1>
    <v-list>
      <v-list-item v-for="song in songs" :key="song.id" :title="song.title" :subtitle="song.author" />
    </v-list>
  </v-container>
</template>
