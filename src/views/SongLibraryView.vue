<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSongsStore } from '@/stores/songs'
import { useUndoStore } from '@/stores/undo'
import type { Song } from '@/models/song'

const router = useRouter()
const store = useSongsStore()
const undoStore = useUndoStore()

const query = ref('')
const importing = ref(false)
// Deletion is soft until the undo toast expires (spec section 16) — the actual
// store.remove()/adapter delete only fires in onExpire, so Undo can still fully reverse it.
// Held locally rather than mutating store.songs directly, so an unrelated reload elsewhere
// (e.g. creating another song) can't resurrect a pending delete before it's actually final.
const pendingDeleteIds = reactive(new Set<string>())

onMounted(() => {
  if (!store.loaded) store.load()
})

const filteredSongs = computed(() => {
  const q = query.value.trim().toLowerCase()
  const sorted = [...store.songs].filter((song) => !pendingDeleteIds.has(song.id)).sort((a, b) => a.title.localeCompare(b.title))
  if (!q) return sorted
  return sorted.filter((song) => [song.title, song.author].some((field) => field?.toLowerCase().includes(q)))
})

function deleteSong(song: Song) {
  pendingDeleteIds.add(song.id)
  undoStore.push(
    `Deleted "${song.title}"`,
    () => pendingDeleteIds.delete(song.id),
    async () => {
      await store.remove(song.id)
      pendingDeleteIds.delete(song.id)
    },
  )
}

// The new song only exists in memory until the editor's Save button is used (see
// SongEditorView) — creating it here immediately would leave a blank file on disk the
// moment this button is clicked, even if the user backs out without entering anything.
function createSong() {
  router.push('/library/songs/new')
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
    <div class="d-flex align-center mb-6 ga-3">
      <h1 class="text-h5 font-weight-bold flex-grow-1">Song Library</h1>
      <v-btn variant="flat" color="secondary" prepend-icon="mdi-file-import" :loading="importing" @click="importFromOpenSong">
        Import from OpenSong
      </v-btn>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="createSong">New Song</v-btn>
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
        class="border mb-2 song-row"
      >
        <template #append>
          <span class="text-caption text-medium-emphasis mr-2">{{ song.usage.usesPastYear }}x this year</span>
          <v-btn
            icon="mdi-trash-can-outline"
            variant="flat"
            color="error"
            size="small"
            class="row-remove"
            @click.stop.prevent="deleteSong(song)"
          />
        </template>
      </v-list-item>
    </v-list>

    <p v-if="filteredSongs.length === 0" class="text-medium-emphasis text-body-2">No songs found.</p>
  </v-container>
</template>

<style scoped>
.row-remove {
  opacity: 0;
}
.song-row:hover .row-remove {
  opacity: 1;
}
</style>
