/**
 * Maps library-relative paths reported by the desktop's filesystem watcher
 * (src-tauri/src/library_watch.rs) to the stores that hold that data, so a change made on another
 * device refreshes only what it actually affects.
 *
 * The directories here mirror what each adapters/web/*.ts port uses — `createFsaCollection(root,
 * 'songs', …)` and friends. They are restated rather than imported because the ports build their
 * paths from a live FileSystemDirectoryHandle and expose no path vocabulary; the coupling is real,
 * so `libraryChanges.spec.ts` pins each one and will fail if a port's directory is renamed without
 * this being updated.
 *
 * See notes/desktop-library-change-detection.md.
 */

/** Every store a watched change can affect. Names match useXStore()'s own, so a caller can act on
 *  them without a second lookup table. */
export type LibraryStoreName =
  | 'songs'
  | 'services'
  | 'people'
  | 'slides'
  | 'themes'
  | 'media'
  | 'announcements'
  | 'songCollections'
  | 'serviceTypes'
  | 'roles'
  | 'roleGroups'
  | 'serviceTemplates'
  | 'externalApps'
  | 'settings'

/** Directory-per-record stores: any `.json` beneath these belongs to that store. */
const DIRECTORY_STORES: ReadonlyArray<readonly [string, LibraryStoreName]> = [
  ['songs/', 'songs'],
  ['services/', 'services'],
  ['people/', 'people'],
  ['slides/', 'slides'],
  ['themes/', 'themes'],
  // The metadata folder, not the `media/` folder of binaries — those are never watched, since
  // changing one always rewrites its metadata here (see library_watch.rs).
  ['media-items/', 'media'],
  ['announcements/', 'announcements'],
]

/** Single-file stores, matched exactly. */
const FILE_STORES: ReadonlyArray<readonly [string, LibraryStoreName]> = [
  ['song-collections.json', 'songCollections'],
  ['service-types.json', 'serviceTypes'],
  ['roles.json', 'roles'],
  ['role-groups.json', 'roleGroups'],
  ['service-templates.json', 'serviceTemplates'],
  ['external-app-profiles.json', 'externalApps'],
  ['library-settings.json', 'settings'],
  ['credentials.json', 'settings'],
]

/** The store one changed path belongs to, or undefined for anything unrecognised — a file this
 *  version does not know about must never be mistaken for one it does. */
export function storeForLibraryPath(path: string): LibraryStoreName | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  for (const [file, store] of FILE_STORES) {
    if (normalized === file) return store
  }
  for (const [dir, store] of DIRECTORY_STORES) {
    if (normalized.startsWith(dir)) return store
  }
  return undefined
}

/** The distinct stores a batch of changed paths affects, in a stable order so a caller rendering
 *  them gets the same list twice for the same change. */
export function storesForLibraryPaths(paths: readonly string[]): LibraryStoreName[] {
  const found = new Set<LibraryStoreName>()
  for (const path of paths) {
    const store = storeForLibraryPath(path)
    if (store) found.add(store)
  }
  return [...found].sort()
}

const STORE_LABELS: Record<LibraryStoreName, string> = {
  songs: 'songs',
  services: 'services',
  people: 'people',
  slides: 'slides',
  themes: 'themes',
  media: 'media',
  announcements: 'announcements',
  songCollections: 'song collections',
  serviceTypes: 'service types',
  roles: 'roles',
  roleGroups: 'role categories',
  serviceTemplates: 'service templates',
  externalApps: 'external apps',
  settings: 'settings',
}

/** Names the changed areas for the operator, e.g. "songs and services". Deliberately says *what*
 *  changed rather than how many files: "3 files changed" tells nobody anything useful, while
 *  "songs changed" is enough to judge whether reloading now matters. */
export function describeLibraryChanges(stores: readonly LibraryStoreName[]): string {
  const labels = stores.map((store) => STORE_LABELS[store])
  if (labels.length === 0) return 'The library'
  if (labels.length === 1) return capitalize(labels[0]!)
  if (labels.length === 2) return capitalize(`${labels[0]} and ${labels[1]}`)
  return capitalize(`${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
