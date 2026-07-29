<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useMediaStore } from '@/stores/media'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ImportMediaDialog from '@/components/media/ImportMediaDialog.vue'
import type { MediaItem } from '@/models/library'

const store = useMediaStore()
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

const query = ref('')
const typeFilter = ref<'all' | 'image' | 'video'>('all')
const activeTag = ref<string>()
const importDialogOpen = ref(false)
const editingItem = ref<MediaItem>()
const editTitleInput = ref('')
const editDescriptionInput = ref('')
const editTagsInput = ref('')
const editLocation = ref<'synced' | 'local'>('synced')
const editTitleInvalid = computed(() => !editTitleInput.value.trim())

// Deletion is soft until the undo toast expires — same pattern as SongLibraryView/SlideLibraryView.
const pendingDeleteIds = reactive(new Set<string>())

onMounted(() => {
  if (!store.loaded) store.load()
})

// Resolved lazily and cached by MediaItem id — the grid falls back to the plain icon
// placeholder for whatever doesn't resolve (a mock fixture with no real file behind it, a
// missing/deleted file, etc.) rather than showing an error, same graceful-degradation approach
// live presentation already uses for media (see ServiceWorkspaceView.vue's mediaUrlById).
const previewUrlById = reactive(new Map<string, string>())
async function resolvePreview(id: string) {
  if (previewUrlById.has(id)) return
  const url = await getAdapter().media.getPreviewUrl(id)
  if (url) previewUrlById.set(id, url)
}
// `immediate` covers both a fresh load (items arrive after this view has already mounted) and
// navigating back to an already-loaded library (items are already present on mount).
watch(
  () => store.items.map((item) => item.id),
  (ids) => {
    for (const id of ids) resolvePreview(id)
  },
  { immediate: true },
)

const visibleItems = computed(() => store.items.filter((item) => !pendingDeleteIds.has(item.id)))

const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of visibleItems.value) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

const filteredItems = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (query.value ?? '').trim().toLowerCase()
  return visibleItems.value
    .filter((item) => typeFilter.value === 'all' || item.kind === typeFilter.value)
    .filter((item) => !activeTag.value || item.tags.includes(activeTag.value))
    .filter((item) => !q || item.title.toLowerCase().includes(q) || item.filename.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title))
})

async function deleteItem(item: MediaItem) {
  if (!(await confirmDialog.confirm(`Delete "${item.title}"?`, 'Delete'))) return
  pendingDeleteIds.add(item.id)
  undoStore.push(
    `Deleted "${item.title}"`,
    () => pendingDeleteIds.delete(item.id),
    async () => {
      await store.remove(item.id)
      pendingDeleteIds.delete(item.id)
    },
  )
}

function openEditor(item: MediaItem) {
  editingItem.value = item
  editTitleInput.value = item.title
  editDescriptionInput.value = item.description ?? ''
  editTagsInput.value = item.tags.join(', ')
  editLocation.value = item.location
}

async function saveEdits() {
  if (!editingItem.value || editTitleInvalid.value) return
  await store.save({
    ...editingItem.value,
    title: editTitleInput.value.trim(),
    description: editDescriptionInput.value.trim() || undefined,
    tags: editTagsInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    location: editLocation.value,
  })
  editingItem.value = undefined
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex align-center mb-4 ga-3 flex-wrap">
      <v-spacer />
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="importDialogOpen = true">Import Media</v-btn>
    </div>

    <div class="d-flex align-center ga-3 mb-4 flex-wrap">
      <v-text-field
        v-model="query"
        prepend-inner-icon="mdi-magnify"
        label="Search media…"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        style="max-width: 320px"
      />
      <v-chip-group v-model="typeFilter" mandatory selected-class="text-primary">
        <v-chip value="all" filter variant="outlined">All</v-chip>
        <v-chip value="image" filter variant="outlined">Images</v-chip>
        <v-chip value="video" filter variant="outlined">Video Loops</v-chip>
      </v-chip-group>
    </div>

    <div class="d-flex ga-6">
      <div class="tag-sidebar flex-shrink-0">
        <div class="text-overline text-medium-emphasis mb-2">Tags</div>
        <v-list density="compact" nav class="pa-0">
          <v-list-item :active="!activeTag" rounded="lg" @click="activeTag = undefined">
            All Media
            <template #append><span class="text-caption text-medium-emphasis">{{ visibleItems.length }}</span></template>
          </v-list-item>
          <v-list-item v-for="[tag, count] in tagCounts" :key="tag" :active="activeTag === tag" rounded="lg" @click="activeTag = tag">
            {{ tag }}
            <template #append><span class="text-caption text-medium-emphasis">{{ count }}</span></template>
          </v-list-item>
        </v-list>
      </div>

      <div class="flex-grow-1">
        <div class="media-grid">
          <v-card v-for="item in filteredItems" :key="item.id" variant="outlined" class="media-card" @click="openEditor(item)">
            <div class="media-thumb" :class="item.kind">
              <img
                v-if="item.kind === 'image' && previewUrlById.has(item.id)"
                :src="previewUrlById.get(item.id)"
                class="media-thumb-media"
                alt=""
              />
              <video
                v-else-if="item.kind === 'video' && previewUrlById.has(item.id)"
                :src="previewUrlById.get(item.id)"
                class="media-thumb-media"
                muted
                playsinline
                preload="metadata"
              />
              <v-icon v-else :icon="item.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'" size="28" />
              <v-chip size="x-small" class="type-badge" variant="flat">{{ item.kind === 'video' ? 'LOOP' : 'IMAGE' }}</v-chip>
              <v-chip v-if="item.duplicateOfId" size="x-small" color="warning" class="duplicate-badge" variant="flat">DUPLICATE</v-chip>
            </div>
            <v-card-text class="pa-3">
              <div class="text-body-2 font-weight-bold text-truncate">{{ item.title }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ item.filename }}</div>
              <div v-if="item.description" class="text-caption text-medium-emphasis text-truncate">{{ item.description }}</div>
              <div class="text-caption text-medium-emphasis mt-1">
                {{ item.tags.join(', ') || 'Untagged' }} · used {{ item.usage.usesPastYear }}x
              </div>
              <v-chip v-if="item.location === 'local'" size="x-small" class="mt-1" color="warning" variant="tonal">
                Local Only
              </v-chip>
            </v-card-text>
          </v-card>
        </div>
        <p v-if="filteredItems.length === 0" class="text-medium-emphasis text-body-2">No media found.</p>
      </div>
    </div>

    <ImportMediaDialog v-model="importDialogOpen" @imported="store.load()" />

    <v-dialog :model-value="!!editingItem" max-width="480" @update:model-value="(v) => !v && (editingItem = undefined)">
      <v-card v-if="editingItem">
        <v-card-title>{{ editingItem.title }}</v-card-title>
        <v-card-subtitle>{{ editingItem.filename }}</v-card-subtitle>
        <v-card-text>
          <v-text-field
            v-model="editTitleInput"
            label="Title"
            variant="outlined"
            density="compact"
            class="mb-4"
            :error="editTitleInvalid"
            :error-messages="editTitleInvalid ? ['Title is required'] : []"
          />
          <v-textarea
            v-model="editDescriptionInput"
            label="Description (optional)"
            variant="outlined"
            density="compact"
            rows="2"
            auto-grow
            class="mb-4"
          />
          <v-text-field v-model="editTagsInput" label="Tags (comma-separated)" variant="outlined" density="compact" class="mb-4" />
          <v-select
            v-model="editLocation"
            :items="[
              { title: 'Synced', value: 'synced' },
              { title: 'Local Only', value: 'local' },
            ]"
            label="Location"
            variant="outlined"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" color="error" prepend-icon="mdi-trash-can-outline" @click="deleteItem(editingItem); editingItem = undefined">
            Delete
          </v-btn>
          <v-spacer />
          <v-btn variant="outlined" class="mr-2" @click="editingItem = undefined">Cancel</v-btn>
          <v-btn variant="flat" color="primary" :disabled="editTitleInvalid" @click="saveEdits">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.tag-sidebar {
  width: 200px;
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.media-card {
  cursor: pointer;
}
.media-card:hover {
  border-color: rgb(var(--v-theme-primary));
}
.media-thumb {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.7);
}
.media-thumb.image {
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
}
.media-thumb.video {
  background: linear-gradient(135deg, #22262b, rgb(var(--v-theme-primary)));
}
.media-thumb-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.type-badge {
  position: absolute;
  top: 6px;
  right: 6px;
}
.duplicate-badge {
  position: absolute;
  top: 6px;
  left: 6px;
}
</style>
