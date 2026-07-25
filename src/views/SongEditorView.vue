<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { colorForBlockLabel } from '@/utils/contentColors'
import type { Song, SongBlock } from '@/models/song'
import type { LibrarySettings } from '@/models/settings'

const route = useRoute()
const router = useRouter()
const store = useSongsStore()
const { isDirty } = storeToRefs(useUnsavedChangesStore())

const song = ref<Song>()
const librarySettings = ref<LibrarySettings>()
const saving = ref(false)

onMounted(async () => {
  const [loadedSong, settings] = await Promise.all([
    getAdapter().songs.get(route.params.id as string),
    getAdapter().settings.getLibrarySettings(),
  ])
  song.value = loadedSong
  librarySettings.value = settings
  isDirty.value = false
  // Registered after the initial load so it only reacts to actual user edits, not the
  // assignment above — a single deep watch instead of wiring a dirty-flag handler onto
  // every field individually.
  watch(song, () => (isDirty.value = true), { deep: true })
})

onUnmounted(() => (isDirty.value = false))

async function saveSong() {
  if (!song.value || saving.value) return
  saving.value = true
  try {
    await store.save(song.value)
    isDirty.value = false
  } finally {
    saving.value = false
  }
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
}
function blockLabel(id: string): string {
  return song.value?.blocks.find((block) => block.id === id)?.label ?? id
}
function addToArrangement(block: SongBlock) {
  song.value?.defaultArrangement.sequence.push(block.id)
}
function removeFromArrangement(index: number) {
  song.value?.defaultArrangement.sequence.splice(index, 1)
}
</script>

<template>
  <div v-if="song">
    <v-toolbar density="compact" elevation="0" class="border-b px-2">
      <v-btn variant="flat" color="secondary" prepend-icon="mdi-chevron-left" @click="router.push('/library/songs')">
        Song Library
      </v-btn>
      <v-spacer />
      <span class="text-caption text-medium-emphasis mr-3">
        {{ saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'All changes saved' }}
      </span>
      <v-btn
        variant="flat"
        color="primary"
        prepend-icon="mdi-content-save"
        :loading="saving"
        :disabled="!isDirty"
        @click="saveSong"
      >
        Save
      </v-btn>
    </v-toolbar>

    <div class="editor-layout">
      <div class="editor-panel">
        <v-text-field
          v-model="song.title"
          variant="filled"
          density="compact"
          rounded="lg"
          class="text-h5 font-weight-bold mb-1 song-title-field"
          hide-details
        />

        <div class="text-overline text-medium-emphasis mb-2 mt-2">General</div>
        <div class="d-flex flex-wrap ga-4 mb-1 align-end">
          <v-text-field v-model="song.ccli" label="CCLI #" variant="outlined" density="compact" style="width: 130px" />
          <v-text-field v-model="song.author" label="Author" variant="outlined" density="compact" style="width: 220px" />
          <v-combobox
            v-model="song.tags"
            label="Tags"
            variant="outlined"
            density="compact"
            multiple
            chips
            closable-chips
            style="min-width: 220px"
          />
        </div>
        <p class="text-caption text-medium-emphasis mb-6">{{ usageLabel }}</p>

        <div class="text-overline text-medium-emphasis mb-2">Collections</div>
        <div v-for="(entry, index) in song.collections" :key="index" class="d-flex ga-3 mb-2" style="max-width: 480px">
          <v-combobox
            v-model="entry.collectionId"
            :items="librarySettings?.collections ?? []"
            label="Collection"
            variant="outlined"
            density="compact"
            class="flex-grow-1"
          />
          <v-text-field v-model="entry.number" label="#" variant="outlined" density="compact" style="width: 90px" />
          <v-btn icon="mdi-trash-can-outline" variant="flat" color="error" size="small" @click="removeCollection(index)" />
        </div>
        <v-btn variant="flat" color="primary" class="mb-6" prepend-icon="mdi-plus" @click="addCollection">
          Add To Collection
        </v-btn>

        <div class="text-overline text-medium-emphasis mb-2">Song Blocks</div>
        <VueDraggable v-model="song.blocks" handle=".drag-handle" :animation="150" class="d-flex flex-column ga-3">
          <v-card
            v-for="(block, index) in song.blocks"
            :key="block.id"
            variant="outlined"
            rounded="lg"
            :style="{
              borderColor: `rgb(var(--v-theme-${colorForBlockLabel(block.label)}))`,
              '--block-accent': `rgb(var(--v-theme-${colorForBlockLabel(block.label)}))`,
              '--block-accent-rgb': `var(--v-theme-${colorForBlockLabel(block.label)})`,
            }"
          >
            <div class="d-flex align-center ga-2 px-3 py-2 border-b block-header">
              <v-icon icon="mdi-drag-vertical" class="drag-handle" style="cursor: grab" />
              <v-text-field
                v-model="block.label"
                variant="filled"
                density="compact"
                rounded="lg"
                hide-details
                :color="colorForBlockLabel(block.label)"
                class="font-weight-bold flex-grow-1 block-label-field"
              />
              <v-btn variant="flat" color="error" prepend-icon="mdi-trash-can-outline" @click="removeBlock(index)">
                Remove
              </v-btn>
            </div>
            <v-textarea
              v-model="block.text"
              variant="filled"
              density="compact"
              rows="3"
              auto-grow
              hide-details
              class="px-3 py-2 block-text-field"
            />
          </v-card>
        </VueDraggable>
        <v-btn variant="flat" color="primary" class="mt-3 mb-6" prepend-icon="mdi-plus" @click="addBlock">
          Add Block
        </v-btn>

        <div class="text-overline text-medium-emphasis mb-2">Notes</div>
        <v-textarea
          v-model="song.notes"
          variant="outlined"
          placeholder="Notes about this song — arrangement tips, key changes, performance reminders…"
          rows="3"
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
        >
          <div
            v-for="(id, index) in song.defaultArrangement.sequence"
            :key="index"
            class="d-flex align-center ga-1 pa-2 border rounded-lg arrangement-item"
            :style="{
              background: `rgba(var(--v-theme-${colorForBlockLabel(blockLabel(id))}), 0.1)`,
              borderLeft: `3px solid rgb(var(--v-theme-${colorForBlockLabel(blockLabel(id))}))`,
            }"
          >
            <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
            <span class="text-body-2 flex-grow-1">{{ blockLabel(id) }}</span>
            <v-btn icon="mdi-trash-can-outline" variant="flat" color="error" size="small" @click="removeFromArrangement(index)" />
          </div>
        </VueDraggable>

        <div class="mt-4">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">Add:</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="block in song.blocks"
              :key="block.id"
              variant="outlined"
              :color="colorForBlockLabel(block.label)"
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
/* arrangement-item backgrounds are set inline per block category — see colorForBlockLabel
   in src/utils/contentColors.ts. block-header uses --block-accent-rgb (set inline on the
   parent v-card, see below) since it also needs to reach the sibling lyric textarea. */
.block-header {
  background: rgba(var(--block-accent-rgb), 0.12);
}

/* Vuetify's color prop tints the underline but not the typed text itself; --block-accent
   (set inline on the block's v-card) pierces into the field's actual input element via
   :deep() so the label text picks up the category color too. */
.block-label-field :deep(.v-field__input) {
  color: var(--block-accent);
}
/* The header row already has a category-tinted background; the field's own default fill
   either blends into it (too subtle) or, with a flat gray/white box, reads as a foreign
   element dropped onto an otherwise color-themed block. A stronger tint of the block's own
   category color (via --block-accent) stays visually part of the block while still reading
   as a distinct, editable box — Vuetify's own "filled" variant renders a white
   .v-field__overlay on top at partial opacity, which would wash out a custom color
   underneath, so that overlay is suppressed here in favor of our own. */
.block-label-field :deep(.v-field) {
  background: rgba(var(--block-accent-rgb), 0.3);
  border: 1px solid rgba(var(--block-accent-rgb), 0.6);
}
.block-label-field :deep(.v-field__overlay) {
  opacity: 0;
}
/* Filled/underlined variants render their own bottom line via .v-field__outline — redundant
   and a bit odd now that the field already has a full border. Suppress it, but make the
   focus state bold so it's still obvious which field is being edited. */
.block-label-field :deep(.v-field__outline),
.song-title-field :deep(.v-field__outline) {
  display: none;
}
.block-label-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: var(--block-accent);
}

/* Lyric text box: same "this is editable" language (visible fill, border, bold on focus)
   as the label field, but explicitly neutral — the block's category color stays on the
   label/border/chips; the actual lyric text stays plain and readable, not tinted. */
.block-text-field :deep(.v-field) {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.block-text-field :deep(.v-field__overlay) {
  opacity: 0;
}
.block-text-field :deep(.v-field__outline) {
  display: none;
}
.block-text-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: var(--block-accent);
}

/* Song title: same "colored box" language as the block label fields (primary, since the
   song itself is the default/primary content type), just without a per-block accent. */
.song-title-field :deep(.v-field) {
  background: rgba(var(--v-theme-primary), 0.3);
  border: 1px solid rgba(var(--v-theme-primary), 0.6);
}
.song-title-field :deep(.v-field__overlay) {
  opacity: 0;
}
.song-title-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: rgb(var(--v-theme-primary));
}
</style>
