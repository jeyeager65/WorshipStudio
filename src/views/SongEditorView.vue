<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import type { Song, SongBlock } from '@/models/song'
import type { LibrarySettings } from '@/models/settings'

const route = useRoute()
const router = useRouter()
const store = useSongsStore()

const song = ref<Song>()
const librarySettings = ref<LibrarySettings>()

onMounted(async () => {
  const [loadedSong, settings] = await Promise.all([
    getAdapter().songs.get(route.params.id as string),
    getAdapter().settings.getLibrarySettings(),
  ])
  song.value = loadedSong
  librarySettings.value = settings
})

async function persist() {
  if (song.value) await store.save(song.value)
}

const usageLabel = computed(() => {
  if (!song.value) return ''
  const { lastUsedAt, usesPastYear } = song.value.usage
  if (usesPastYear === 0) return 'Not yet used'
  const last = lastUsedAt ? new Date(lastUsedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : undefined
  return last ? `Last used ${last} · used ${usesPastYear}x this year` : `Used ${usesPastYear}x this year`
})

function addCollection() {
  song.value?.collections.push({ collectionId: '' })
}
function removeCollection(index: number) {
  song.value?.collections.splice(index, 1)
  persist()
}

function addBlock() {
  song.value?.blocks.push({ id: `block-${crypto.randomUUID()}`, label: 'New Part', text: '' })
}
function removeBlock(index: number) {
  if (!song.value) return
  const [removed] = song.value.blocks.splice(index, 1)
  if (removed) {
    song.value.defaultArrangement.sequence = song.value.defaultArrangement.sequence.filter((id) => id !== removed.id)
  }
  persist()
}
function blockLabel(id: string): string {
  return song.value?.blocks.find((block) => block.id === id)?.label ?? id
}
function addToArrangement(block: SongBlock) {
  song.value?.defaultArrangement.sequence.push(block.id)
  persist()
}
function removeFromArrangement(index: number) {
  song.value?.defaultArrangement.sequence.splice(index, 1)
  persist()
}
</script>

<template>
  <div v-if="song">
    <v-toolbar density="compact" elevation="0" class="border-b px-2">
      <v-btn variant="text" prepend-icon="mdi-chevron-left" @click="router.push('/library/songs')">
        Song Library
      </v-btn>
    </v-toolbar>

    <div class="editor-layout">
      <div class="editor-panel">
        <v-text-field
          v-model="song.title"
          variant="plain"
          class="text-h5 font-weight-bold"
          density="compact"
          hide-details
          @blur="persist"
        />

        <div class="d-flex flex-wrap ga-4 mt-2 mb-6 align-end">
          <v-text-field v-model="song.key" label="Key" variant="outlined" density="compact" style="width: 100px" @blur="persist" />
          <v-text-field v-model="song.tempo" label="Tempo" variant="outlined" density="compact" style="width: 120px" @blur="persist" />
          <v-text-field v-model="song.ccli" label="CCLI #" variant="outlined" density="compact" style="width: 130px" @blur="persist" />
          <v-text-field v-model="song.author" label="Author" variant="outlined" density="compact" style="width: 220px" @blur="persist" />
          <v-combobox
            v-model="song.tags"
            label="Tags"
            variant="outlined"
            density="compact"
            multiple
            chips
            closable-chips
            style="min-width: 220px"
            @update:model-value="persist"
          />
          <span class="text-caption text-medium-emphasis ml-auto mb-2">{{ usageLabel }}</span>
        </div>

        <div class="text-overline text-medium-emphasis mb-2">Collections</div>
        <div v-for="(entry, index) in song.collections" :key="index" class="d-flex ga-3 mb-2" style="max-width: 480px">
          <v-combobox
            v-model="entry.collectionId"
            :items="librarySettings?.collections ?? []"
            label="Collection"
            variant="outlined"
            density="compact"
            class="flex-grow-1"
            @update:model-value="persist"
          />
          <v-text-field
            v-model="entry.number"
            label="#"
            variant="outlined"
            density="compact"
            style="width: 90px"
            @blur="persist"
          />
          <v-btn icon="mdi-close" variant="text" density="compact" @click="removeCollection(index)" />
        </div>
        <v-btn variant="text" prepend-icon="mdi-plus" size="small" class="mb-6" @click="addCollection">
          Add to Another Collection
        </v-btn>

        <div class="text-overline text-medium-emphasis mb-2">Song Blocks</div>
        <VueDraggable v-model="song.blocks" handle=".drag-handle" :animation="150" class="d-flex flex-column ga-3" @end="persist">
          <v-card v-for="(block, index) in song.blocks" :key="block.id" variant="outlined" rounded="lg">
            <div class="d-flex align-center ga-2 px-3 py-2 border-b block-header">
              <v-icon icon="mdi-drag-vertical" class="drag-handle" style="cursor: grab" />
              <v-text-field
                v-model="block.label"
                variant="plain"
                density="compact"
                hide-details
                class="font-weight-bold flex-grow-1"
                @blur="persist"
              />
              <v-btn variant="text" size="small" @click="removeBlock(index)">Remove</v-btn>
            </div>
            <v-textarea v-model="block.text" variant="plain" density="compact" rows="3" auto-grow hide-details class="px-3 py-2" @blur="persist" />
          </v-card>
        </VueDraggable>
        <v-btn variant="outlined" prepend-icon="mdi-plus" class="mt-3 mb-6" @click="addBlock">Add Block</v-btn>

        <div class="text-overline text-medium-emphasis mb-2">Notes</div>
        <v-textarea
          v-model="song.notes"
          variant="outlined"
          placeholder="Notes about this song — arrangement tips, key changes, performance reminders…"
          rows="3"
          @blur="persist"
        />
      </div>

      <div class="arrangement-panel">
        <div class="text-overline text-medium-emphasis mb-1">Default Arrangement</div>
        <p class="text-caption text-medium-emphasis mb-4">
          Used when this song is added to a service. Each service can override its own copy without changing this.
        </p>

        <VueDraggable
          v-model="song.defaultArrangement.sequence"
          handle=".drag-handle"
          :animation="150"
          class="d-flex flex-column ga-2"
          @end="persist"
        >
          <div
            v-for="(id, index) in song.defaultArrangement.sequence"
            :key="index"
            class="d-flex align-center ga-1 pa-2 border rounded-lg arrangement-item"
          >
            <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
            <span class="text-body-2 flex-grow-1">{{ blockLabel(id) }}</span>
            <v-btn icon="mdi-close" variant="text" density="compact" size="x-small" @click="removeFromArrangement(index)" />
          </div>
        </VueDraggable>

        <div class="mt-4">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">Add:</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="block in song.blocks"
              :key="block.id"
              variant="outlined"
              color="primary"
              size="small"
              class="cursor-pointer"
              @click="addToArrangement(block)"
            >
              {{ block.label }}
            </v-chip>
          </div>
        </div>
      </div>
    </div>
  </div>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Song not found.</p>
  </v-container>
</template>

<style scoped>
.editor-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  align-items: start;
}
.editor-panel {
  padding: 24px 32px;
}
.arrangement-panel {
  padding: 20px;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: calc(100vh - 49px);
}
.block-header {
  background: rgba(var(--v-theme-secondary), 0.1);
}
.arrangement-item {
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
