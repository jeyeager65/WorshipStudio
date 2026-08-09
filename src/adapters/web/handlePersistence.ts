/**
 * Persists picked FileSystemDirectoryHandles in IndexedDB so their folder pickers don't reappear
 * every launch — confirmed working (queryPermission() comes back "granted" with no re-prompt) in
 * the August 2026 File System Access spike. IndexedDB, not localStorage: a
 * FileSystemDirectoryHandle is a structured-cloneable object, not a string.
 *
 * Two independent handles are stored under their own keys: the synced library folder (picked at
 * boot, see BootGate.vue) and the local-only media folder (picked lazily the first time it's
 * actually needed — see adapters/web/media.ts — since 'local' media is, by definition, never
 * part of the synced library folder).
 */

const DB_NAME = 'worship-studio-web'
const STORE_NAME = 'handles'
const LIBRARY_HANDLE_KEY = 'library-dir'
const LOCAL_MEDIA_HANDLE_KEY = 'local-media-dir'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
}

async function storeHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

async function loadStoredHandle(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

async function clearStoredHandle(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export function storeLibraryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return storeHandle(LIBRARY_HANDLE_KEY, handle)
}

export function loadStoredLibraryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return loadStoredHandle(LIBRARY_HANDLE_KEY)
}

export function clearStoredLibraryHandle(): Promise<void> {
  return clearStoredHandle(LIBRARY_HANDLE_KEY)
}

export function storeLocalMediaHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return storeHandle(LOCAL_MEDIA_HANDLE_KEY, handle)
}

export function loadStoredLocalMediaHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return loadStoredHandle(LOCAL_MEDIA_HANDLE_KEY)
}

export function clearStoredLocalMediaHandle(): Promise<void> {
  return clearStoredHandle(LOCAL_MEDIA_HANDLE_KEY)
}
