<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSyncStore } from '@/stores/sync'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { diffFields } from '@/utils/conflictDiff'
import type { ConflictedItem, RecoveryIssue } from '@/adapters/types'

const store = useSyncStore()
const confirmDialog = useConfirmDialogStore()
const recoveringPath = ref('')
const recoveryError = ref('')
const quarantineNotice = ref('')

onMounted(() => {
  if (!store.loaded) store.load()
})

function formatValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function thisVersionUpdatedAt(conflict: ConflictedItem): string {
  const value = conflict.thisVersion.updatedAt
  return typeof value === 'string' ? formatWhen(value) : ''
}

async function keep(conflict: ConflictedItem, which: 'mine' | 'theirs') {
  await store.resolve(conflict.conflictFilePath, which)
}

async function restore(issue: RecoveryIssue) {
  recoveringPath.value = issue.filePath
  recoveryError.value = ''
  quarantineNotice.value = ''
  try {
    await store.recover(issue.filePath)
  } catch (error) {
    recoveryError.value = error instanceof Error ? error.message : String(error)
  } finally {
    recoveringPath.value = ''
  }
}

async function moveAside(issue: RecoveryIssue) {
  if (
    !(await confirmDialog.confirm(
      `Move ${issue.relativePath} out of the active library? Its damaged bytes will be preserved beside the original file, but this item will no longer load in Worship Studio.`,
      'Move Damaged File',
    ))
  )
    return
  recoveringPath.value = issue.filePath
  recoveryError.value = ''
  quarantineNotice.value = ''
  try {
    const destination = await store.quarantine(issue.filePath)
    quarantineNotice.value = `Damaged file preserved at ${destination}`
  } catch (error) {
    recoveryError.value = error instanceof Error ? error.message : String(error)
  } finally {
    recoveringPath.value = ''
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 820px">
    <h1 class="text-h5 font-weight-bold mb-1">Library Recovery</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">
      Restore damaged library files from their last complete backup and resolve files changed on multiple computers.
    </p>

    <section v-if="store.recoveryIssues.length > 0" class="mb-8">
      <div class="d-flex align-center ga-3 mb-3">
        <v-icon icon="mdi-database-alert-outline" color="error" />
        <div>
          <h2 class="text-subtitle-1 font-weight-bold">Damaged library files</h2>
          <p class="text-caption text-medium-emphasis">
            These files were left untouched. Restore a verified backup or preserve the damaged file outside the active library.
          </p>
        </div>
      </div>
      <v-card
        v-for="issue in store.recoveryIssues"
        :key="issue.filePath"
        variant="outlined"
        class="mb-3 recovery-card"
      >
        <div class="pa-4 recovery-row">
          <div class="recovery-copy">
            <strong>{{ issue.relativePath }}</strong>
            <span>{{ issue.error }}</span>
            <small v-if="issue.backupAvailable" class="text-success">
              A complete previous version is available.
            </small>
            <small v-else class="text-warning">
              No valid automatic backup is available.
            </small>
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-if="issue.backupAvailable"
              color="primary"
              variant="flat"
              prepend-icon="mdi-backup-restore"
              :loading="recoveringPath === issue.filePath"
              @click="restore(issue)"
            >
              Restore Backup
            </v-btn>
            <v-btn
              color="warning"
              variant="outlined"
              prepend-icon="mdi-file-move-outline"
              :loading="recoveringPath === issue.filePath"
              @click="moveAside(issue)"
            >
              Move Aside
            </v-btn>
          </div>
        </div>
      </v-card>
    </section>

    <v-alert v-if="recoveryError" type="error" variant="tonal" class="mb-5">
      {{ recoveryError }}
    </v-alert>
    <v-alert v-if="quarantineNotice" type="info" variant="tonal" class="mb-5">
      {{ quarantineNotice }}
    </v-alert>

    <div v-if="store.conflicts.length > 0" class="d-flex align-center ga-3 mb-3">
      <v-icon icon="mdi-source-branch-sync" color="warning" />
      <div>
        <h2 class="text-subtitle-1 font-weight-bold">Sync conflicts</h2>
        <p class="text-caption text-medium-emphasis">
          Choose which version to keep for each item edited on multiple computers.
        </p>
      </div>
    </div>

    <v-card v-for="conflict in store.conflicts" :key="conflict.conflictFilePath" variant="outlined" class="mb-4 conflict-card">
      <div class="d-flex align-center justify-space-between pa-4 conflict-header">
        <div>
          <div class="font-weight-bold">{{ conflict.label }}</div>
          <div class="text-caption text-medium-emphasis text-capitalize">{{ conflict.kind }} · conflicting edits detected</div>
        </div>
        <v-chip color="warning" size="small" variant="flat">CONFLICT</v-chip>
      </div>
      <v-divider />
      <div class="d-flex versions-row">
        <div class="flex-grow-1 pa-4 version-col">
          <div class="text-overline text-medium-emphasis">This Computer</div>
          <div class="text-caption text-medium-emphasis mb-3">Edited {{ thisVersionUpdatedAt(conflict) }}</div>
          <div
            v-for="field in diffFields(conflict.thisVersion, conflict.otherVersion)"
            :key="field.key"
            class="text-body-2 mb-1"
            :class="{ 'diff-changed': field.changed }"
          >
            <span class="font-weight-medium">{{ field.key }}:</span> {{ formatValue(field.thisValue) }}
          </div>
          <v-btn variant="flat" color="primary" block class="mt-3" @click="keep(conflict, 'mine')">Keep This Version</v-btn>
        </div>
        <v-divider vertical />
        <div class="flex-grow-1 pa-4 version-col">
          <div class="text-overline text-medium-emphasis">{{ conflict.otherDevice }}</div>
          <div class="text-caption text-medium-emphasis mb-3">Edited {{ formatWhen(conflict.otherUpdatedAt) }}</div>
          <div
            v-for="field in diffFields(conflict.thisVersion, conflict.otherVersion)"
            :key="field.key"
            class="text-body-2 mb-1"
            :class="{ 'diff-changed': field.changed }"
          >
            <span class="font-weight-medium">{{ field.key }}:</span> {{ formatValue(field.otherValue) }}
          </div>
          <v-btn variant="flat" color="primary" block class="mt-3" @click="keep(conflict, 'theirs')">Keep This Version</v-btn>
        </div>
      </div>
    </v-card>

    <p
      v-if="store.loaded && store.conflicts.length === 0 && store.recoveryIssues.length === 0"
      class="text-medium-emphasis text-body-2 text-center py-10"
    >
      The library is healthy. There are no damaged files or sync conflicts right now.
    </p>
    <p v-if="store.conflicts.length > 0" class="text-caption text-medium-emphasis text-center mt-4">
      Only fields that differ are highlighted. Once resolved, the other version is discarded and this stops appearing.
    </p>
  </v-container>
</template>

<style scoped>
.conflict-header {
  background: rgba(var(--v-theme-warning), 0.12);
}
.conflict-card {
  border-color: rgb(var(--v-theme-warning));
}
.diff-changed {
  background: rgba(var(--v-theme-warning), 0.2);
  padding: 2px 4px;
  border-radius: 3px;
}
.recovery-card {
  border-color: rgba(var(--v-theme-error), 0.65);
}
.recovery-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
}
.recovery-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.recovery-copy span {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}
@media (max-width: 680px) {
  .recovery-row {
    grid-template-columns: 1fr;
  }
}
</style>
