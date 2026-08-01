import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ConflictedItem, RecoveryIssue, SyncStatus } from '@/adapters/types'

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatus>()
  const conflicts = ref<ConflictedItem[]>([])
  const recoveryIssues = ref<RecoveryIssue[]>([])
  const asyncState = useAsyncStoreState()

  async function load() {
    return asyncState.runLoad(async () => {
      const [loadedStatus, loadedConflicts, loadedRecoveryIssues] = await Promise.all([
        getAdapter().sync.getStatus(),
        getAdapter().sync.listConflicts(),
        getAdapter().sync.listRecoveryIssues(),
      ])
      status.value = loadedStatus
      conflicts.value = loadedConflicts
      recoveryIssues.value = loadedRecoveryIssues
    })
  }

  async function resolve(conflictFilePath: string, keep: 'mine' | 'theirs') {
    await asyncState.runMutation(() => getAdapter().sync.resolveConflict(conflictFilePath, keep))
    await load()
  }

  async function recover(filePath: string) {
    await asyncState.runMutation(() => getAdapter().sync.recoverFile(filePath))
    await load()
  }

  async function quarantine(filePath: string): Promise<string> {
    const destination = await asyncState.runMutation(() =>
      getAdapter().sync.quarantineFile(filePath),
    )
    await load()
    return destination
  }

  return { status, conflicts, recoveryIssues, ...asyncState, load, resolve, recover, quarantine }
})
