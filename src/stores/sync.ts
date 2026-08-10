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
  // Separate from asyncState's own loading flag — that one's scoped to *this store's* own
  // load()/resolve()/etc. calls, but a tablet cloud sync is triggered from multiple places
  // (useTabletSync.ts's automatic triggers, the manual "Sync Now" button) that all need one
  // shared "is a sync running right now" signal, visible anywhere in the app (App.vue's app-bar
  // indicator), not just wherever the button that started it happens to be mounted.
  const syncing = ref(false)

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

  /** Tablet-only (SyncPort.runSync is undefined on every other adapter kind, so this silently
   *  no-ops there) — triggers one pull+push cycle and refreshes status.lastSyncedAt/
   *  pendingPushCount afterward either way, success or failure, so a stuck sync doesn't leave a
   *  stale "syncing" indicator on screen. A concurrent call while one is already running is a
   *  no-op rather than queuing a second overlapping run — cloudSync.ts's own runSync() already
   *  guards against overlap, but skipping here too avoids two callers double-refreshing status
   *  needlessly. */
  async function runSync() {
    if (syncing.value) return
    syncing.value = true
    try {
      await getAdapter().sync.runSync?.()
    } finally {
      syncing.value = false
      await load()
    }
  }

  return {
    status,
    conflicts,
    recoveryIssues,
    ...asyncState,
    syncing,
    load,
    resolve,
    recover,
    quarantine,
    runSync,
  }
})
