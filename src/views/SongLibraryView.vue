<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSongsStore } from '@/stores/songs'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { Song } from '@/models/song'

const router = useRouter()
const store = useSongsStore()
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

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
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (query.value ?? '').trim().toLowerCase()
  const sorted = [...store.songs].filter((song) => !pendingDeleteIds.has(song.id)).sort((a, b) => a.title.localeCompare(b.title))
  if (!q) return sorted
  return sorted.filter((song) => {
    if ([song.title, song.author].some((field) => field?.toLowerCase().includes(q))) return true
    if (song.tags.some((tag) => tag.toLowerCase().includes(q))) return true
    return song.collections.some((c) => c.collectionId.toLowerCase().includes(q))
  })
})

// A song's collections/hymnal number, e.g. "Hymns of Grace #184, Worship Hymnal #92" — omits
// the number for a collection that doesn't have one set yet.
function collectionsLabel(song: Song): string {
  return song.collections.map((c) => (c.number ? `${c.collectionId} #${c.number}` : c.collectionId)).join(', ')
}

// Same "Last used <date> · used Nx this year" pattern as the Song Editor's own usage line — see
// domain::songs::recompute_usage (Rust) / recomputeSongUsage (mock adapter), which keep this
// current from the service's own date whenever a service is saved or deleted, not save time.
function usageLabel(song: Song): string {
  const { lastUsedAt, usesPastYear } = song.usage
  // A song can have a lastUsedAt with usesPastYear still 0 — used before, just not within the
  // last 365 days (recompute_usage tracks these independently; a song doesn't need any use in
  // the past year to have ever been used at all).
  if (!lastUsedAt) return 'Not yet used'
  const last = new Date(`${lastUsedAt}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return usesPastYear > 0 ? `Last used ${last} · ${usesPastYear}x this year` : `Last used ${last}`
}

// The same 8 theme colors used to color-code song blocks/service item types elsewhere (see
// utils/contentColors.ts) — a stable per-TAG color (hashed from the tag's own text) so the same
// tag always reads as the same color across every song, unlike the row accent below which is
// one consistent color for every song.
const THEME_COLORS = ['primary', 'secondary', 'teal', 'violet', 'rose', 'amber', 'slate', 'terracotta']
function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return THEME_COLORS[hash % THEME_COLORS.length]
}

async function deleteSong(song: Song) {
  if (!(await confirmDialog.confirm(`Delete "${song.title}"?`, 'Delete'))) return
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
      <v-spacer />
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
        rounded="lg"
        class="border mb-2 song-row"
      >
        <v-list-item-title>{{ song.title }}</v-list-item-title>
        <v-list-item-subtitle v-if="song.author">{{ song.author }}</v-list-item-subtitle>
        <div v-if="song.collections.length" class="text-caption text-medium-emphasis mt-1">
          {{ collectionsLabel(song) }}
        </div>
        <div v-if="song.tags.length" class="mt-1">
          <v-chip v-for="tag in song.tags" :key="tag" size="x-small" :color="tagColor(tag)" variant="flat" class="text-white mr-1 mb-1">
            {{ tag }}
          </v-chip>
        </div>
        <template #append>
          <span class="text-caption text-medium-emphasis mr-2">{{ usageLabel(song) }}</span>
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
/* One consistent color for every row (matching the Songs icon color in the sidebar) — tag
   chips are what vary in color here, not the row itself (see tagColor). */
.song-row {
  background: rgba(var(--v-theme-teal), 0.06);
  border-left: 4px solid rgb(var(--v-theme-teal));
}
.row-remove {
  opacity: 0;
}
.song-row:hover .row-remove {
  opacity: 1;
}
</style>
