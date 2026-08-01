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
  tagsInput: string
  skip: boolean
  localOnly: boolean
}

// A starting point the operator can edit or replace outright, not a real title — required
// everywhere a MediaItem is displayed, so this dialog is where it has to be collected (nothing
// downstream generates one on its own beyond this same fallback, see domain::media's
// title_from_filename on the Tauri side / titleFromFilename in the mock adapter).
function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

const stagedRows = ref<StagedFileRow[]>([])
const bulkTag = ref('')
const maxSyncedBytes = ref(50 * 1024 * 1024)
const importing = ref(false)

// Resets when the dialog closes so re-opening always starts from a clean slate, and reads
// the current synced-file-size threshold fresh each time (Settings can change it between uses).
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      stagedRows.value = []
      bulkTag.value = ''
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
  const staged = await getAdapter().media.pickFilesToImport()
  for (const file of staged) {
    stagedRows.value.push({
      ...file,
      titleInput: titleFromFilename(file.filename),
      descriptionInput: '',
      tagsInput: bulkTag.value,
      skip: !!file.duplicateOfId,
      localOnly: !props.syncedOnly && file.sizeBytes > maxSyncedBytes.value,
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
      tags: row.tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
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
      <v-card-subtitle
        >Duplicates and large files are flagged before importing — both are only nudges, never a
        hard block.</v-card-subtitle
      >

      <v-card-text style="max-height: 55vh; overflow-y: auto">
        <div class="drop-zone mb-4" @click="browseFiles">
          <v-icon icon="mdi-folder-open-outline" size="28" class="mb-2" />
          <div>Browse for images and videos…</div>
        </div>

        <v-text-field
          v-if="stagedRows.length"
          v-model="bulkTag"
          label="Tag All"
          hint="Applies to files added after this point — each stays individually editable below."
          persistent-hint
          variant="outlined"
          density="compact"
          class="mb-4"
        />

        <div
          v-for="row in stagedRows"
          :key="row.path"
          class="d-flex align-center ga-3 mb-2 pa-3 file-row"
          :class="{
            'file-row--duplicate': row.duplicateOfId,
            'file-row--large': row.localOnly && !row.duplicateOfId,
          }"
        >
          <v-icon
            :icon="row.kind === 'video' ? 'mdi-movie-open-outline' : 'mdi-image-outline'"
            size="20"
          />
          <div class="flex-grow-1" style="min-width: 0">
            <div class="text-caption text-medium-emphasis text-truncate">
              {{ row.filename }} ({{ formatSize(row.sizeBytes) }})
            </div>
            <v-text-field
              v-model="row.titleInput"
              label="Title"
              density="compact"
              variant="underlined"
              :error="!row.titleInput.trim()"
              :error-messages="row.titleInput.trim() ? [] : ['Title is required']"
              class="mb-1"
            />
            <v-text-field
              v-model="row.descriptionInput"
              label="Description (optional)"
              density="compact"
              variant="underlined"
              hide-details
              class="mb-1"
            />
            <v-text-field
              v-model="row.tagsInput"
              label="Tags (comma-separated)"
              density="compact"
              variant="underlined"
              hide-details
              style="max-width: 260px"
            />
          </div>
          <template v-if="row.duplicateOfId">
            <span class="text-caption text-warning flex-shrink-0"
              >Matches {{ row.duplicateOfFilename }}</span
            >
            <v-checkbox
              v-model="row.skip"
              label="Skip"
              density="compact"
              hide-details
              class="flex-shrink-0"
            />
          </template>
          <template v-else-if="row.localOnly">
            <span class="text-caption text-primary flex-shrink-0">Large file</span>
            <v-checkbox
              v-model="row.localOnly"
              label="Local Only"
              density="compact"
              hide-details
              class="flex-shrink-0"
            />
          </template>
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
  border: 2px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.drop-zone:hover {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.file-row {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
}
.file-row--duplicate {
  border-color: rgb(var(--v-theme-warning));
}
.file-row--large {
  border-color: rgb(var(--v-theme-primary));
}
</style>
