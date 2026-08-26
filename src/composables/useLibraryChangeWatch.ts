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
 * - **A dirty editor is never refreshed.** Reloading the store behind unsaved work would discard
 *   it, so those stores are left alone and stay listed as still-pending.
 *
 * A no-op anywhere but the desktop build: only the Tauri backend has a filesystem to watch.
 */
import { computed, onMounted, onUnmounted, ref, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getAdapter } from '@/adapters'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
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
  /** Reloads what changed, skipping any store behind unsaved work. */
  reload: () => Promise<void>
  /** Drops the pending changes without reloading — the operator chose to stay as they are. */
  dismiss: () => void
}

export function useLibraryChangeWatch(): LibraryChangeWatch {
  const liveSession = useLiveSessionStore()
  const unsavedChanges = useUnsavedChangesStore()
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
    // Refreshing a store behind an editor with unsaved work would silently discard that work, so
    // it is left stale on purpose — staleness confined to the one thing being actively edited is
    // the safest available failure. It stays pending, so the banner keeps offering it.
    const skipped = unsavedChanges.isDirty ? stores : []
    const toReload = stores.filter((store) => !skipped.includes(store))
    const load = reloaders()
    await Promise.all(
      toReload.map(async (store) => {
        try {
          await load[store]()
        } catch (error) {
          logger.warn('sync', `Could not reload ${store} after an external library change`, error)
        }
      }),
    )
    pending.value = skipped
  }

  function dismiss() {
    pending.value = []
  }

  onMounted(async () => {
    if (getAdapter().kind !== 'tauri') return
    try {
      unlisten = await listen<string[]>(LIBRARY_CHANGED_EVENT, (event) => {
        const stores = storesForLibraryPaths(event.payload ?? [])
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
