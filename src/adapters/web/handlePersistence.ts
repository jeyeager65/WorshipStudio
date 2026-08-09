/**
 * Persists the picked library FileSystemDirectoryHandle in IndexedDB so the folder picker
 * doesn't reappear every launch — confirmed working (queryPermission() comes back "granted" with
 * no re-prompt) in the August 2026 File System Access spike. IndexedDB, not localStorage: a
 * FileSystemDirectoryHandle is a structured-cloneable object, not a string.
 */

const DB_NAME = 'worship-studio-web'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'library-dir'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
}

export async function storeLibraryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export async function loadStoredLibraryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
    request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

export async function clearStoredLibraryHandle(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}
