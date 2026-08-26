/**
 * Surfaces library changes made outside this app — a tablet's edit arriving through the cloud
 * client, a second desktop, or a hand edit — which the desktop otherwise could not see at all.
 *
 * Stores load once per app session and views skip reloading when already loaded, so before this the
 * only refresh was restarting. See notes/desktop-library-change-detection.md, and
 * src-tauri/src/library_watch.rs for the watcher that feeds it.
 *
 * Three decisions from that note shape this:
 *
 * - **Prompt, never reload underneath the operator.** A silent refresh mid-edit is worse than the
 *   staleness it fixes.
 * - **Say nothing while presenting.** The signal is held rather than dropped, so a change arriving
 *   mid-service is still offered once presenting stops.
 *
 * The note also called for skipping stores behind unsaved work. That turned out to guard against
 * something that cannot happen: editors do not read from these stores. SongEditorView and
 * ServiceWorkspaceView each fetch their record straight from the adapter into a private ref, so a
 * store reload refreshes the *lists* and leaves an open editor's draft untouched. Skipping made
 * Reload do nothing at all whenever anything was dirty, which is strictly worse than the risk it
 * imagined.
 *
 * A no-op anywhere but the desktop build: only the Tauri backend has a filesystem to watch.
 */
import { computed, onMounted, onUnmounted, ref, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getAdapter } from '@/adapters'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useSongsStore } from '@/stores/songs'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useSlidesStore } from '@/stores/slides'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useRolesStore } from '@/stores/roles'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useServiceTemplatesStore } from '@/stores/serviceTemplates'
import { useExternalAppsStore } from '@/stores/externalApps'
import { useSettingsStore } from '@/stores/settings'
import { useLibraryChangesStore } from '@/stores/libraryChanges'
import {
  describeLibraryChanges,
  storesForLibraryPaths,
  type LibraryStoreName,
} from '@/utils/libraryChanges'
import { logger } from '@/utils/logger'

/** Mirrors library_watch.rs's own constant. */
const LIBRARY_CHANGED_EVENT = 'library:changed'

export interface LibraryChangeWatch {
  /** Whether there is something to offer the operator right now — false while presenting, even
   *  when changes are waiting. */
  hasChanges: ComputedRef<boolean>
  /** e.g. "Songs and services", for the banner. */
  summary: ComputedRef<string>
  /** Reloads the stores that changed. Safe with an editor open: editors hold their own copy of the
   *  record they are editing, so this refreshes lists without touching unsaved work. */
  reload: () => Promise<void>
  /** Drops the pending changes without reloading — the operator chose to stay as they are. */
  dismiss: () => void
}

export function useLibraryChangeWatch(): LibraryChangeWatch {
  const liveSession = useLiveSessionStore()
  const { isPresenting } = storeToRefs(liveSession)

  const pending = ref<LibraryStoreName[]>([])
  let unlisten: UnlistenFn | undefined

  // Built lazily inside reload() rather than up front: every one of these is a Pinia store, and
  // instantiating fifteen of them for a feature that may never fire is needless work at startup.
  function reloaders(): Record<LibraryStoreName, () => Promise<unknown>> {
    return {
      songs: () => useSongsStore().load(),
      services: () => useServicesStore().load(),
      people: () => usePeopleStore().load(),
      slides: () => useSlidesStore().load(),
      themes: () => useThemesStore().load(),
      media: () => useMediaStore().load(),
      announcements: () => useAnnouncementsStore().load(),
      songCollections: () => useSongCollectionsStore().load(),
      serviceTypes: () => useServiceTypesStore().load(),
      roles: () => useRolesStore().load(),
      roleGroups: () => useRoleGroupsStore().load(),
      serviceTemplates: () => useServiceTemplatesStore().load(),
      externalApps: () => useExternalAppsStore().load(),
      settings: () => useSettingsStore().load(),
    }
  }

  // Held, not dropped: a change that arrives mid-service is still worth offering afterward, and
  // silently discarding it would leave the desktop stale with no further notice.
  const hasChanges = computed(() => pending.value.length > 0 && !isPresenting.value)
  const summary = computed(() => describeLibraryChanges(pending.value))

  async function reload() {
    const stores = pending.value
    if (stores.length === 0) return
    const load = reloaders()
    await Promise.all(
      stores.map(async (store) => {
        try {
          await load[store]()
        } catch (error) {
          // One store failing must not strand the rest, or the banner would keep offering a
          // reload that can never fully succeed.
          logger.warn('sync', `Could not reload ${store} after an external library change`, error)
        }
      }),
    )
    pending.value = []
  }

  function dismiss() {
    pending.value = []
  }

  onMounted(async () => {
    if (getAdapter().kind !== 'tauri') return
    try {
      unlisten = await listen<string[]>(LIBRARY_CHANGED_EVENT, (event) => {
        const paths = event.payload ?? []
        // Per-record, for open editors: reloading a store cannot reach an editor's private copy of
        // the record it is editing, and saving over someone else's change unwarned is the real harm
        // here. See stores/libraryChanges.ts.
        useLibraryChangesStore().note(paths)
        const stores = storesForLibraryPaths(paths)
        if (stores.length === 0) return
        pending.value = [...new Set([...pending.value, ...stores])].sort() as LibraryStoreName[]
      })
    } catch (error) {
      // Without this the app behaves exactly as it did before change detection existed.
      logger.warn('sync', 'Could not listen for library changes', error)
    }
  })

  onUnmounted(() => {
    unlisten?.()
    unlisten = undefined
  })

  return { hasChanges, summary, reload, dismiss }
}
