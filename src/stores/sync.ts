import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { ConflictedItem, RecoveryIssue, SyncProgress, SyncStatus } from '@/adapters/types'
import { beginCloudOAuthRedirect, type CloudProviderId } from '@/utils/cloudOAuthRedirect'

// How often to re-poll getProgress() while a sync is running — cloudSync.ts has no push channel
// of its own (SyncPort is a plain Promise-based adapter interface, not an event emitter), so this
// is the only way the app-bar indicator can show live numbers instead of just a spinner for
// however long the in-flight pull/push cycle takes. Frequent enough to feel live, cheap enough
// not to matter (getProgress() just reads an in-memory variable, no I/O).
const PROGRESS_POLL_MS = 400

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
  // Tablet-only — live pull/push progress for whichever sync is currently running, polled while
  // syncing.value is true. undefined on every other adapter kind (getProgress is absent there)
  // and whenever no sync is in flight.
  const progress = ref<SyncProgress>()

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

  /** Shared by runSync/resetAndResync below — sets syncing/progress around whichever adapter
   *  call actually does the work, refreshing status afterward either way, success or failure, so
   *  a stuck or failed run doesn't leave a stale "syncing" indicator on screen. A concurrent call
   *  while one is already running is a no-op rather than queuing a second overlapping run —
   *  cloudSync.ts's own syncing guard already protects against overlap, but skipping here too
   *  avoids two callers double-refreshing status needlessly. */
  async function runWithProgress(run: () => Promise<void>) {
    if (syncing.value) return
    syncing.value = true
    const pollHandle = getAdapter().sync.getProgress
      ? window.setInterval(async () => {
          progress.value = await getAdapter().sync.getProgress?.()
        }, PROGRESS_POLL_MS)
      : undefined
    try {
      await run()
    } finally {
      if (pollHandle !== undefined) window.clearInterval(pollHandle)
      progress.value = undefined
      syncing.value = false
      await load()
    }
  }

  /** Tablet-only (SyncPort.runSync is undefined on every other adapter kind, so this silently
   *  no-ops there) — triggers one pull+push cycle. */
  async function runSync() {
    await runWithProgress(async () => {
      await getAdapter().sync.runSync?.()
    })
  }

  /** Tablet-only — clears this device's sync bookkeeping and re-pulls the whole library, fresh
   *  from the cloud, overwriting whatever's already cached (see cloudSync.ts's resetAndResync for
   *  why this deliberately doesn't delete local files first or push afterward). Discards any
   *  not-yet-pushed local edit on this device; callers must confirm that with the operator first
   *  (see LibrarySyncSection.vue). */
  async function resetAndResync() {
    await runWithProgress(async () => {
      await getAdapter().sync.resetAndResync?.()
    })
  }

  // Shared by both surfaces that offer a one-tap reconnect (App.vue's app-wide banner and
  // LibrarySyncSection.vue's inline prompt) so there's one loading/error state regardless of
  // which one the operator happened to tap, not two independently-tracked copies of the same
  // in-flight redirect. See LibrarySyncSection.vue's original doc comment (now here) for why this
  // reuses the device's already-stored client ID/library path rather than asking the operator to
  // re-enter anything, and why it's a full top-level redirect rather than a background call.
  const reconnectingCloud = ref(false)
  const reconnectError = ref('')
  async function reconnectCloud(
    provider: CloudProviderId,
    clientId: string,
    libraryFolderPath: string,
  ) {
    reconnectingCloud.value = true
    reconnectError.value = ''
    try {
      await beginCloudOAuthRedirect(provider, clientId, libraryFolderPath)
    } catch (error) {
      reconnectError.value = error instanceof Error ? error.message : "Couldn't start reconnecting."
      reconnectingCloud.value = false
    }
  }

  return {
    status,
    conflicts,
    recoveryIssues,
    ...asyncState,
    syncing,
    progress,
    load,
    resolve,
    recover,
    quarantine,
    runSync,
    resetAndResync,
    reconnectingCloud,
    reconnectError,
    reconnectCloud,
  }
})
