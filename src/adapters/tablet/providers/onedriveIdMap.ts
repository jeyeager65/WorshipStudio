/**
 * Persists a OneDrive driveItem id -> this device's own relativePath, entirely local to
 * onedrive.ts's own delta processing. Microsoft Graph's /delta feed only guarantees the `id`
 * property on a deleted item's entry -- `parentReference`/`name` (what onedrive.ts's own
 * relativePathFromItem() needs to reconstruct a path) are frequently absent specifically for
 * deletions, so a deletion whose path can't be reconstructed that way is otherwise silently
 * dropped (confirmed on a real device: items deleted upstream never disappeared locally except
 * after a full Clear & Re-sync, which uses a completely different, id-independent mechanism --
 * see cloudSync.ts's reconcileOrphans()). Recording id -> path for every live item this device
 * has ever seen lets a later id-only deletion still resolve back to a real path.
 *
 * A separate IndexedDB database from syncStore.ts (provider-agnostic, shared with Dropbox, which
 * has no need for this at all -- its own delta entries always carry a path directly) and from
 * onedriveAuthStorage.ts's tokens -- same isolation reasoning as that file's own doc comment.
 */

const DB_NAME = 'worship-studio-tablet-onedrive-ids'
const STORE_NAME = 'ids'

let dbPromise: Promise<IDBDatabase> | undefined

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        dbPromise = undefined
        reject(request.error as Error)
      }
    })
  }
  return dbPromise
}

export async function getPathForId(id: string): Promise<string | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result as string | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

export async function setPathForId(id: string, path: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(path, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export async function deletePathForId(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}
