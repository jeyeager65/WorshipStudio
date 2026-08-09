<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { StagedMediaFile, MediaImportCommit } from '@/adapters/types'
import type { MediaItem } from '@/models/library'

const props = withDefaults(defineProps<{ modelValue: boolean; syncedOnly?: boolean }>(), {
  syncedOnly: false,
})
const emit = defineEmits<{ 'update:modelValue': [boolean]; imported: [MediaItem[]] }>()
const confirmDialog = useConfirmDialogStore()

interface StagedFileRow extends StagedMediaFile {
  titleInput: string
  descriptionInput: string
  tagsInput: string[]
  skip: boolean
  /** Whether this file will import as local-only — defaults from isLargeFile below but stays
   *  independently toggleable, since a church might want a small file kept local-only too (or
   *  might want a large one synced anyway, oversized-file warnings being only a nudge). */
  localOnly: boolean
  /** Fixed at staging time, purely informational — shown next to the Local Only checkbox
   *  regardless of its current value, so the reason it defaulted to checked doesn't disappear
   *  the moment someone toggles it. */
  isLargeFile: boolean
  /** Resolved separately after the row is added (see browseFiles) rather than awaited up front,
   *  so a batch of files appears in the list immediately instead of waiting on every thumbnail. */
  previewUrl?: string
}

// A starting point the operator can edit or replace outright, not a real title — required
// everywhere a MediaItem is displayed, so this dialog is where it has to be collected (nothing
// downstream generates one on its own beyond this same fallback, see domain::media's
// title_from_filename on the Tauri side / titleFromFilename in the mock adapter).
function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

const stagedRows = ref<StagedFileRow[]>([])
const bulkTag = ref<string[]>([])
const maxSyncedBytes = ref(50 * 1024 * 1024)
const importing = ref(false)

// Resets when the dialog closes so re-opening always starts from a clean slate, and reads
// the current synced-file-size threshold fresh each time (Settings can change it between uses).
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      stagedRows.value = []
      bulkTag.value = []
      return
    }
    const librarySettings = await getAdapter().settings.getLibrarySettings()
    maxSyncedBytes.value = librarySettings.mediaMaxSyncedFileSizeMb * 1024 * 1024
  },
)

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// No native drag-and-drop yet (would need Tauri's webview drop-event wiring) — "browse" is
// the only entry point for now, callable more than once to add further files to the batch.
async function browseFiles() {
  const adapter = getAdapter()
  const staged = await adapter.media.pickFilesToImport()
  for (const file of staged) {
    const isLargeFile = file.sizeBytes > maxSyncedBytes.value
    const row: StagedFileRow = {
      ...file,
      titleInput: titleFromFilename(file.filename),
      descriptionInput: '',
      tagsInput: [...bulkTag.value],
      skip: !!file.duplicateOfId,
      localOnly: !props.syncedOnly && isLargeFile,
      isLargeFile,
    }
    stagedRows.value.push(row)
    // Looked back up by path rather than mutating the closed-over `row` directly: pushing a
    // plain object into a reactive array wraps it in its own reactive proxy on read, so setting
    // a property on the pre-push raw reference bypasses that proxy's change tracking entirely —
    // the value would technically be set, but Vue would never know to re-render for it.
    void adapter.media.getStagedPreviewUrl(file.path).then((url) => {
      if (!url) return
      const current = stagedRows.value.find((r) => r.path === file.path)
      if (current) current.previewUrl = url
    })
  }
}

async function removeRow(path: string) {
  const row = stagedRows.value.find((r) => r.path === path)
  if (!row) return
  if (!(await confirmDialog.confirm(`Remove "${row.filename}" from this import?`, 'Remove'))) return
  stagedRows.value = stagedRows.value.filter((r) => r.path !== path)
}

const includedRows = computed(() => stagedRows.value.filter((row) => !row.skip))
const duplicateCount = computed(() => stagedRows.value.filter((row) => row.duplicateOfId).length)
const localOnlyCount = computed(
  () => stagedRows.value.filter((row) => row.localOnly && !row.skip).length,
)
const hasBlankTitle = computed(() => includedRows.value.some((row) => !row.titleInput.trim()))

async function confirmImport() {
  if (includedRows.value.length === 0) {
    emit('update:modelValue', false)
    return
  }
  if (hasBlankTitle.value) return
  importing.value = true
  try {
    const files: MediaImportCommit[] = includedRows.value.map((row) => ({
      path: row.path,
      filename: row.filename,
      title: row.titleInput.trim(),
      description: row.descriptionInput.trim() || undefined,
      tags: row.tagsInput,
      location: props.syncedOnly ? 'synced' : row.localOnly ? 'local' : 'synced',
      duplicateOfId: row.duplicateOfId,
    }))
    const created = await getAdapter().media.commitImport(files)
    emit('imported', created)
    emit('update:modelValue', false)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title>Import Media</v-card-title>

      <v-card-text style="max-height: 55vh; overflow-y: auto">
        <p class="text-caption text-medium-emphasis mb-4">
          Duplicates and large files are flagged before importing — both are only nudges, never a
          hard block.
        </p>

        <div class="drop-zone mb-4" @click="browseFiles">
          <v-icon icon="mdi-folder-open-outline" size="20" />
          <span>Browse for images and videos…</span>
        </div>

        <v-combobox
          v-if="stagedRows.length"
          v-model="bulkTag"
          label="Tag All"
          hint="Applies to files added after this point — each stays individually editable below."
          persistent-hint
          multiple
          chips
          closable-chips
          variant="outlined"
          density="compact"
          class="mb-4"
        />

        <div
          v-for="row in stagedRows"
          :key="row.path"
          class="d-flex align-start ga-3 mb-2 pa-3 file-row"
          :class="{
            'file-row--duplicate': row.duplicateOfId,
            'file-row--large': row.localOnly && !row.duplicateOfId,
          }"
        >
          <div class="file-row-thumb">
            <img v-if="row.previewUrl && row.kind === 'image'" :src="row.previewUrl" alt="" />
            <video v-else-if="row.previewUrl" :src="row.previewUrl" muted preload="metadata" />
            <v-icon
              v-else
              :icon="row.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
              size="26"
            />
          </div>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="text-caption text-medium-emphasis text-truncate mb-2">
              {{ row.filename }} ({{ formatSize(row.sizeBytes) }})
            </div>
            <v-text-field
              v-model="row.titleInput"
              label="Title"
              density="compact"
              variant="outlined"
              :error="!row.titleInput.trim()"
              :error-messages="row.titleInput.trim() ? [] : ['Title is required']"
              class="mb-2"
            />
            <v-text-field
              v-model="row.descriptionInput"
              label="Description (optional)"
              density="compact"
              variant="outlined"
              hide-details
              class="mb-2"
            />
            <v-combobox
              v-model="row.tagsInput"
              label="Tags"
              density="compact"
              variant="outlined"
              multiple
              chips
              closable-chips
              hide-details
            />
            <div v-if="row.duplicateOfId" class="file-row-flag mt-2">
              <span class="text-caption text-warning">Matches {{ row.duplicateOfFilename }}</span>
              <v-checkbox v-model="row.skip" label="Skip" density="compact" hide-details />
            </div>
            <div v-if="!props.syncedOnly" class="file-row-flag mt-2">
              <span v-if="row.isLargeFile" class="text-caption text-primary">
                Large file ({{ formatSize(row.sizeBytes) }})
              </span>
              <v-checkbox
                v-model="row.localOnly"
                label="Local Only"
                density="compact"
                hide-details
              />
            </div>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            class="flex-shrink-0"
            @click="removeRow(row.path)"
          />
        </div>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <span class="text-caption text-medium-emphasis">
          {{ stagedRows.length }} file(s) selected
          <template v-if="duplicateCount">· {{ duplicateCount }} possible duplicate(s)</template>
          <template v-if="localOnlyCount">· {{ localOnlyCount }} will be stored locally</template>
        </span>
        <v-spacer />
        <v-btn variant="outlined" class="mr-2" @click="emit('update:modelValue', false)"
          >Cancel</v-btn
        >
        <v-btn
          variant="flat"
          color="primary"
          :loading="importing"
          :disabled="includedRows.length === 0 || hasBlankTitle"
          @click="confirmImport"
        >
          Import {{ includedRows.length }} File{{ includedRows.length === 1 ? '' : 's' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.drop-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1.5px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
  padding: 14px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.8rem;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}
.drop-zone:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
  color: rgb(var(--v-theme-primary));
}
.file-row {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.7);
}
.file-row--duplicate {
  border-color: rgb(var(--v-theme-warning));
}
.file-row--large {
  border-color: rgb(var(--v-theme-primary));
}
/* Same checkerboard-for-transparency treatment as MediaPickerDialog.vue's .media-thumb (the
   Media Library grid's own preview cards), just sized for a row instead of a grid card — so a
   staged file previews exactly like it will once it's a real library item. A fixed box (for a
   stable row height while multiple files are staged) but no forced aspect ratio on the media
   itself: object-fit: contain scales each image/video down to fit within the box at its own
   real proportions rather than cropping a portrait photo to match a landscape box. */
.file-row-thumb {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 160px;
  height: 100px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background-color: rgba(var(--v-theme-on-surface), 0.045);
  background-image:
    linear-gradient(45deg, rgba(var(--v-theme-on-surface), 0.045) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(var(--v-theme-on-surface), 0.045) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(var(--v-theme-on-surface), 0.045) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(var(--v-theme-on-surface), 0.045) 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.file-row-thumb img,
.file-row-thumb video {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.file-row-flag {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
