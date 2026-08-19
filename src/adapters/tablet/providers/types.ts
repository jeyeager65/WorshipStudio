/**
 * The seam between the tablet's sync engine (../cloudSync.ts, provider-agnostic) and a specific
 * cloud storage API (dropbox.ts, onedrive.ts). cloudSync.ts only ever talks to this interface —
 * every provider-specific quirk (how pagination/delta cursors work, lower-case vs display-case
 * paths, which HTTP status means "conflict" vs "rate limited") is resolved *inside* the concrete
 * provider module before it ever reaches cloudSync.ts.
 *
 * `listChanges` is deliberately "fully resolved": a concrete provider handles its own pagination
 * and (Dropbox's cursor-reset / equivalent Graph delta resync-required) internally and always
 * returns one complete, ready-to-apply batch plus the next cursor — cloudSync.ts never needs to
 * know how a given provider represents "give me everything since X." Likewise every returned
 * entry's `path` is already relative to the configured library folder, in real (not lowercased)
 * case, with folders and the library-folder-root entry itself already filtered out — cloudSync.ts
 * only ever sees files that actually need applying.
 *
 * `isFromScratchListing` is why a provider can't fully hide its cursor-reset recovery: a listing
 * produced that way has the same "can only report what currently exists, not what's been deleted
 * since" limitation as a genuinely first-ever pull (no cursor at all), and cloudSync.ts's orphan
 * reconciliation needs to run in both cases — see cloudSync.ts's reconcileOrphans doc comment.
 * Deliberately reported by the provider itself rather than inferred by the caller from whether the
 * cursor it *passed in* was undefined: a stale/invalidated cursor still starts as a defined value,
 * so that inference alone would miss exactly the case reconciliation exists for.
 */

export interface ProviderFileEntry {
  tag: 'file'
  /** Relative to the provider's configured library folder, POSIX-style, real case — ready to use
   *  directly as an OPFS path. */
  path: string
  rev: string
  contentHash?: string
  sizeBytes: number
}

export interface ProviderDeletedEntry {
  tag: 'deleted'
  path: string
}

export type ProviderEntry = ProviderFileEntry | ProviderDeletedEntry

export type ProviderWriteMode = 'add' | { updateRev: string }

/** `kind` is the normalized outcome cloudSync.ts branches on — never a raw HTTP status, since
 *  what status means what varies per provider (e.g. Dropbox and Graph don't even agree on which
 *  code means "conflict"). */
export class ProviderApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'conflict' | 'rate-limit' | 'other',
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ProviderApiError'
  }
}

/** Thrown by getValidAccessToken() when this device's credentials can't be silently refreshed
 *  and a visible reconnect is required — distinct from an ordinary transient failure so
 *  cloudSync.ts can stop cleanly and surface SyncStatus.needsReconnect instead of endlessly
 *  retrying. Dropbox's refresh tokens don't expire on their own, so its provider never throws
 *  this; OneDrive's do (a 24h cap on tokens issued to an `spa` redirect), so its provider throws
 *  this once a silent `prompt=none` reauth attempt itself fails. */
export class ProviderReauthRequiredError extends Error {
  constructor(message = 'This device needs to reconnect to finish signing in.') {
    super(message)
    this.name = 'ProviderReauthRequiredError'
  }
}

export interface CloudSyncProvider {
  readonly id: 'dropbox' | 'onedrive'
  /** Throws ProviderReauthRequiredError if this device's connection can't be silently renewed. */
  getValidAccessToken(): Promise<string>
  isConnected(): Promise<boolean>
  disconnect(): Promise<void>
  listChanges(
    token: string,
    cursor: string | undefined,
  ): Promise<{ entries: ProviderEntry[]; cursor: string; isFromScratchListing: boolean }>
  download(
    token: string,
    path: string,
  ): Promise<{ bytes: ArrayBuffer; rev: string; contentHash?: string; sizeBytes: number }>
  upload(
    token: string,
    path: string,
    bytes: ArrayBuffer,
    mode: ProviderWriteMode,
  ): Promise<{ rev: string; contentHash?: string; sizeBytes: number }>
  deleteFile(token: string, path: string): Promise<void>
}
