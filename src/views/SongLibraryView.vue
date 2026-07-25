<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSongsStore } from '@/stores/songs'
import type { Song } from '@/models/song'

const router = useRouter()
const store = useSongsStore()

const query = ref('')
const importing = ref(false)
const creating = ref(false)

onMounted(() => {
  if (!store.loaded) store.load()
})

const filteredSongs = computed(() => {
  const q = query.value.trim().toLowerCase()
  const sorted = [...store.songs].sort((a, b) => a.title.localeCompare(b.title))
  if (!q) return sorted
  return sorted.filter((song) => [song.title, song.author].some((field) => field?.toLowerCase().includes(q)))
})

async function createSong() {
  if (creating.value) return
  creating.value = true
  try {
    const song: Song = {
      id: `song-${crypto.randomUUID()}`,
      title: 'New Song',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
    }
    await store.save(song)
    await router.push(`/library/songs/${song.id}`)
  } finally {
    creating.value = false
  }
}

async function importFromOpenSong() {
  importing.value = true
  try {
    await store.importFromOpenSong()
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
    <v-btn variant="text" prepend-icon="mdi-chevron-left" to="/" class="mb-4">Back to Home</v-btn>

    <div class="d-flex align-center mb-6 ga-3">
      <h1 class="text-h5 font-weight-bold flex-grow-1">Song Library</h1>
      <v-btn variant="outlined" prepend-icon="mdi-file-import" :loading="importing" @click="importFromOpenSong">
        Import from OpenSong
      </v-btn>
      <v-btn color="primary" prepend-icon="mdi-plus" :loading="creating" :disabled="creating" @click="createSong">
        New Song
      </v-btn>
    </div>

    <v-text-field
      v-model="query"
      prepend-inner-icon="mdi-magnify"
      label="Search songs…"
      variant="outlined"
      density="comfortable"
      class="mb-4"
      clearable
    />

    <v-list class="pa-0" bg-color="transparent">
      <v-list-item
        v-for="song in filteredSongs"
        :key="song.id"
        :to="`/library/songs/${song.id}`"
        :title="song.title"
        :subtitle="song.author"
        rounded="lg"
        class="border mb-2"
      >
        <template #append>
          <span class="text-caption text-medium-emphasis">{{ song.usage.usesPastYear }}x this year</span>
        </template>
      </v-list-item>
    </v-list>

    <p v-if="filteredSongs.length === 0" class="text-medium-emphasis text-body-2">No songs found.</p>
  </v-container>
</template>
