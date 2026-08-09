<script setup lang="ts">
import { ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useCanvaConnection } from '@/composables/useCanvaConnection'
import type {
  CanvaDesign,
  CanvaExportedPage,
  CanvaImportResult,
  CanvaVideoExportResult,
  CanvaVideoPreview,
} from '@/adapters/types'

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Shared by the Slide Editor's Canva button and the Media Library's "Import from Canva" entry
// point — the only difference between the two is what the caller does with the emitted result
// (build slides vs. just let the media reload pick it up). Dedup against a page already
// imported anywhere (a different presentation, or the other entry point) happens entirely on
// the backend (see import_canva_pages/find_by_canva_origin) — this dialog doesn't need to know
// or care which pages already exist.
const props = defineProps<{
  modelValue: boolean
  /** Skips the design list and jumps straight to this design's page picker (or, with
   *  `initialMode: 'video'`, the video-export confirm step) — the Slide Editor's "Edit in
   *  Canva"/"Refresh from Canva" toolbar shortcuts, and the Media Library's own "Refresh from
   *  Canva" on an item's details popup, use this. */
  initialDesignId?: string
  initialMode?: 'pages' | 'video'
  /** Seeds the title field when creating a brand-new design from this dialog. */
  defaultDesignTitle?: string
  /** Shows "Import as Video" on each design card. Off by default — a whole-design video (see
   *  exportVideo below) doesn't map onto "one slide per page" the way the image flow does, so
   *  the Slide Editor doesn't opt in; only the Media Library, where the result is just another
   *  media item, does. */
  allowVideoExport?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  imported: [CanvaImportResult]
  videoImported: [CanvaVideoExportResult]
}>()

const connection = useCanvaConnection()

type Step = 'designs' | 'pages' | 'video'
const step = ref<Step>('designs')
const error = ref('')
const successMessage = ref('')

const designs = ref<CanvaDesign[]>([])
const designsBusy = ref(false)
const videoPreview = ref<CanvaVideoPreview>()
const videoPreviewBusy = ref(false)
const videoLocalOnly = ref(false)
const videoMaxSyncedBytes = ref(50 * 1024 * 1024)
const videoImportBusy = ref(false)

const selectedDesign = ref<CanvaDesign>()
const previewPages = ref<CanvaExportedPage[]>([])
const checkedPages = ref<Set<number>>(new Set())
const previewBusy = ref(false)
const importBusy = ref(false)

async function refreshDesigns() {
  const canva = getAdapter().canva
  if (!canva) return
  designsBusy.value = true
  try {
    await connection.refreshStatus()
    designs.value = connection.status.value?.connected ? await canva.listDesigns() : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    designsBusy.value = false
  }
}

watch(
  () => connection.status.value?.connected,
  (connected) => {
    if (connected && step.value === 'designs') void refreshDesigns()
  },
)

async function createDesign() {
  const canva = getAdapter().canva
  if (!canva) return
  designsBusy.value = true
  error.value = ''
  successMessage.value = ''
  try {
    const design = await canva.createDesign(props.defaultDesignTitle || 'Worship Studio Design')
    designs.value.unshift(design)
    await canva.openDesign(design.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    designsBusy.value = false
  }
}

// Downloads the video (a real Canva export, not just a preview) but stops short of importing it
// — unlike the page picker, this isn't about *which* content to bring in (a video export has no
// subset), it's about *where the file goes*. A video can be large enough that synced-vs-local
// genuinely matters: land it local-only without the operator noticing, and a church computer
// that didn't do the export may never receive it over sync. So this shows the real downloaded
// size and defaults the choice the same way the ordinary Import Media dialog would, but leaves
// it changeable — confirmVideoImport below is what actually commits it.
async function openVideoConfirm(designId: string, knownDesign?: CanvaDesign) {
  const canva = getAdapter().canva
  if (!canva) return
  error.value = ''
  successMessage.value = ''
  // Same reasoning as openPagePicker's own immediate step-switch: the export/poll takes a few
  // real seconds, and waiting for that before leaving the design grid made the click look like
  // it did nothing.
  selectedDesign.value = knownDesign
  videoPreview.value = undefined
  step.value = 'video'
  videoPreviewBusy.value = true
  try {
    const [preview, librarySettings] = await Promise.all([
      canva.previewVideoExport(designId),
      getAdapter().settings.getLibrarySettings(),
    ])
    videoMaxSyncedBytes.value = librarySettings.mediaMaxSyncedFileSizeMb * 1024 * 1024
    videoLocalOnly.value = preview.sizeBytes > videoMaxSyncedBytes.value
    selectedDesign.value = preview.design
    videoPreview.value = preview
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    videoPreviewBusy.value = false
  }
}

function cancelVideoImport() {
  videoPreview.value = undefined
  backToDesigns()
}

async function confirmVideoImport() {
  const canva = getAdapter().canva
  const preview = videoPreview.value
  if (!canva || !preview) return
  videoImportBusy.value = true
  error.value = ''
  try {
    const result = await canva.importVideo(
      preview.design.id,
      preview.tempPath,
      videoLocalOnly.value ? 'local' : 'synced',
    )
    emit('videoImported', result)
    successMessage.value = `Imported "${preview.design.title}" as a video.`
    videoPreview.value = undefined
    step.value = 'designs'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    videoImportBusy.value = false
  }
}

async function editDesign(designId: string) {
  const canva = getAdapter().canva
  if (!canva) return
  error.value = ''
  successMessage.value = ''
  try {
    await canva.openDesign(designId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function disconnect() {
  await connection.disconnect()
  designs.value = []
}

async function openPagePicker(designId: string, knownDesign?: CanvaDesign) {
  const canva = getAdapter().canva
  if (!canva) return
  error.value = ''
  successMessage.value = ''
  // Switch to the pages step (and its progress bar) immediately — Canva's export takes a few
  // real seconds (it's a job that gets polled, not an instant response), and waiting for that
  // before moving off the design grid left the "Choose pages" click looking like it did
  // nothing. Show the design's own already-known title right away if the caller has it (a grid
  // click does; the toolbar's "Refresh from Canva" shortcut, which only has an id, doesn't —
  // the real title fills in once the preview response arrives either way).
  selectedDesign.value = knownDesign
  previewPages.value = []
  checkedPages.value = new Set()
  step.value = 'pages'
  previewBusy.value = true
  try {
    const preview = await canva.previewExport(designId)
    selectedDesign.value = preview.design
    previewPages.value = preview.pages
    // Every page defaults to checked — matches the old always-import-everything behavior; the
    // picker is purely opt-out.
    checkedPages.value = new Set(preview.pages.map((page) => page.pageNumber))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    previewBusy.value = false
  }
}

function backToDesigns() {
  step.value = 'designs'
  selectedDesign.value = undefined
  previewPages.value = []
  error.value = ''
  void refreshDesigns()
}

function togglePage(pageNumber: number) {
  if (checkedPages.value.has(pageNumber)) checkedPages.value.delete(pageNumber)
  else checkedPages.value.add(pageNumber)
  // Trigger reactivity — Set mutations aren't tracked in place.
  checkedPages.value = new Set(checkedPages.value)
}
function selectAllPages() {
  checkedPages.value = new Set(previewPages.value.map((page) => page.pageNumber))
}
function selectNoPages() {
  checkedPages.value = new Set()
}

async function confirmImport() {
  const canva = getAdapter().canva
  if (!canva || !selectedDesign.value) return
  const pages = previewPages.value
    .filter((page) => checkedPages.value.has(page.pageNumber))
    .map((page) => ({ pageNumber: page.pageNumber, exportUrl: page.exportUrl }))
  if (pages.length === 0) return
  importBusy.value = true
  error.value = ''
  try {
    const result = await canva.importPages(selectedDesign.value.id, pages)
    emit('imported', result)
    close()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    importBusy.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    error.value = ''
    successMessage.value = ''
    if (props.initialDesignId && props.initialMode === 'video') {
      await openVideoConfirm(props.initialDesignId)
    } else if (props.initialDesignId) {
      await openPagePicker(props.initialDesignId)
    } else {
      step.value = 'designs'
      await refreshDesigns()
    }
  },
)
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="900" @update:model-value="close">
    <v-card>
      <v-card-title class="d-flex align-center">
        <template v-if="step === 'designs'">Canva designs</template>
        <template v-else-if="step === 'pages'">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="backToDesigns" />
          Choose pages — {{ selectedDesign?.title }}
        </template>
        <template v-else>
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="cancelVideoImport" />
          Import as Video — {{ selectedDesign?.title }}
        </template>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="error || connection.status.value?.error"
          type="error"
          variant="tonal"
          class="mb-4"
        >
          {{ error || connection.status.value?.error }}
        </v-alert>
        <v-alert v-else-if="successMessage" type="success" variant="tonal" class="mb-4">
          {{ successMessage }}
        </v-alert>

        <template v-if="step === 'designs'">
          <template v-if="!connection.status.value?.connected">
            <p class="text-body-2 text-medium-emphasis mb-4">
              Connect this machine to Canva. Authorization opens in your browser and returns through
              Worship Studio's local server.
            </p>
            <v-btn
              color="primary"
              prepend-icon="mdi-link"
              :loading="connection.connecting.value"
              @click="connection.connect"
            >
              Connect Canva
            </v-btn>
          </template>
          <template v-else>
            <p class="text-body-2 text-medium-emphasis mb-4">
              Editing opens in your browser so Canva and Google can use your existing secure login.
              Return here and choose a design to pick which pages to import.
            </p>
            <div class="d-flex ga-2 mb-4">
              <v-btn
                color="primary"
                prepend-icon="mdi-plus"
                :loading="designsBusy"
                @click="createDesign"
              >
                New 16:9 design
              </v-btn>
              <v-btn prepend-icon="mdi-refresh" :loading="designsBusy" @click="refreshDesigns">
                Refresh list
              </v-btn>
              <v-spacer />
              <v-btn variant="text" color="error" @click="disconnect">Disconnect</v-btn>
            </div>
            <v-progress-linear v-if="designsBusy" indeterminate class="mb-3" />
            <div class="canva-grid">
              <v-card v-for="design in designs" :key="design.id" variant="outlined">
                <div class="canva-thumbnail">
                  <img v-if="design.thumbnailUrl" :src="design.thumbnailUrl" alt="" />
                  <v-icon v-else icon="mdi-palette-outline" size="36" />
                </div>
                <v-card-text>
                  <div class="font-weight-bold text-truncate">{{ design.title }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ design.pageCount }} page(s)
                  </div>
                </v-card-text>
                <v-card-actions>
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-open-in-new"
                    @click="editDesign(design.id)"
                  >
                    Edit
                  </v-btn>
                  <v-btn
                    size="small"
                    color="primary"
                    variant="flat"
                    @click="openPagePicker(design.id, design)"
                  >
                    Choose pages
                  </v-btn>
                </v-card-actions>
                <v-card-actions v-if="allowVideoExport" class="pt-0">
                  <v-btn
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-movie-outline"
                    block
                    @click="openVideoConfirm(design.id, design)"
                  >
                    Import as Video
                  </v-btn>
                </v-card-actions>
              </v-card>
            </div>
          </template>
        </template>

        <template v-else-if="step === 'pages'">
          <v-progress-linear v-if="previewBusy" indeterminate class="mb-3" />
          <template v-else>
            <div class="d-flex align-center ga-2 mb-4">
              <v-btn size="small" variant="text" @click="selectAllPages">Select All</v-btn>
              <v-btn size="small" variant="text" @click="selectNoPages">Select None</v-btn>
              <v-spacer />
              <v-btn
                color="primary"
                variant="flat"
                :loading="importBusy"
                :disabled="checkedPages.size === 0"
                @click="confirmImport"
              >
                Import Selected ({{ checkedPages.size }})
              </v-btn>
            </div>
            <div class="canva-grid">
              <v-card
                v-for="page in previewPages"
                :key="page.pageNumber"
                variant="outlined"
                class="canva-page"
                :class="{ 'canva-page--selected': checkedPages.has(page.pageNumber) }"
                @click="togglePage(page.pageNumber)"
              >
                <div class="canva-thumbnail">
                  <img :src="page.exportUrl" alt="" />
                  <v-checkbox-btn
                    :model-value="checkedPages.has(page.pageNumber)"
                    class="canva-page-checkbox"
                    @click.stop="togglePage(page.pageNumber)"
                  />
                </div>
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Page {{ page.pageNumber }}</div>
                </v-card-text>
              </v-card>
            </div>
          </template>
        </template>

        <template v-else-if="step === 'video'">
          <v-progress-linear v-if="videoPreviewBusy || !videoPreview" indeterminate class="mb-3" />
          <template v-else>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ videoPreview.design.title }} — {{ formatSize(videoPreview.sizeBytes) }}
            </p>
            <v-alert
              v-if="videoPreview.sizeBytes > videoMaxSyncedBytes"
              type="warning"
              variant="tonal"
              density="compact"
              class="mb-4"
            >
              This video is larger than this church's synced-file limit ({{
                formatSize(videoMaxSyncedBytes)
              }}).
            </v-alert>
            <v-checkbox
              v-model="videoLocalOnly"
              label="Local Only — keep this video on this computer instead of syncing it"
              density="compact"
              hide-details
              class="mb-2"
            />
            <p class="text-caption text-medium-emphasis mb-4">
              If you choose Local Only, this video won't sync to your shared library folder — other
              computers, including the one running the service, won't have it unless you also import
              it there (or switch this back to synced later from the Media Library).
            </p>
            <div class="d-flex ga-2">
              <v-spacer />
              <v-btn variant="outlined" @click="cancelVideoImport">Cancel</v-btn>
              <v-btn
                color="primary"
                variant="flat"
                :loading="videoImportBusy"
                @click="confirmVideoImport"
              >
                Import Video
              </v-btn>
            </div>
          </template>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.canva-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  max-height: 60vh;
  overflow-y: auto;
}
.canva-thumbnail {
  position: relative;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}
.canva-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.canva-page {
  cursor: pointer;
}
.canva-page--selected {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
}
.canva-page-checkbox {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
}
</style>
