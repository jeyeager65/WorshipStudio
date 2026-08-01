import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { ConflictedItem, RecoveryIssue, SyncStatus } from '@/adapters/types'

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatus>()
  const conflicts = ref<ConflictedItem[]>([])
  const recoveryIssues = ref<RecoveryIssue[]>([])
  const loaded = ref(false)

  async function load() {
    const [loadedStatus, loadedConflicts, loadedRecoveryIssues] = await Promise.all([
      getAdapter().sync.getStatus(),
      getAdapter().sync.listConflicts(),
      getAdapter().sync.listRecoveryIssues(),
    ])
    status.value = loadedStatus
    conflicts.value = loadedConflicts
    recoveryIssues.value = loadedRecoveryIssues
    loaded.value = true
  }

  async function resolve(conflictFilePath: string, keep: 'mine' | 'theirs') {
    await getAdapter().sync.resolveConflict(conflictFilePath, keep)
    await load()
  }

  async function recover(filePath: string) {
    await getAdapter().sync.recoverFile(filePath)
    await load()
  }

  async function quarantine(filePath: string): Promise<string> {
    const destination = await getAdapter().sync.quarantineFile(filePath)
    await load()
    return destination
  }

  return { status, conflicts, recoveryIssues, loaded, load, resolve, recover, quarantine }
})
