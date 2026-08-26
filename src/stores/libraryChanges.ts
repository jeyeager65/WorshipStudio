/**
 * Which individual records changed on another device, so an open editor can notice that the thing
 * it is editing moved underneath it.
 *
 * The app-bar banner (useLibraryChangeWatch) works at store granularity — "songs changed" — which
 * is right for refreshing lists but tells an editor nothing. Reloading a store does not touch an
 * open editor either: editors hold a private copy of their record (SongEditorView fetches from the
 * adapter, PersonEditorView `structuredClone`s out of the store), so they keep showing the version
 * they started from.
 *
 * Left alone, that is a silent overwrite: the operator saves their draft, the save path has no
 * version check anywhere, and the other device's change is gone with no artifact and no warning.
 * This store exists so an editor can say so before that happens.
 *
 * Deliberately only a *warning*. Last-write-wins stays the behaviour — for a service being edited
 * on the presenting machine mid-song, that machine should win, and it does. What was missing was
 * telling anyone.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { recordKey, recordKeyForLibraryPath, type LibraryStoreName } from '@/utils/libraryChanges'

export const useLibraryChangesStore = defineStore('libraryChanges', () => {
  /** `store:id` for every record seen changing since the app started. Not cleared wholesale: an
   *  editor opened later still wants to know its record moved while it was closed. */
  const changedKeys = ref(new Set<string>())

  /** Records what the desktop watcher reported. Paths that name no individual record (the
   *  single-file stores) are ignored here — the banner already covers those. */
  function note(paths: readonly string[]) {
    const next = new Set(changedKeys.value)
    let added = false
    for (const path of paths) {
      const key = recordKeyForLibraryPath(path)
      if (key && !next.has(key)) {
        next.add(key)
        added = true
      }
    }
    if (added) changedKeys.value = next
  }

  function wasChangedElsewhere(store: LibraryStoreName, id: string | undefined): boolean {
    return !!id && changedKeys.value.has(recordKey(store, id))
  }

  /** Called once an editor has dealt with it — reloaded the newer version, or chosen to keep its
   *  own. Either way the operator has been told, which is all this set is for. */
  function acknowledge(store: LibraryStoreName, id: string | undefined) {
    if (!id) return
    const key = recordKey(store, id)
    if (!changedKeys.value.has(key)) return
    const next = new Set(changedKeys.value)
    next.delete(key)
    changedKeys.value = next
  }

  return { changedKeys, note, wasChangedElsewhere, acknowledge }
})
