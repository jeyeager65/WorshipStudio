<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useFiltersPanel } from '@/composables/useFiltersPanel'
import { getAdapter } from '@/adapters'
import { useMediaStore } from '@/stores/media'
import { useExternalAppsStore } from '@/stores/externalApps'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import ImportMediaDialog from '@/components/media/ImportMediaDialog.vue'
import CanvaImportDialog from '@/components/canva/CanvaImportDialog.vue'
import type { MediaItem } from '@/models/library'
import { mediaFileIcon } from '@/utils/mediaFileIcon'

const store = useMediaStore()
const confirmDialog = useConfirmDialogStore()
const externalAppsStore = useExternalAppsStore()

// Tauri-only, same optional-port pattern as DiagnosticsPort.openLogsFolder — no browser/mock
// equivalent, so the button simply doesn't render there rather than opening a dialog that can
// only fail.
const canvaAvailable = !!getAdapter().canva

const query = ref('')
const typeFilter = ref<'all' | 'image' | 'video' | 'document'>('all')
const activeTag = ref<string>()
const { filtersOpen, toggleFilters, closeFilters } = useFiltersPanel()
const importDialogOpen = ref(false)
// undefined = the plain "Import Media" button's usual image/video filter; [] = "Import File"'s
// deliberately unrestricted filter, for a document like a PowerPoint deck meant for External App
// Hand-off (see ImportMediaDialog's own `extensions` prop doc comment) — one dialog instance,
// just opened in a different mode depending on which button was clicked.
const importExtensions = ref<string[]>()
function openImportMedia() {
  importExtensions.value = undefined
  importDialogOpen.value = true
}
function openImportFile() {
  importExtensions.value = []
  importDialogOpen.value = true
}
const canvaImportOpen = ref(false)
// Set only when opening the Canva dialog to refresh a specific already-imported item (from the
// media-details popup below) — left undefined for the toolbar's own "Import from Canva", which
// should always start at the design list.
const canvaRefreshDesignId = ref<string>()
const canvaRefreshMode = ref<'pages' | 'video'>('pages')
const editingItem = ref<MediaItem>()
const editTitleInput = ref('')
const editDescriptionInput = ref('')
const editTagsInput = ref<string[]>([])
const editLocation = ref<'synced' | 'local'>('synced')
const editTitleInvalid = computed(() => !editTitleInput.value.trim())
const editorPreviewLoading = ref(false)
const editorPreviewUnavailable = ref(false)
const deleteError = ref('')

onMounted(() => {
  if (!store.loaded) store.load()
  // Only feeds iconFor's fallback for extensions the icon map doesn't know — deliberately not
  // awaited, so icons simply refine once it arrives rather than holding up the grid.
  if (!externalAppsStore.loaded) externalAppsStore.load()
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
const documentCount = computed(
  () => visibleItems.value.filter((item) => item.kind === 'document').length,
)

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

// A document's icon is derived from its own filename rather than its `kind`, which only ever says
// "document" — so a PowerPoint deck, a PDF and a spreadsheet all rendered identically. External
// App profiles are passed in as the fallback for extensions the icon map doesn't know (see
// mediaFileIcon).
function iconFor(item: MediaItem): string {
  return mediaFileIcon(item.filename, item.kind, externalAppsStore.profiles)
}

function lastUsedLabel(item: MediaItem): string {
  if (!item.usage.lastUsedDate) return 'Not Yet Used'
  const date = new Date(`${item.usage.lastUsedDate}T00:00:00`).toLocaleDateString(undefined, {
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
  editTagsInput.value = [...item.tags]
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
    tags: editTagsInput.value,
    location: editLocation.value,
  })
  editingItem.value = undefined
}
</script>

<template>
  <main class="media-page app-page">
    <header class="media-hero app-page-hero">
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

    <section class="media-directory app-page-body">
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
          <!-- Only rendered below the shared 900px "compact" breakpoint, where the filters move
               into a slide-over panel this opens (assets/base.css). -->
          <v-btn
            v-if="visibleItems.length"
            class="app-filters-toggle"
            variant="tonal"
            density="comfortable"
            icon="mdi-filter-variant"
            :aria-label="filtersOpen ? 'Hide filters' : 'Show filters'"
            :aria-expanded="filtersOpen"
            @click="toggleFilters"
          />
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
          <!-- One menu rather than three sibling buttons. They're three variants of a single
               intent ("bring something into the library"), and as separate buttons they made this
               the widest toolbar in the app — wide enough to clip its own card from 1300px all the
               way down (measured at +281px past the edge at 975px). Collapsing them removes about
               320px of permanent toolbar, which is the width pressure at its source rather than
               another breakpoint. -->
          <v-menu location="bottom end">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                variant="flat"
                color="primary"
                prepend-icon="mdi-plus"
                append-icon="mdi-menu-down"
                class="app-icon-btn import-menu-btn"
                aria-label="Import"
                ><span class="app-btn-label">Import</span></v-btn
              >
            </template>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-image-plus-outline"
                title="Import Media"
                subtitle="Images and videos"
                @click="openImportMedia"
              />
              <v-list-item
                v-if="canvaAvailable"
                prepend-icon="mdi-palette-outline"
                title="Import from Canva"
                subtitle="Designs and videos"
                @click="openCanvaImport"
              />
              <v-list-item
                prepend-icon="mdi-file-plus-outline"
                title="Import File"
                subtitle="Any file, e.g. a slide deck"
                @click="openImportFile"
              />
            </v-list>
          </v-menu>
        </div>
      </div>

      <div
        class="media-directory-body"
        :class="{ 'media-directory-body--empty': visibleItems.length === 0 }"
      >
        <!-- One <aside>, two presentations: a permanent sidebar on wide screens, a slide-over panel

             below the shared 900px "compact" breakpoint. See assets/base.css. -->

        <div
          v-if="visibleItems.length"
          class="app-filters-scrim"
          :class="{ 'app-filters-scrim--open': filtersOpen }"
          @click="closeFilters"
        />

        <aside
          v-if="visibleItems.length"
          class="media-filters app-filters"
          :class="{ 'app-filters--open': filtersOpen }"
          aria-label="Filter media"
        >
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
            <button
              v-if="documentCount > 0"
              type="button"
              class="media-filter media-filter--document"
              :class="{ 'media-filter--active': typeFilter === 'document' }"
              @click="typeFilter = typeFilter === 'document' ? 'all' : 'document'"
            >
              <span class="media-filter-icon"
                ><v-icon icon="mdi-file-document-outline" size="17"
              /></span>
              <span>Files</span>
              <strong>{{ documentCount }}</strong>
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

        <div class="media-results app-page-body">
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
            <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="openImportMedia"
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

          <div v-else-if="store.loaded" class="media-grid app-page-scroll">
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
                  <v-icon :icon="iconFor(item)" size="46" />
                </span>
                <span class="type-badge">
                  <v-icon :icon="iconFor(item)" size="14" />
                  {{
                    item.kind === 'video' ? 'Video' : item.kind === 'document' ? 'File' : 'Image'
                  }}
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
                  </span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <ImportMediaDialog
      v-model="importDialogOpen"
      :extensions="importExtensions"
      @imported="store.load()"
    />
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
          <span><v-icon :icon="iconFor(editingItem)" size="22" /></span>
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
            <v-icon :icon="iconFor(editingItem)" size="34" />
            <span>{{
              editingItem.kind === 'document' ? 'No Preview' : 'Preview Unavailable'
            }}</span>
            <small>{{
              editingItem.kind === 'document'
                ? 'This file type has no visual preview.'
                : 'The original file could not be opened.'
            }}</small>
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
            <v-combobox
              id="media-tags"
              v-model="editTagsInput"
              multiple
              chips
              closable-chips
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
            variant="outlined"
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
  padding: 24px clamp(24px, 3vw, 48px);
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-violet), 0.05), transparent 430px),
    rgb(var(--v-theme-background));
}
/* width: 100% because the page is a flex column now (.app-page) — auto side margins on a flex
   item shrink it to its content width instead of filling the line. */
.media-hero,
.media-directory {
  width: 100%;
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
/* The dropdown caret sits in .v-btn__append, which .app-icon-btn does not hide — so at the
   compact breakpoint this reads as a plus and a caret, still recognisably a menu. */
.import-menu-btn .v-btn__append {
  margin-inline-start: 2px;
}
/* Lets the title/count block give ground too — without it the heading holds its full width and
   the buttons take the overflow. It has to truncate as it shrinks, though: min-width: 0 alone
   lets the box narrow while the text keeps its own width and spills out visibly, which read as
   the search field being drawn on top of "Media Library". */
.media-toolbar > div:first-child {
  min-width: 0;
  overflow: hidden;
}
.media-toolbar > div:first-child h2,
.media-toolbar > div:first-child p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* min-width: 0 so the cluster can give ground — a flex item defaults to min-width: auto and
   refuses to shrink below its contents, which is what let these buttons overflow the card. */
.media-actions {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
}
/* min-width keeps it usable — it absorbs the shrinking, so without a floor it collapses first. */
.media-search {
  width: auto;
  min-width: 150px;
  max-width: 390px;
  flex: 1;
}
.media-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
/* flex/min-height rather than a fixed min-height, so the grid takes the leftover page height and
   hands it to the results column, which is what scrolls (see .app-page in assets/base.css). */
/* grid-template-rows is explicit, not left implicit: this grid now has a definite height, and an
   `auto` row only stretches to fill it while it's the *only* row. Below 820px the sidebar becomes
   a filter bar stacked above the results, and with two auto rows the results row falls back to
   its content height — overflowing the fixed-height page and getting clipped with no scrollbar
   instead of scrolling. minmax(0, 1fr) lets that row shrink and bounds the scroller inside it. */
.media-directory-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 230px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.media-directory-body--empty {
  grid-template-columns: minmax(0, 1fr);
}
/* Scrolls on its own now that the page doesn't — a long filter list must not be able to push the
   sidebar taller than the pane it sits in. */
.media-filters {
  padding: 14px 11px 18px;
  overflow-y: auto;
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
  overflow: hidden;
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
/* Sized against the 16:9 thumb it sits in: for a document this badge is the only thing standing
   in for the file, so it carries more weight than it would as a mere loading placeholder. */
.media-placeholder {
  display: grid;
  width: 82px;
  height: 82px;
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
  flex-wrap: wrap;
  row-gap: 8px;
}
/* Only the toolbar stacks (heading above the controls) — the controls stay a row so the import
   buttons keep sitting beside the search rather than each becoming a full-width bar. */
@media (max-width: 960px) {
  .media-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .media-actions {
    align-items: center;
    flex-direction: row;
  }
  .media-search {
    width: auto;
    min-width: 0;
    flex: 1;
  }
}
/* 900px = the shared "compact" breakpoint (see assets/base.css). The filters sidebar used to
   become a horizontal bar here; it's a slide-over now, defined centrally. This page owns only the
   single-column grid and the positioning context the panel is absolute against. */
@media (max-width: 900px) {
  .media-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .media-summary {
    align-self: flex-start;
  }
  .media-directory-body {
    position: relative;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }
}
/* 700px = the shared "phone" breakpoint (see assets/base.css). */
@media (max-width: 700px) {
  .media-page {
    padding: 10px;
  }
  .media-toolbar {
    padding: 8px 10px;
  }
  .media-toolbar,
  .media-actions {
    align-items: center;
    flex-direction: row;
  }
  .media-actions {
    width: 100%;
    gap: 6px;
  }
  .media-search {
    width: auto;
    min-width: 0;
    flex: 1;
  }
  .media-grid {
    grid-template-columns: 1fr;
    padding: 10px;
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
