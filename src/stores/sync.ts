import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { ConflictedItem, SyncStatus } from '@/adapters/types'

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatus>()
  const conflicts = ref<ConflictedItem[]>([])
  const loaded = ref(false)

  async function load() {
    const [loadedStatus, loadedConflicts] = await Promise.all([
      getAdapter().sync.getStatus(),
      getAdapter().sync.listConflicts(),
    ])
    status.value = loadedStatus
    conflicts.value = loadedConflicts
    loaded.value = true
  }

  async function resolve(conflictFilePath: string, keep: 'mine' | 'theirs') {
    await getAdapter().sync.resolveConflict(conflictFilePath, keep)
    await load()
  }

  return { status, conflicts, loaded, load, resolve }
})
