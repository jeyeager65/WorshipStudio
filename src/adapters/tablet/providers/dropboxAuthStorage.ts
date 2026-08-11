/**
 * Persists this device's Dropbox OAuth tokens — a separate IndexedDB database from both the
 * library's own OPFS-backed storage and syncStore.ts's cursor/dirty-tracking state. Deliberately
 * isolated rather than folded into either of those:
 * - Never OPFS: keeps credentials structurally outside the tree wrapWithDirtyTracking watches,
 *   so a token can never accidentally get swept into a push.
 * - Never MachineSettings/localStorage: that round-trips as one JSON blob on every save
 *   (adapters/web/settings.ts), a poor fit for frequent silent background token refresh.
 * Mirrors the Tauri desktop build's own precedent — canva-auth.json is a dedicated file
 * separate from machine-settings.json for the exact same reason (see paths.rs's
 * canva_auth_path).
 */

export interface DropboxTokens {
  accessToken: string
  refreshToken: string
  /** Unix ms. */
  expiresAt: number
  accountId: string
}

const DB_NAME = 'worship-studio-tablet-auth'
const STORE_NAME = 'dropbox'
const TOKENS_KEY = 'tokens'

// Cached rather than opened fresh per call — see onedriveAuthStorage.ts's identical fix for why
// (cloudSync.ts's requireToken() now checks the token once per file during a sync, so this can be
// called many times in one sync).
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

export async function loadDropboxTokens(): Promise<DropboxTokens | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(TOKENS_KEY)
    request.onsuccess = () => resolve(request.result as DropboxTokens | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

export async function saveDropboxTokens(tokens: DropboxTokens): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(tokens, TOKENS_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export async function clearDropboxTokens(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(TOKENS_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}
