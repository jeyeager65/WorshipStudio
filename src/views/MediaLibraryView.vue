<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useMediaStore } from '@/stores/media'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import ImportMediaDialog from '@/components/media/ImportMediaDialog.vue'
import CanvaImportDialog from '@/components/canva/CanvaImportDialog.vue'
import type { MediaItem } from '@/models/library'

const store = useMediaStore()
const confirmDialog = useConfirmDialogStore()

// Tauri-only, same optional-port pattern as DiagnosticsPort.openLogsFolder — no browser/mock
// equivalent, so the button simply doesn't render there rather than opening a dialog that can
// only fail.
const canvaAvailable = !!getAdapter().canva

const query = ref('')
const typeFilter = ref<'all' | 'image' | 'video'>('all')
const activeTag = ref<string>()
const importDialogOpen = ref(false)
const canvaImportOpen = ref(false)
// Set only when opening the Canva dialog to refresh a specific already-imported item (from the
// media-details popup below) — left undefined for the toolbar's own "Import from Canva", which
// should always start at the design list.
const canvaRefreshDesignId = ref<string>()
const canvaRefreshMode = ref<'pages' | 'video'>('pages')
const editingItem = ref<MediaItem>()
const editTitleInput = ref('')
const editDescriptionInput = ref('')
const editTagsInput = ref('')
const editLocation = ref<'synced' | 'local'>('synced')
const editTitleInvalid = computed(() => !editTitleInput.value.trim())
const editorPreviewLoading = ref(false)
const editorPreviewUnavailable = ref(false)
const deleteError = ref('')


onMounted(() => {
  if (!store.loaded) store.load()
})

// Resolved lazily and cached by MediaItem id. Missing/deleted files retain a clear type
// placeholder instead of showing a broken image, matching live presentation's behavior.
const previewUrlById = reactive(new Map<string, string>())
async function resolvePreview(id: string): Promise<string | undefined> {
  if (previewUrlById.has(id)) return previewUrlById.get(id)
  try {
    const url = await getAdapter().media.getPreviewUrl(id)
    if (url) previewUrlById.set(id, url)
    return url
  } catch (error) {
    console.error(`Failed to resolve media preview for ${id}:`, error)
    return undefined
  }
}
watch(
  () => store.items.map((item) => item.id),
  (ids) => {
    for (const id of ids) resolvePreview(id)
  },
  { immediate: true },
)

const visibleItems = computed(() => store.items)
const imageCount = computed(() => visibleItems.value.filter((item) => item.kind === 'image').length)
const videoCount = computed(() => visibleItems.value.filter((item) => item.kind === 'video').length)

const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of visibleItems.value) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }))
})

const filteredItems = computed(() => {
  // Vuetify's clearable button sets the model to null, not ''.
  const q = (query.value ?? '').trim().toLowerCase()
  return visibleItems.value
    .filter((item) => typeFilter.value === 'all' || item.kind === typeFilter.value)
    .filter((item) => !activeTag.value || item.tags.includes(activeTag.value))
    .filter(
      (item) =>
        !q ||
        [item.title, item.filename, item.description].some((field) =>
          field?.toLowerCase().includes(q),
        ) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.title.localeCompare(b.title))
})

const activeFilterCount = computed(
  () => Number(typeFilter.value !== 'all') + Number(!!activeTag.value),
)

function clearFilters() {
  query.value = ''
  typeFilter.value = 'all'
  activeTag.value = undefined
}

function lastUsedLabel(item: MediaItem): string {
  if (!item.usage.lastUsedAt) return 'Not Yet Used'
  const date = new Date(`${item.usage.lastUsedAt}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Last Used ${date}`
}

async function deleteItem(item: MediaItem): Promise<boolean> {
  if (!(await confirmDialog.confirm(`Delete "${item.title}"?`, 'Delete'))) return false
  deleteError.value = ''
  try {
    await store.remove(item.id)
    previewUrlById.delete(item.id)
    return true
  } catch (error) {
    deleteError.value = `Could not delete “${item.title}”: ${error instanceof Error ? error.message : String(error)}`
    await store.load()
    return false
  }
}

const editorPreviewUrl = computed(() =>
  editingItem.value ? previewUrlById.get(editingItem.value.id) : undefined,
)

async function openEditor(item: MediaItem) {
  editingItem.value = item
  editTitleInput.value = item.title
  editDescriptionInput.value = item.description ?? ''
  editTagsInput.value = item.tags.join(', ')
  editLocation.value = item.location
  editorPreviewUnavailable.value = false
  editorPreviewLoading.value = !previewUrlById.has(item.id)
  const url = await resolvePreview(item.id)
  // The operator may have selected a different card while this file was resolving.
  if (editingItem.value?.id !== item.id) return
  editorPreviewLoading.value = false
  editorPreviewUnavailable.value = !url
}

function markEditorPreviewUnavailable() {
  editorPreviewLoading.value = false
  editorPreviewUnavailable.value = true
}

async function deleteEditingItem() {
  const item = editingItem.value
  if (item && (await deleteItem(item))) editingItem.value = undefined
}

function refreshFromCanva(item: MediaItem) {
  if (!item.origin) return
  canvaRefreshDesignId.value = item.origin.designId
  canvaRefreshMode.value = item.origin.type === 'canva-video' ? 'video' : 'pages'
  editingItem.value = undefined
  canvaImportOpen.value = true
}

function openCanvaImport() {
  canvaRefreshDesignId.value = undefined
  canvaImportOpen.value = true
}

async function saveEdits() {
  if (!editingItem.value || editTitleInvalid.value) return
  await store.save({
    ...editingItem.value,
    title: editTitleInput.value.trim(),
    description: editDescriptionInput.value.trim() || undefined,
    tags: editTagsInput.value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    location: editLocation.value,
  })
  editingItem.value = undefined
}
</script>

<template>
  <main class="media-page">
    <header class="media-hero">
      <div>
        <div class="page-eyebrow">Content Library</div>
        <h1>Media</h1>
        <p>Organize images and videos for services, slides, and presentation backgrounds.</p>
      </div>
      <div class="media-summary" aria-label="Media library summary">
        <div class="summary-stat">
          <strong>{{ imageCount }}</strong>
          <span>Images</span>
        </div>
        <div class="summary-stat">
          <strong>{{ videoCount }}</strong>
          <span>Videos</span>
        </div>
        <div class="summary-stat">
          <strong>{{ tagCounts.length }}</strong>
          <span>Tags</span>
        </div>
      </div>
    </header>

    <section class="media-directory">
      <v-alert
        v-if="deleteError"
        type="error"
        variant="tonal"
        closable
        class="ma-4 mb-0"
        @click:close="deleteError = ''"
      >
        {{ deleteError }}
      </v-alert>
      <div class="media-toolbar">
        <div>
          <h2>Media Library</h2>
          <p>
            {{ filteredItems.length }} {{ filteredItems.length === 1 ? 'item' : 'items' }}
            <template v-if="activeFilterCount">
              with {{ activeFilterCount }} active
              {{ activeFilterCount === 1 ? 'filter' : 'filters' }}</template
            >
            <template v-if="query"> matching your search</template>
          </p>
        </div>
        <div class="media-actions">
          <v-text-field
            v-if="visibleItems.length"
            v-model="query"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search title, filename, description, or tag"
            aria-label="Search media"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="media-search"
          />
          <v-btn
            variant="flat"
            color="primary"
            prepend-icon="mdi-plus"
            @click="importDialogOpen = true"
            >Import Media</v-btn
          >
          <v-btn
            v-if="canvaAvailable"
            variant="tonal"
            prepend-icon="mdi-palette-outline"
            @click="openCanvaImport"
            >Import from Canva</v-btn
          >
        </div>
      </div>

      <div
        class="media-directory-body"
        :class="{ 'media-directory-body--empty': visibleItems.length === 0 }"
      >
        <aside v-if="visibleItems.length" class="media-filters" aria-label="Filter media">
          <button
            type="button"
            class="media-filter media-filter--all"
            :class="{ 'media-filter--active': typeFilter === 'all' && !activeTag }"
            @click="clearFilters"
          >
            <span class="media-filter-icon"><v-icon icon="mdi-view-grid-outline" size="18" /></span>
            <span>All Media</span>
            <strong>{{ visibleItems.length }}</strong>
          </button>

          <div class="filter-section">
            <div class="filter-heading">Type</div>
            <button
              type="button"
              class="media-filter media-filter--image"
              :class="{ 'media-filter--active': typeFilter === 'image' }"
              @click="typeFilter = typeFilter === 'image' ? 'all' : 'image'"
            >
              <span class="media-filter-icon"><v-icon icon="mdi-image-outline" size="17" /></span>
              <span>Images</span>
              <strong>{{ imageCount }}</strong>
            </button>
            <button
              type="button"
              class="media-filter media-filter--video"
              :class="{ 'media-filter--active': typeFilter === 'video' }"
              @click="typeFilter = typeFilter === 'video' ? 'all' : 'video'"
            >
              <span class="media-filter-icon"
                ><v-icon icon="mdi-movie-open-outline" size="17"
              /></span>
              <span>Videos</span>
              <strong>{{ videoCount }}</strong>
            </button>
          </div>

          <div class="filter-section">
            <div class="filter-heading">Tags</div>
            <button
              v-for="tag in tagCounts"
              :key="tag.name"
              type="button"
              class="media-filter media-filter--tag"
              :class="{ 'media-filter--active': activeTag === tag.name }"
              @click="activeTag = activeTag === tag.name ? undefined : tag.name"
            >
              <span class="media-filter-icon"><v-icon icon="mdi-tag-outline" size="17" /></span>
              <span>{{ tag.name }}</span>
              <strong>{{ tag.count }}</strong>
            </button>
            <p v-if="tagCounts.length === 0" class="filter-empty">No tags added</p>
          </div>
        </aside>

        <div class="media-results">
          <AsyncLoadState
            v-if="!store.loaded"
            :loading="store.loading"
            :error="store.loadError"
            label="media"
            @retry="store.load"
          />
          <AsyncLoadState
            v-if="store.loaded && store.loadError"
            :loading="false"
            :error="store.loadError"
            label="updated media"
            compact
            class="mb-3"
            @retry="store.load"
          />
          <LibraryEmptyState
            v-if="store.loaded && visibleItems.length === 0"
            icon="mdi-image-plus-outline"
            title="No Media Yet"
            message="Import images and videos to build your presentation library."
          >
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              @click="importDialogOpen = true"
              >Import Media</v-btn
            >
          </LibraryEmptyState>
          <LibraryEmptyState
            v-else-if="store.loaded && filteredItems.length === 0"
            icon="mdi-image-off-outline"
            title="No Media Found"
            message="No media matches the selected type, tag, and search."
          >
            <v-btn variant="text" color="primary" @click="clearFilters">Clear Filters</v-btn>
          </LibraryEmptyState>

          <div v-else-if="store.loaded" class="media-grid">
            <article
              v-for="item in filteredItems"
              :key="item.id"
              class="media-card"
              tabindex="0"
              @click="openEditor(item)"
              @keydown.enter="openEditor(item)"
              @keydown.space.prevent="openEditor(item)"
            >
              <div class="media-thumb" :class="`media-thumb--${item.kind}`">
                <img
                  v-if="item.kind === 'image' && previewUrlById.has(item.id)"
                  :src="previewUrlById.get(item.id)"
                  class="media-thumb-content"
                  alt=""
                />
                <video
                  v-else-if="item.kind === 'video' && previewUrlById.has(item.id)"
                  :src="previewUrlById.get(item.id)"
                  class="media-thumb-content"
                  muted
                  playsinline
                  preload="metadata"
                />
                <span v-else class="media-placeholder">
                  <v-icon
                    :icon="item.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
                    size="34"
                  />
                </span>
                <span class="type-badge">
                  <v-icon
                    :icon="item.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
                    size="14"
                  />
                  {{ item.kind === 'video' ? 'Video' : 'Image' }}
                </span>
                <span v-if="item.duplicateOfId" class="duplicate-badge"
                  ><v-icon icon="mdi-content-duplicate" size="14" />Possible Duplicate</span
                >
              </div>

              <div class="media-card-body">
                <div class="media-card-heading">
                  <div class="media-identity">
                    <h3>{{ item.title }}</h3>
                    <p>{{ item.filename }}</p>
                  </div>
                  <v-menu>
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        icon="mdi-dots-horizontal"
                        variant="text"
                        size="small"
                        aria-label="Media actions"
                        @click.stop
                      />
                    </template>
                    <v-list density="compact">
                      <v-list-item
                        prepend-icon="mdi-pencil-outline"
                        title="Edit Media"
                        @click="openEditor(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-trash-can-outline"
                        title="Delete Media"
                        class="text-error"
                        @click="deleteItem(item)"
                      />
                    </v-list>
                  </v-menu>
                </div>

                <p v-if="item.description" class="media-description">{{ item.description }}</p>
                <p v-else class="media-description media-description--empty">No description</p>

                <div class="media-tags">
                  <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
                  <span v-if="item.tags.length === 0" class="media-no-tags">Untagged</span>
                </div>

                <div class="media-card-footer">
                  <span
                    class="storage-label"
                    :class="{ 'storage-label--local': item.location === 'local' }"
                  >
                    <v-icon
                      :icon="item.location === 'local' ? 'mdi-harddisk' : 'mdi-cloud-check-outline'"
                      size="15"
                    />
                    {{ item.location === 'local' ? 'Local Only' : 'Synced' }}
                  </span>
                  <span class="usage-label">
                    <strong>{{ lastUsedLabel(item) }}</strong>
                    <small>{{ item.usage.usesPastYear }}x This Year</small>
                  </span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <ImportMediaDialog v-model="importDialogOpen" @imported="store.load()" />
    <CanvaImportDialog
      v-model="canvaImportOpen"
      allow-video-export
      :initial-design-id="canvaRefreshDesignId"
      :initial-mode="canvaRefreshMode"
      @imported="() => store.load()"
      @video-imported="() => store.load()"
    />

    <v-dialog
      :model-value="!!editingItem"
      max-width="620"
      @update:model-value="(value) => !value && (editingItem = undefined)"
    >
      <v-card v-if="editingItem" class="media-editor-card">
        <div class="media-editor-header">
          <span
            ><v-icon
              :icon="editingItem.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
              size="22"
          /></span>
          <div>
            <h2>Media Details</h2>
            <p>{{ editingItem.filename }}</p>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="Close Media Details"
            @click="editingItem = undefined"
          />
        </div>

        <div class="media-editor-preview" :class="`media-thumb--${editingItem.kind}`">
          <div v-if="editorPreviewLoading" class="editor-preview-status">
            <v-progress-circular indeterminate color="primary" size="28" width="3" />
            <span>Loading Preview</span>
          </div>
          <img
            v-else-if="
              editingItem.kind === 'image' && editorPreviewUrl && !editorPreviewUnavailable
            "
            :key="editorPreviewUrl"
            :src="editorPreviewUrl"
            alt=""
            @error="markEditorPreviewUnavailable"
          />
          <video
            v-else-if="
              editingItem.kind === 'video' && editorPreviewUrl && !editorPreviewUnavailable
            "
            :key="editorPreviewUrl"
            :src="editorPreviewUrl"
            muted
            controls
            playsinline
            preload="auto"
            @error="markEditorPreviewUnavailable"
          />
          <div v-else class="editor-preview-status editor-preview-status--unavailable">
            <v-icon
              :icon="editingItem.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
              size="34"
            />
            <span>Preview Unavailable</span>
            <small>The original file could not be opened.</small>
          </div>
        </div>

        <v-card-text class="media-editor-fields">
          <div class="editor-field-row">
            <label for="media-title">Title</label>
            <v-text-field
              id="media-title"
              v-model="editTitleInput"
              variant="outlined"
              density="compact"
              hide-details="auto"
              :error="editTitleInvalid"
              :error-messages="editTitleInvalid ? ['Title is required'] : []"
            />
          </div>
          <div class="editor-field-row editor-field-row--top">
            <label for="media-description">Description</label>
            <v-textarea
              id="media-description"
              v-model="editDescriptionInput"
              variant="outlined"
              density="compact"
              rows="2"
              auto-grow
              hide-details
            />
          </div>
          <div class="editor-field-row">
            <label for="media-tags">Tags</label>
            <v-text-field
              id="media-tags"
              v-model="editTagsInput"
              placeholder="Separate tags with commas"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <div class="editor-field-row">
            <label for="media-location">Storage</label>
            <v-select
              id="media-location"
              v-model="editLocation"
              :items="[
                { title: 'Synced', value: 'synced' },
                { title: 'Local Only', value: 'local' },
              ]"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
        </v-card-text>

        <v-card-actions class="media-editor-actions">
          <v-btn
            variant="text"
            color="error"
            prepend-icon="mdi-trash-can-outline"
            @click="deleteEditingItem"
            >Delete Media</v-btn
          >
          <v-btn
            v-if="canvaAvailable && editingItem.origin"
            variant="text"
            color="primary"
            prepend-icon="mdi-cloud-refresh-outline"
            @click="refreshFromCanva(editingItem)"
            >Refresh from Canva</v-btn
          >
          <v-spacer />
          <v-btn variant="outlined" @click="editingItem = undefined">Cancel</v-btn>
          <v-btn variant="flat" color="primary" :disabled="editTitleInvalid" @click="saveEdits"
            >Save Changes</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.media-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-violet), 0.05), transparent 430px),
    rgb(var(--v-theme-background));
}
.media-hero,
.media-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.media-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-violet));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.media-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.media-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.media-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-violet));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.media-directory {
  overflow: hidden;
}
.media-toolbar {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.media-toolbar h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.media-toolbar p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.media-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.media-search {
  width: min(390px, 31vw);
}
.media-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.media-directory-body {
  display: grid;
  min-height: 470px;
  grid-template-columns: 230px minmax(0, 1fr);
}
.media-directory-body--empty {
  grid-template-columns: minmax(0, 1fr);
}
.media-filters {
  padding: 14px 11px 18px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.filter-section {
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.filter-heading {
  padding: 0 9px 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.media-filter {
  --filter-color: rgb(var(--v-theme-slate));
  position: relative;
  display: grid;
  width: 100%;
  min-height: 42px;
  grid-template-columns: 29px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 4px 9px 4px 7px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 590;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.media-filter::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--filter-color);
  content: '';
  opacity: 0;
}
.media-filter:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.media-filter--active {
  border-color: color-mix(in srgb, var(--filter-color) 23%, transparent);
  background: color-mix(in srgb, var(--filter-color) 10%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.media-filter--active::before {
  opacity: 1;
}
.media-filter:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--filter-color) 65%, transparent);
  outline-offset: 1px;
}
.media-filter--all,
.media-filter--image {
  --filter-color: rgb(var(--v-theme-teal));
}
.media-filter--video {
  --filter-color: rgb(var(--v-theme-secondary));
}
.media-filter--tag {
  --filter-color: rgb(var(--v-theme-violet));
}
.media-filter-icon {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--filter-color) 11%, transparent);
  color: var(--filter-color);
}
.media-filter strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.filter-empty {
  margin: 2px 9px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
}
.media-results {
  min-width: 0;
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 13px;
  padding: 14px;
}
.media-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.34);
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
.media-card:hover,
.media-card:focus-visible {
  border-color: rgba(var(--v-theme-violet), 0.34);
  background: rgba(var(--v-theme-violet), 0.035);
  box-shadow: 0 11px 26px rgba(0, 0, 0, 0.13);
  outline: none;
  transform: translateY(-2px);
}
.media-card:focus-visible {
  box-shadow:
    0 11px 26px rgba(0, 0, 0, 0.13),
    inset 0 0 0 2px rgba(var(--v-theme-violet), 0.48);
}
.media-thumb {
  position: relative;
  display: flex;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(255, 255, 255, 0.68);
}
.media-thumb--image {
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-teal), 0.48),
    rgba(var(--v-theme-violet), 0.42)
  );
}
.media-thumb--video {
  background: linear-gradient(135deg, #171a20, rgba(var(--v-theme-secondary), 0.52));
}
.media-thumb-content {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 240ms ease;
}
.media-card:hover .media-thumb-content {
  transform: scale(1.025);
}
.media-placeholder {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 13px;
  background: rgba(0, 0, 0, 0.16);
}
.type-badge,
.duplicate-badge {
  position: absolute;
  top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  background: rgba(8, 11, 16, 0.78);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.66rem;
  font-weight: 680;
  letter-spacing: 0.035em;
  text-transform: uppercase;
  backdrop-filter: blur(7px);
}
.type-badge {
  right: 8px;
}
.duplicate-badge {
  left: 8px;
  border-color: rgba(var(--v-theme-warning), 0.42);
  color: rgb(var(--v-theme-warning));
}
.media-card-body {
  padding: 12px 13px 11px;
}
.media-card-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 6px;
}
.media-identity {
  min-width: 0;
  flex: 1;
}
.media-identity h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 0.98rem;
  font-weight: 710;
  letter-spacing: -0.01em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-identity p {
  overflow: hidden;
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-description {
  display: -webkit-box;
  min-height: 38px;
  margin: 9px 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.61);
  font-size: 0.76rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.media-description--empty {
  color: rgba(var(--v-theme-on-surface), 0.34);
  font-style: italic;
}
.media-tags {
  display: flex;
  min-height: 24px;
  gap: 5px;
  overflow-x: auto;
}
.media-tags span {
  flex-shrink: 0;
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-violet), 0.18);
  border-radius: 5px;
  background: rgba(var(--v-theme-violet), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.69rem;
  font-weight: 580;
  white-space: nowrap;
}
.media-tags .media-no-tags {
  border-color: transparent;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-style: italic;
}
.media-card-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.storage-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: rgb(var(--v-theme-teal));
  font-size: 0.71rem;
  font-weight: 620;
}
.storage-label--local {
  color: rgb(var(--v-theme-warning));
}
.usage-label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.35;
  text-align: right;
}
.usage-label strong {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.68rem;
  font-weight: 580;
  white-space: nowrap;
}
.usage-label small {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.66rem;
  white-space: nowrap;
}
.media-empty-state {
  display: flex;
  min-height: 430px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.54);
  text-align: center;
}
.media-empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-violet), 0.11);
  color: rgb(var(--v-theme-violet));
}
.media-empty-state h2 {
  margin: 14px 0 3px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 1rem;
}
.media-empty-state p {
  margin: 0 0 15px;
  font-size: 0.82rem;
}
.media-editor-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
}
.media-editor-header {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 11px;
  padding: 15px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.media-editor-header > span {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-violet), 0.11);
  color: rgb(var(--v-theme-violet));
}
.media-editor-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.media-editor-header p {
  overflow: hidden;
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-editor-preview {
  display: flex;
  width: calc(100% - 32px);
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  margin: 16px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.68);
}
.media-editor-preview img,
.media-editor-preview video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #090b0f;
}
.editor-preview-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.76rem;
  font-weight: 620;
}
.editor-preview-status--unavailable {
  color: rgba(255, 255, 255, 0.58);
}
.editor-preview-status small {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.68rem;
  font-weight: 450;
}
.media-editor-fields {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 2px 18px 18px;
}
.editor-field-row {
  display: grid;
  grid-template-columns: 98px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}
.editor-field-row--top {
  align-items: start;
}
.editor-field-row label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.77rem;
  font-weight: 570;
}
.editor-field-row--top label {
  padding-top: 9px;
}
.media-editor-fields :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-background), 0.5);
  font-size: 0.8rem;
}
.media-editor-actions {
  padding: 13px 16px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
@media (max-width: 960px) {
  .media-toolbar,
  .media-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .media-search {
    width: min(520px, 100%);
  }
}
@media (max-width: 820px) {
  .media-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .media-summary {
    align-self: flex-start;
  }
  .media-directory-body {
    grid-template-columns: 1fr;
  }
  .media-filters {
    display: flex;
    gap: 5px;
    padding: 9px 11px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .filter-section {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    padding: 0 0 0 8px;
    border-top: 0;
    border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .filter-heading,
  .filter-empty {
    display: none;
  }
  .media-filter {
    width: auto;
    min-width: max-content;
    grid-template-columns: 27px auto auto;
    margin-bottom: 0;
  }
}
@media (max-width: 620px) {
  .media-page {
    padding: 14px 12px 40px;
  }
  .media-summary {
    width: 100%;
  }
  .summary-stat {
    min-width: 0;
    flex: 1;
  }
  .media-grid {
    grid-template-columns: 1fr;
  }
  .editor-field-row {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .editor-field-row--top label {
    padding-top: 0;
  }
}
</style>
