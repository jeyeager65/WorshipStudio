<script setup lang="ts">
import { onMounted } from 'vue'
import { useSyncStore } from '@/stores/sync'
import { diffFields } from '@/utils/conflictDiff'
import type { ConflictedItem } from '@/adapters/types'

const store = useSyncStore()

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
</script>

<template>
  <v-container class="py-8" style="max-width: 820px">
    <h1 class="text-h5 font-weight-bold mb-1">Resolve Sync Conflicts</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">
      These items were edited on two machines before syncing — choose which version to keep for each.
    </p>

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

    <p v-if="store.loaded && store.conflicts.length === 0" class="text-medium-emphasis text-body-2">
      No sync conflicts right now.
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
</style>
