import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryChangesStore } from '@/stores/libraryChanges'

describe('libraryChanges store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('tells an editor its own record changed, and leaves others alone', () => {
    const store = useLibraryChangesStore()
    store.note(['people/person-1.json'])

    expect(store.wasChangedElsewhere('people', 'person-1')).toBe(true)
    expect(store.wasChangedElsewhere('people', 'person-2')).toBe(false)
    // Same id in a different store is a different record.
    expect(store.wasChangedElsewhere('songs', 'person-1')).toBe(false)
  })

  it('ignores whole-list files, which the app-bar banner already covers', () => {
    const store = useLibraryChangesStore()
    store.note(['roles.json', 'service-types.json'])
    expect(store.changedKeys.size).toBe(0)
  })

  it('treats an unsaved record with no id as unchanged rather than throwing', () => {
    const store = useLibraryChangesStore()
    store.note(['people/person-1.json'])
    expect(store.wasChangedElsewhere('people', undefined)).toBe(false)
  })

  it('clears a record once the editor has dealt with it', () => {
    const store = useLibraryChangesStore()
    store.note(['songs/song-1.json'])
    store.acknowledge('songs', 'song-1')
    expect(store.wasChangedElsewhere('songs', 'song-1')).toBe(false)
  })

  it('keeps a record noted until acknowledged, so an editor opened later still learns of it', () => {
    // The watcher fires whether or not anything has that record open; an editor opened afterward
    // is exactly the case where the operator has no other way of knowing.
    const store = useLibraryChangesStore()
    store.note(['services/2026/service-1.json'])
    store.note(['songs/song-9.json'])
    expect(store.wasChangedElsewhere('services', 'service-1')).toBe(true)
  })

  it('does not re-notify for a repeat of the same change', () => {
    const store = useLibraryChangesStore()
    store.note(['songs/song-1.json'])
    const first = store.changedKeys
    store.note(['songs/song-1.json'])
    // Same Set instance: nothing new, so no reactive churn for watchers of this store.
    expect(store.changedKeys).toBe(first)
  })
})
