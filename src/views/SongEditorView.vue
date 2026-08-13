<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { colorForBlockLabel } from '@/utils/contentColors'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import EditorNotFoundState from '@/components/EditorNotFoundState.vue'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import type { Song, SongBlock } from '@/models/song'
import type { LibrarySettings } from '@/models/settings'

const route = useRoute()
const router = useRouter()
const store = useSongsStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()

const song = ref<Song>()
const librarySettings = ref<LibrarySettings>()
const editorLoading = ref(true)
const editorLoadError = ref('')
const notFound = ref(false)
const documentHistory = useDocumentHistory(song, 'song')

// "New Song" (SongLibraryView) navigates straight here with id "new" rather than saving a
// blank file first — nothing is written to disk until Save is pressed, so backing out
// without saving leaves no trace.
function blankSong(): Song {
  return {
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
}

// `watch` called after an `await` (inside onMounted's async callback) runs outside Vue's
// synchronous component-setup tracking, so it isn't auto-stopped on unmount — stopping it
// explicitly is what actually scopes it to this view's lifetime rather than leaking forever.
onMounted(loadEditor)

async function loadEditor() {
  documentHistory.stop()
  editorLoading.value = true
  editorLoadError.value = ''
  notFound.value = false
  const isNew = route.params.id === 'new'
  try {
    const [loadedSong, settings] = await Promise.all([
      isNew ? Promise.resolve(blankSong()) : getAdapter().songs.get(route.params.id as string),
      getAdapter().settings.getLibrarySettings(),
    ])
    if (!loadedSong) {
      song.value = undefined
      notFound.value = true
      return
    }
    song.value = loadedSong
    librarySettings.value = settings
    // A freshly created song is inherently unsaved — starting dirty (rather than false, as
    // for an existing song) enables the Save button and the router guard's
    // leave-without-saving warning immediately, so it's never silently lost with no way to
    // recover it.
    isDirty.value = isNew
    // Start history after loading so the persisted document is the non-undoable baseline.
    documentHistory.start((dirty) => (isDirty.value = dirty), isNew)
    // The Save button itself lives in the persistent app bar (App.vue), not a per-page
    // toolbar that would scroll out of view — this view just supplies the action.
    saveHandler.value = saveSong
  } catch (error) {
    song.value = undefined
    editorLoadError.value = errorMessage(error)
  } finally {
    editorLoading.value = false
  }
}

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveSong() {
  if (!song.value || saving.value) return
  saving.value = true
  try {
    await store.save(song.value)
    isDirty.value = false
    // First save of a new song — swap the placeholder URL for the real id so refresh and
    // any subsequent save target the actual persisted song.
    if (route.params.id === 'new') await router.replace(`/library/songs/${song.value.id}`)
  } finally {
    saving.value = false
  }
}

const usageLabel = computed(() => {
  if (!song.value) return ''
  const { lastUsedAt, usesPastYear } = song.value.usage
  // A song can have a lastUsedAt with usesPastYear still 0 — used before, just not within the
  // last 365 days (recompute_usage tracks these independently; a song doesn't need any use in
  // the past year to have ever been used at all).
  if (!lastUsedAt) return 'Not yet used'
  const last = new Date(`${lastUsedAt}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return usesPastYear > 0
    ? `Last used ${last} · used ${usesPastYear}x this year`
    : `Last used ${last}`
})

function addCollection() {
  song.value?.collections.push({ collectionId: '' })
}
async function removeCollection(index: number) {
  if (!song.value) return
  const removed = song.value.collections[index]
  if (!removed) return
  if (!(await confirmDialog.confirm(`Remove "${removed.collectionId || 'collection'}"?`, 'Remove')))
    return
  song.value.collections.splice(index, 1)
}

function addBlock() {
  song.value?.blocks.push({ id: `block-${crypto.randomUUID()}`, label: 'New Part', text: '' })
}
async function removeBlock(index: number) {
  if (!song.value) return
  const removed = song.value.blocks[index]
  if (!removed) return
  if (!(await confirmDialog.confirm(`Remove "${removed.label}"?`, 'Remove'))) return
  song.value.blocks.splice(index, 1)
  song.value.defaultArrangement.sequence = song.value.defaultArrangement.sequence.filter(
    (id) => id !== removed.id,
  )
}
function blockLabel(id: string): string {
  return song.value?.blocks.find((block) => block.id === id)?.label ?? id
}
function addToArrangement(block: SongBlock) {
  song.value?.defaultArrangement.sequence.push(block.id)
}
function removeFromArrangement(index: number) {
  if (!song.value) return
  // No confirmation — this only removes the block's appearance in the sequence, not the block
  // itself (still available to add back from the block list), and undo/redo already covers it.
  song.value.defaultArrangement.sequence.splice(index, 1)
}
</script>

<template>
  <AsyncLoadState
    v-if="editorLoading || editorLoadError"
    :loading="editorLoading"
    :error="editorLoadError"
    label="song"
    @retry="loadEditor"
  />
  <EditorNotFoundState
    v-else-if="notFound"
    icon="mdi-music-note-off"
    title="Song Not Found"
    message="This song may have been deleted or moved."
    :back-to="{ path: '/library/songs' }"
    back-label="Back to Songs"
  />
  <main v-else-if="song" class="song-editor-page">
    <header class="editor-header">
      <div class="header-content">
        <v-btn to="/library/songs" variant="text" prepend-icon="mdi-arrow-left" class="back-button"
          >Songs</v-btn
        >
        <div class="title-row">
          <div class="title-copy">
            <div class="eyebrow">Song Editor</div>
            <h1 class="song-title">{{ song.title || 'Untitled Song' }}</h1>
          </div>
          <div class="usage-status">
            <v-icon icon="mdi-history" size="18" />
            <span>{{ usageLabel }}</span>
          </div>
        </div>
      </div>
    </header>

    <div class="editor-layout">
      <div class="editor-main">
        <v-alert
          v-if="store.mutationError"
          type="error"
          variant="tonal"
          closable
          class="mb-4"
          @click:close="store.clearMutationError"
        >
          Song changes were not saved: {{ store.mutationError }}
        </v-alert>
        <section class="editor-section">
          <div class="section-heading">
            <div>
              <h2>Song Details</h2>
              <p>Information used to identify and organize this song.</p>
            </div>
          </div>
          <div class="details-grid">
            <v-text-field
              v-model="song.title"
              label="Song Title"
              variant="outlined"
              density="compact"
              hide-details
            />
            <div class="details-row">
              <v-text-field
                v-model="song.author"
                label="Author"
                variant="outlined"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model="song.artist"
                label="Artist"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
            <div class="details-row details-row--tags">
              <v-combobox
                v-model="song.tags"
                label="Tags"
                variant="outlined"
                density="compact"
                multiple
                chips
                closable-chips
                hide-details
                class="tags-field"
              />
              <v-text-field
                v-model="song.ccli"
                label="CCLI Number"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
          </div>
        </section>

        <section class="editor-section">
          <div class="section-heading section-heading-action">
            <div>
              <h2>Collections</h2>
              <p>Place this song in one or more songbooks or library groups.</p>
            </div>
            <v-btn variant="tonal" color="primary" prepend-icon="mdi-plus" @click="addCollection"
              >Add Collection</v-btn
            >
          </div>
          <div v-if="song.collections.length" class="collection-list">
            <div v-for="(entry, index) in song.collections" :key="index" class="collection-row">
              <v-combobox
                v-model="entry.collectionId"
                :items="librarySettings?.collections.map((collection) => collection.name) ?? []"
                label="Collection"
                variant="outlined"
                hide-details
              />
              <v-text-field v-model="entry.number" label="Number" variant="outlined" hide-details />
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                color="error"
                aria-label="Remove collection"
                @click="removeCollection(index)"
              />
            </div>
          </div>
          <button v-else type="button" class="empty-inline" @click="addCollection">
            <v-icon icon="mdi-bookshelf" size="24" />
            <span>This song is not in a collection. Add one to make it easier to find.</span>
          </button>
        </section>

        <section class="editor-section lyrics-section">
          <div class="section-heading section-heading-action">
            <div>
              <h2>Lyrics</h2>
              <p>Create reusable sections, then arrange them in the panel on the right.</p>
            </div>
            <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="addBlock"
              >Add Block</v-btn
            >
          </div>
          <VueDraggable
            v-model="song.blocks"
            handle=".drag-handle"
            :animation="150"
            class="block-list"
          >
            <article
              v-for="(block, index) in song.blocks"
              :key="block.id"
              class="lyric-block"
              :style="{
                '--block-accent': `rgb(var(--v-theme-${colorForBlockLabel(block.label)}))`,
                '--block-accent-rgb': `var(--v-theme-${colorForBlockLabel(block.label)})`,
              }"
            >
              <div class="block-rail" />
              <div class="block-content">
                <div class="block-header">
                  <v-icon
                    icon="mdi-drag-vertical"
                    class="drag-handle"
                    aria-label="Drag to reorder"
                  />
                  <span class="block-number">{{ index + 1 }}</span>
                  <v-text-field
                    v-model="block.label"
                    aria-label="Block name"
                    variant="plain"
                    hide-details
                    class="block-label-field"
                  />
                  <v-btn
                    icon="mdi-trash-can-outline"
                    variant="text"
                    color="error"
                    size="small"
                    aria-label="Remove block"
                    @click="removeBlock(index)"
                  />
                </div>
                <v-textarea
                  v-model="block.text"
                  aria-label="Lyrics"
                  variant="outlined"
                  placeholder="Enter lyrics for this block…"
                  rows="4"
                  auto-grow
                  hide-details
                  class="block-text-field"
                />
              </div>
            </article>
          </VueDraggable>
          <button v-if="!song.blocks.length" type="button" class="empty-lyrics" @click="addBlock">
            <v-icon icon="mdi-text-box-plus-outline" size="30" />
            <strong>Add Your First Lyric Block</strong>
            <span>Start with a verse, chorus, or another section.</span>
          </button>
        </section>

        <section class="editor-section">
          <div class="section-heading">
            <div>
              <h2>Notes</h2>
              <p>Keep arrangement details and service reminders with the song.</p>
            </div>
          </div>
          <v-textarea
            v-model="song.notes"
            variant="outlined"
            placeholder="Arrangement tips, key changes, or other reminders…"
            rows="4"
            hide-details
          />
        </section>
      </div>

      <aside class="arrangement-panel">
        <div class="arrangement-heading">
          <div class="arrangement-icon"><v-icon icon="mdi-format-list-numbered" size="21" /></div>
          <div>
            <h2>Default Arrangement</h2>
            <p>Used when this song is added to a service.</p>
          </div>
        </div>

        <VueDraggable
          v-model="song.defaultArrangement.sequence"
          handle=".drag-handle"
          :animation="150"
          class="arrangement-list"
        >
          <div
            v-for="(id, index) in song.defaultArrangement.sequence"
            :key="index"
            class="arrangement-item"
            :style="{
              '--item-accent': `rgb(var(--v-theme-${colorForBlockLabel(blockLabel(id))}))`,
            }"
          >
            <v-icon icon="mdi-drag-vertical" class="drag-handle" size="20" />
            <span class="arrangement-number">{{ index + 1 }}</span>
            <span class="arrangement-label">{{ blockLabel(id) }}</span>
            <v-btn
              icon="mdi-close"
              variant="text"
              size="x-small"
              aria-label="Remove from arrangement"
              @click="removeFromArrangement(index)"
            />
          </div>
        </VueDraggable>
        <div v-if="!song.defaultArrangement.sequence.length" class="arrangement-empty">
          Add lyric blocks below to build the default order.
        </div>

        <div class="add-to-arrangement">
          <div class="add-label">Add Block</div>
          <div v-if="song.blocks.length" class="block-options">
            <button
              v-for="block in song.blocks"
              :key="block.id"
              type="button"
              class="block-option"
              :style="{ '--item-accent': `rgb(var(--v-theme-${colorForBlockLabel(block.label)}))` }"
              @click="addToArrangement(block)"
            >
              <span>{{ block.label }}</span>
              <v-icon icon="mdi-plus" size="18" />
            </button>
          </div>
          <p v-else class="no-blocks">Create a lyric block before building an arrangement.</p>
        </div>
        <p class="arrangement-help">
          Drag items to reorder them. Service arrangements can still be customized independently.
        </p>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.song-editor-page {
  min-height: 100%;
  background:
    radial-gradient(circle at 76% 0, rgba(var(--v-theme-teal), 0.045), transparent 420px),
    rgb(var(--v-theme-background));
}

.editor-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-surface), 0.76);
}

.header-content,
.editor-layout {
  width: min(100%, 1440px);
  margin: 0 auto;
}

.header-content {
  padding: 18px 32px 22px;
}

.back-button {
  margin: 0 0 8px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  text-transform: none;
}

.title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
}

.title-copy {
  flex: 1;
  min-width: 0;
}

.eyebrow {
  margin-bottom: 1px;
  color: rgb(var(--v-theme-teal));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.song-title {
  max-width: 760px;
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: clamp(1.65rem, 2.5vw, 2.2rem);
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 8px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  background: rgba(var(--v-theme-background), 0.42);
  font-size: 0.78rem;
  white-space: nowrap;
}

.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
  padding: 28px 32px 48px;
}

.editor-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 20px;
}

.editor-section,
.arrangement-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}

.editor-section {
  padding: 22px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.section-heading h2,
.arrangement-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
}

.section-heading p,
.arrangement-heading p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.76rem;
  line-height: 1.5;
}

.section-heading-action {
  align-items: center;
}

/* container-type, not another window-width @media breakpoint — .editor-main's actual available
   width here isn't a function of window width alone (it also depends on whether the arrangement
   panel sidebar is currently a 320-360px column vs. gone entirely below 820px, and on the app
   nav's own collapsed/expanded state), so a media query can't reliably tell when these rows
   actually have room. A container query measures the real available width directly. */
.details-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  container-type: inline-size;
}

.details-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr);
  gap: 14px;
}

/* Tags (a multi-select combobox with chips) benefits from more room than CCLI needs, but CCLI
   still gets a flexible share (not a rigid fixed width) so it can take up a bit more of the row
   on wider screens instead of staying pinned narrow. */
.details-row--tags {
  grid-template-columns: minmax(220px, 1.4fr) minmax(150px, 0.8fr);
}

/* 384px is .details-row--tags's own combined minimum (220 + 150 + 14 gap) — the wider of the two
   rows' floors, so both stack together at the same point rather than one wrapping before the
   other. A little headroom above that floor avoids stacking right at the exact pixel it'd start
   to overflow. */
@container (max-width: 420px) {
  .details-row {
    grid-template-columns: 1fr;
  }
}

.editor-section :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
}

.editor-section :deep(.v-field__outline) {
  --v-field-border-opacity: 0.13;
}

.editor-section :deep(.v-field--focused .v-field__outline) {
  --v-field-border-opacity: 0.72;
}

.collection-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.collection-row {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 130px 44px;
  gap: 12px;
  align-items: center;
}

.empty-inline,
.empty-lyrics {
  width: 100%;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.16);
  color: rgba(var(--v-theme-on-surface), 0.56);
  background: rgba(var(--v-theme-background), 0.3);
  cursor: pointer;
}

.empty-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
}

.empty-inline:hover,
.empty-lyrics:hover {
  border-color: rgba(var(--v-theme-teal), 0.4);
  background: rgba(var(--v-theme-teal), 0.045);
}

.block-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lyric-block {
  position: relative;
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.34);
}

.block-rail {
  background: var(--block-accent);
}

.block-content {
  min-width: 0;
  padding: 14px;
}

.block-header {
  display: grid;
  grid-template-columns: 24px 28px minmax(0, 1fr) 36px;
  gap: 8px;
  align-items: center;
  margin-bottom: 11px;
}

.drag-handle {
  color: rgba(var(--v-theme-on-surface), 0.42);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.block-number,
.arrangement-number {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--block-accent);
  background: rgba(var(--block-accent-rgb), 0.13);
  font-size: 0.72rem;
  font-weight: 700;
}

.block-label-field :deep(.v-field__input) {
  min-height: 36px;
  padding: 0 8px;
  color: var(--block-accent);
  font-size: 0.88rem;
  font-weight: 700;
}

.block-label-field :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--block-accent-rgb), 0.08);
}

.block-label-field :deep(.v-field__outline) {
  display: none;
}

.block-label-field :deep(.v-field--focused) {
  box-shadow: inset 0 0 0 1px var(--block-accent);
}

.block-text-field :deep(textarea) {
  font-size: 0.86rem;
  line-height: 1.55;
}

.empty-lyrics {
  display: flex;
  min-height: 150px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 9px;
  font: inherit;
}

.empty-lyrics strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.86rem;
}

.empty-lyrics span {
  font-size: 0.76rem;
}

.arrangement-panel {
  position: sticky;
  top: 72px;
  overflow: hidden;
  padding: 20px;
}

.arrangement-heading {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding-bottom: 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}

.arrangement-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  color: rgb(var(--v-theme-teal));
  background: rgba(var(--v-theme-teal), 0.11);
}

.arrangement-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.arrangement-item {
  --block-accent: var(--item-accent);
  display: grid;
  grid-template-columns: 22px 24px minmax(0, 1fr) 28px;
  gap: 7px;
  align-items: center;
  min-height: 44px;
  padding: 5px 6px 5px 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-left: 3px solid var(--item-accent);
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.34);
}

.arrangement-number {
  color: var(--item-accent);
  background: transparent;
}

.arrangement-label {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.81rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrangement-empty {
  margin-top: 16px;
  padding: 18px 14px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
  line-height: 1.5;
  text-align: center;
}

.add-to-arrangement {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}

.add-label {
  margin-bottom: 10px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.76rem;
  font-weight: 700;
}

.block-options {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.block-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 38px;
  padding: 7px 10px 7px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-left: 3px solid var(--item-accent);
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.82);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: left;
}

.block-option:hover {
  border-color: color-mix(in srgb, var(--item-accent) 42%, transparent);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.no-blocks,
.arrangement-help {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
  line-height: 1.5;
}

.no-blocks {
  margin: 0;
}

.arrangement-help {
  margin: 16px 0 0;
}

@media (max-width: 1050px) {
  .editor-layout {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}

@media (max-width: 820px) {
  .header-content,
  .editor-layout {
    padding-right: 20px;
    padding-left: 20px;
  }

  .title-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
  }

  .editor-layout {
    grid-template-columns: 1fr;
  }

  .arrangement-panel {
    /* No grid-row override — .arrangement-panel is already second in DOM order after
       .editor-main, so once the layout stacks to one column it naturally lands below the song's
       own details/blocks/collections instead of above them, which is what actually matters here
       (it's the secondary, "reference while editing" panel, not the primary content). */
    position: static;
  }
}

@media (max-width: 560px) {
  .header-content {
    padding: 14px 16px 18px;
  }

  .editor-layout {
    gap: 16px;
    padding: 18px 12px 32px;
  }

  .editor-section,
  .arrangement-panel {
    padding: 16px;
  }

  .section-heading-action {
    align-items: flex-start;
    flex-direction: column;
  }

  .collection-row {
    grid-template-columns: 1fr;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }

  .collection-row > :last-child {
    justify-self: end;
  }
}
</style>
