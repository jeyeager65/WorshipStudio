import { describe, expect, it } from 'vitest'
import {
  describeLibraryChanges,
  storeForLibraryPath,
  storesForLibraryPaths,
} from '@/utils/libraryChanges'

describe('storeForLibraryPath', () => {
  // These pin the directories each adapters/web/*.ts port actually uses. If a port's directory is
  // renamed without updating libraryChanges.ts, changes to it would silently stop refreshing
  // anything — a failure that would otherwise only show up as "the desktop didn't notice".
  it('maps every directory-per-record store', () => {
    expect(storeForLibraryPath('songs/song-1.json')).toBe('songs')
    expect(storeForLibraryPath('services/2026/service-1.json')).toBe('services')
    expect(storeForLibraryPath('people/person-1.json')).toBe('people')
    expect(storeForLibraryPath('slides/slide-1.json')).toBe('slides')
    expect(storeForLibraryPath('themes/theme-1.json')).toBe('themes')
    expect(storeForLibraryPath('announcements/a-1.json')).toBe('announcements')
  })

  it('maps media metadata, which is the folder that is actually watched', () => {
    // library_watch.rs never reports binaries: replacing one rewrites its metadata here, so the
    // metadata change is the only signal needed.
    expect(storeForLibraryPath('media-items/item-1.json')).toBe('media')
    expect(storeForLibraryPath('media/clip.mp4')).toBeUndefined()
  })

  it('maps every single-file store', () => {
    expect(storeForLibraryPath('song-collections.json')).toBe('songCollections')
    expect(storeForLibraryPath('service-types.json')).toBe('serviceTypes')
    expect(storeForLibraryPath('roles.json')).toBe('roles')
    expect(storeForLibraryPath('role-groups.json')).toBe('roleGroups')
    expect(storeForLibraryPath('service-templates.json')).toBe('serviceTemplates')
    expect(storeForLibraryPath('external-app-profiles.json')).toBe('externalApps')
    expect(storeForLibraryPath('library-settings.json')).toBe('settings')
    expect(storeForLibraryPath('credentials.json')).toBe('settings')
  })

  it('tolerates the separators and leading slashes a path might arrive with', () => {
    expect(storeForLibraryPath('songs\\song-1.json')).toBe('songs')
    expect(storeForLibraryPath('/songs/song-1.json')).toBe('songs')
  })

  it('returns undefined for anything it does not recognise, rather than guessing', () => {
    expect(storeForLibraryPath('something-new.json')).toBeUndefined()
    expect(storeForLibraryPath('notes.txt')).toBeUndefined()
    // Not a prefix match on a single-file store's name.
    expect(storeForLibraryPath('roles.json.backup')).toBeUndefined()
  })
})

describe('storesForLibraryPaths', () => {
  it('collapses many paths to the distinct stores they touch, in a stable order', () => {
    expect(
      storesForLibraryPaths([
        'songs/a.json',
        'songs/b.json',
        'services/2026/s.json',
        'unknown.json',
      ]),
    ).toEqual(['services', 'songs'])
  })

  it('is empty when nothing recognised changed', () => {
    expect(storesForLibraryPaths(['whatever.json'])).toEqual([])
  })
})

describe('describeLibraryChanges', () => {
  it('names what changed rather than counting files', () => {
    expect(describeLibraryChanges(['songs'])).toBe('Songs')
    expect(describeLibraryChanges(['songs', 'services'])).toBe('Songs and services')
    expect(describeLibraryChanges(['songs', 'services', 'people'])).toBe(
      'Songs, services and people',
    )
  })

  it('uses wording an operator would recognise, not the store name', () => {
    expect(describeLibraryChanges(['roleGroups'])).toBe('Role categories')
    expect(describeLibraryChanges(['songCollections'])).toBe('Song collections')
  })

  it('falls back to something sensible when nothing is named', () => {
    expect(describeLibraryChanges([])).toBe('The library')
  })
})
