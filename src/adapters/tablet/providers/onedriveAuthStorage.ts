/**
 * Persists this device's OneDrive OAuth tokens — deliberately a separate IndexedDB database from
 * dropboxAuthStorage.ts's (`worship-studio-tablet-auth-onedrive` vs. `worship-studio-tablet-auth`)
 * rather than a shared schema, so each provider's token lifecycle stays fully independent and
 * neither can accidentally read or clobber the other's tokens. Same isolation reasoning as
 * dropboxAuthStorage.ts itself: never OPFS (outside wrapWithDirtyTracking's reach), never
 * MachineSettings (a poor fit for frequent silent background refresh).
 */

export interface OneDriveTokens {
  accessToken: string
  refreshToken: string
  /** Unix ms — this access token's own expiry (typically ~1h out). */
  expiresAt: number
  /** Unix ms — when the *refresh token itself* expires. Microsoft caps refresh tokens issued to
   *  an `spa` redirect at 24h regardless of use (see onedriveAuth.ts's doc comment) — this is
   *  what getValidAccessToken() checks to decide whether a silent reauth is even worth
   *  attempting versus going straight to ProviderReauthRequiredError. */
  refreshTokenExpiresAt: number
  accountId: string
}

const DB_NAME = 'worship-studio-tablet-auth-onedrive'
const STORE_NAME = 'onedrive'
const TOKENS_KEY = 'tokens'

// Cached rather than opened fresh per call — cloudSync.ts's requireToken() now checks the token
// once per file during a sync (see that file's own doc comment for why once-per-batch let a
// long-running sync's token quietly expire mid-way through), so this can be called many times in
// one sync; a fresh IndexedDB connection every time would be the exact same needless overhead
// syncStore.ts's own openDb() had before it was fixed for the same reason.
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

export async function loadOneDriveTokens(): Promise<OneDriveTokens | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(TOKENS_KEY)
    request.onsuccess = () => resolve(request.result as OneDriveTokens | undefined)
    request.onerror = () => reject(request.error as Error)
  })
}

export async function saveOneDriveTokens(tokens: OneDriveTokens): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(tokens, TOKENS_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export async function clearOneDriveTokens(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(TOKENS_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}
