/**
 * Persisted sync bookkeeping for the tablet's Dropbox sync engine (cloudSync.ts) — a separate
 * IndexedDB database from dropboxAuthStorage.ts's tokens (see that file's doc comment for why
 * auth is kept isolated) and from the OPFS-backed library data itself.
 *
 * Four independent stores:
 * - meta: the list_folder cursor and last successful sync time (singleton values).
 * - dirty: paths written or deleted locally since the last successful push for that path.
 * - revs: the last-known Dropbox revision per path — what makes a push's conditional write
 *   possible, and what a pull compares against to decide whether a remote file actually changed.
 * - conflicts: paths currently blocked on a materialized conflict artifact, so push() doesn't
 *   retry (and re-fail) them every cycle until resolveConflict() clears the entry.
 */

export interface DirtyEntry {
  deleted: boolean
  attempts: number
  /** Unix ms — push() skips this path until now, backoff after a failed attempt. */
  nextRetryAt: number
}

export interface RemoteRevEntry {
  rev: string
  contentHash?: string
  sizeBytes: number
}

/** The remote rev is carried alongside the artifact path so a later resolveConflict() can update
 *  this path's rev bookkeeping to match whichever side ends up winning, without a second
 *  round-trip to Dropbox just to re-discover the rev the conflict was already downloaded at. */
export interface ConflictEntry {
  conflictFilePath: string
  remoteRev: string
  remoteContentHash?: string
  remoteSizeBytes: number
}

const DB_NAME = 'worship-studio-tablet-sync'
const META_STORE = 'meta'
const DIRTY_STORE = 'dirty'
const REVS_STORE = 'revs'
const CONFLICTS_STORE = 'conflicts'
const CURSOR_KEY = 'cursor'
const LAST_SYNCED_AT_KEY = 'lastSyncedAt'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(META_STORE)
      db.createObjectStore(DIRTY_STORE)
      db.createObjectStore(REVS_STORE)
      db.createObjectStore(CONFLICTS_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
}

async function getValue<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const request = tx.objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

async function putValue(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

async function deleteValue(store: string, key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

async function getAllEntries<T>(store: string): Promise<[string, T][]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const objectStore = tx.objectStore(store)
    const keysRequest = objectStore.getAllKeys()
    const valuesRequest = objectStore.getAll()
    tx.oncomplete = () => {
      const keys = keysRequest.result as string[]
      const values = valuesRequest.result as T[]
      resolve(keys.map((key, index) => [key, values[index]!]))
    }
    tx.onerror = () => reject(tx.error as Error)
  })
}

export const syncStore = {
  getCursor: (): Promise<string | undefined> => getValue<string>(META_STORE, CURSOR_KEY),
  setCursor: (cursor: string): Promise<void> => putValue(META_STORE, CURSOR_KEY, cursor),
  clearCursor: (): Promise<void> => deleteValue(META_STORE, CURSOR_KEY),

  getLastSyncedAt: (): Promise<string | undefined> =>
    getValue<string>(META_STORE, LAST_SYNCED_AT_KEY),
  setLastSyncedAt: (iso: string): Promise<void> => putValue(META_STORE, LAST_SYNCED_AT_KEY, iso),

  getDirty: (path: string): Promise<DirtyEntry | undefined> => getValue(DIRTY_STORE, path),
  setDirty: (path: string, entry: DirtyEntry): Promise<void> => putValue(DIRTY_STORE, path, entry),
  clearDirty: (path: string): Promise<void> => deleteValue(DIRTY_STORE, path),
  getAllDirty: (): Promise<[string, DirtyEntry][]> => getAllEntries(DIRTY_STORE),

  getRev: (path: string): Promise<RemoteRevEntry | undefined> => getValue(REVS_STORE, path),
  setRev: (path: string, entry: RemoteRevEntry): Promise<void> => putValue(REVS_STORE, path, entry),
  clearRev: (path: string): Promise<void> => deleteValue(REVS_STORE, path),

  getConflict: (path: string): Promise<ConflictEntry | undefined> => getValue(CONFLICTS_STORE, path),
  setConflict: (path: string, entry: ConflictEntry): Promise<void> =>
    putValue(CONFLICTS_STORE, path, entry),
  clearConflict: (path: string): Promise<void> => deleteValue(CONFLICTS_STORE, path),
  getAllConflicts: (): Promise<[string, ConflictEntry][]> => getAllEntries(CONFLICTS_STORE),
}
