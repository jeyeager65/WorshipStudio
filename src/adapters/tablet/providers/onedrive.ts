/**
 * OneDrive's implementation of ../types.ts's CloudSyncProvider, over the Microsoft Graph REST
 * API. The only place in this codebase that knows Graph represents changes as a `/delta` feed
 * (a `@odata.nextLink`-paginated, `@odata.deltaLink`-terminated stream, restarted from scratch on
 * a 410 `resyncRequired`), that conflict detection is an `If-Match`/`If-None-Match` eTag check
 * (412 on mismatch), or that large uploads need an upload session chunked in multiples of 320
 * KiB. cloudSync.ts never sees any of that — only this module's already-resolved
 * ProviderEntry/ProviderApiError shapes, exactly like providers/dropbox.ts.
 */

import type { CloudSyncProvider, ProviderEntry, ProviderWriteMode } from './types'
import { ProviderApiError, ProviderReauthRequiredError } from './types'
import * as auth from './onedriveAuth'

export interface OneDriveProviderConfig {
  clientId: string
  /** Path (relative to the connected account's OneDrive root) where the library lives — "" for
   *  the root itself. */
  libraryFolderPath: string
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
// Graph requires every upload-session chunk except the last to be a multiple of 320 KiB
// (327,680 bytes) — 32 * 327,680 lands exactly on 10 MiB, matching dropboxClient.ts's own
// chunk-size ballpark for large media.
const UPLOAD_CHUNK_SIZE_BYTES = 32 * 327_680
const SIMPLE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024

interface GraphItem {
  name: string
  parentReference?: { path?: string }
  file?: { hashes?: { quickXorHash?: string } }
  folder?: unknown
  deleted?: { state?: string }
  eTag?: string
  size?: number
}

class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'GraphApiError'
  }
}

async function throwForErrorResponse(response: Response): Promise<never> {
  const retryAfterHeader = response.headers.get('Retry-After')
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    detail = await response.text().catch(() => '')
  }
  throw new GraphApiError(
    `Microsoft Graph request failed (${response.status}). ${detail}`.trim(),
    response.status,
    retryAfterSeconds,
  )
}

function toProviderError(error: unknown): never {
  if (error instanceof GraphApiError) {
    if (error.status === 429) throw new ProviderApiError(error.message, 'rate-limit', error.retryAfterSeconds)
    if (error.status === 412 || error.status === 409) throw new ProviderApiError(error.message, 'conflict')
    throw new ProviderApiError(error.message, 'other')
  }
  throw error instanceof Error ? error : new Error(String(error))
}

function isResyncRequiredError(error: unknown): boolean {
  return error instanceof GraphApiError && error.status === 410
}

async function graphFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  })
  if (!response.ok) await throwForErrorResponse(response)
  return response
}

/** Graph's colon-path addressing, e.g. "Library/songs/song-1.json" -> "/me/drive/root:/Library/songs/song-1.json:". */
function itemPath(relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return encoded ? `/me/drive/root:/${encoded}:` : '/me/drive/root'
}

export function createOneDriveProvider(config: OneDriveProviderConfig): CloudSyncProvider {
  const libraryFolderPath = config.libraryFolderPath.trim().replace(/^\/+|\/+$/g, '')
  const libraryFolderSegments = libraryFolderPath.split('/').filter(Boolean)

  /** Prefixes the configured library folder onto a path relative to it — every download/upload/
   *  delete call receives a library-relative path (matching the ProviderEntry.path contract),
   *  but Graph's own addressing needs the full path from the drive root. */
  function fullPath(relativePath: string): string {
    return libraryFolderPath ? `${libraryFolderPath}/${relativePath}` : relativePath
  }

  function relativePathFromItem(item: GraphItem): string | undefined {
    const parentPath = item.parentReference?.path ?? ''
    const marker = '/root:'
    const markerIndex = parentPath.indexOf(marker)
    const afterRoot = markerIndex === -1 ? '' : parentPath.slice(markerIndex + marker.length)
    const parentSegments = afterRoot.split('/').filter(Boolean)
    for (let i = 0; i < libraryFolderSegments.length; i++) {
      if (parentSegments[i] !== libraryFolderSegments[i]) return undefined
    }
    const relativeParentSegments = parentSegments.slice(libraryFolderSegments.length)
    const segments = [...relativeParentSegments, item.name]
    const path = segments.join('/')
    return path || undefined
  }

  function toProviderEntry(item: GraphItem): ProviderEntry | undefined {
    if (item.folder) return undefined
    const path = relativePathFromItem(item)
    if (!path) return undefined
    if (item.deleted?.state) return { tag: 'deleted', path }
    return {
      tag: 'file',
      path,
      rev: item.eTag ?? '',
      contentHash: item.file?.hashes?.quickXorHash,
      sizeBytes: item.size ?? 0,
    }
  }

  async function fetchAllDeltaPages(token: string, startUrl: string): Promise<{ entries: ProviderEntry[]; cursor: string }> {
    const entries: ProviderEntry[] = []
    let url = startUrl
    let cursor = startUrl
     
    while (true) {
      const response = await graphFetch(token, url)
      const body = (await response.json()) as {
        value: GraphItem[]
        '@odata.nextLink'?: string
        '@odata.deltaLink'?: string
      }
      for (const item of body.value) {
        const entry = toProviderEntry(item)
        if (entry) entries.push(entry)
      }
      if (body['@odata.deltaLink']) {
        cursor = body['@odata.deltaLink']
        break
      }
      if (!body['@odata.nextLink']) break // shouldn't happen per Graph's contract, but don't loop forever
      url = body['@odata.nextLink']
    }
    return { entries, cursor }
  }

  function initialDeltaUrl(): string {
    const base = libraryFolderPath ? `${GRAPH_BASE}${itemPath(libraryFolderPath)}` : `${GRAPH_BASE}/me/drive/root`
    return `${base}/delta`
  }

  async function uploadLarge(
    token: string,
    path: string,
    bytes: ArrayBuffer,
    mode: ProviderWriteMode,
  ): Promise<GraphItem> {
    const sessionResponse = await graphFetch(token, `${GRAPH_BASE}${itemPath(fullPath(path))}/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': mode === 'add' ? 'fail' : 'replace',
        },
      }),
    })
    const session = (await sessionResponse.json()) as { uploadUrl: string }

    let offset = 0
    let lastItem: GraphItem | undefined
    while (offset < bytes.byteLength) {
      const chunk = bytes.slice(offset, offset + UPLOAD_CHUNK_SIZE_BYTES)
      const end = offset + chunk.byteLength
      // Upload-session PUTs are authorized by the session URL itself, not a bearer token, and
      // must not carry a conditional header — the conflict check already happened when the
      // session was created above.
      const response = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}`,
        },
        body: chunk,
      })
      if (!response.ok) await throwForErrorResponse(response)
      offset = end
      if (offset >= bytes.byteLength) lastItem = (await response.json()) as GraphItem
    }
    if (!lastItem) {
      // bytes.byteLength was 0 — an empty file never enters the loop above.
      const finalResponse = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': '0', 'Content-Range': 'bytes */0' },
      })
      if (!finalResponse.ok) await throwForErrorResponse(finalResponse)
      lastItem = (await finalResponse.json()) as GraphItem
    }
    return lastItem
  }

  return {
    id: 'onedrive',

    async getValidAccessToken() {
      const token = await auth.getValidAccessToken(config.clientId)
      if (!token) throw new ProviderReauthRequiredError('Not connected to OneDrive on this device.')
      return token
    },
    isConnected: () => auth.isConnected(),
    disconnect: () => auth.disconnect(),

    async listChanges(token, cursor) {
      try {
        try {
          const page = await fetchAllDeltaPages(token, cursor ?? initialDeltaUrl())
          return { ...page, isFromScratchListing: !cursor }
        } catch (error) {
          if (!cursor || !isResyncRequiredError(error)) throw error
          // The delta token is stale beyond recovery — local content is untouched either way,
          // only the delta baseline resets, so this just costs one full re-listing. Reported as
          // from-scratch too (see this interface's own doc comment) so cloudSync.ts's orphan
          // reconciliation still runs even though the *caller's* cursor argument wasn't undefined.
          const page = await fetchAllDeltaPages(token, initialDeltaUrl())
          return { ...page, isFromScratchListing: true }
        }
      } catch (error) {
        toProviderError(error)
      }
    },

    async download(token, path) {
      try {
        const response = await graphFetch(token, `${GRAPH_BASE}${itemPath(fullPath(path))}/content`)
        const bytes = await response.arrayBuffer()
        // Graph's /content response doesn't carry the item metadata (eTag/hash/size) in its own
        // headers the way Dropbox's download endpoint does — a cheap follow-up metadata read gets
        // the values applyEntry()/push() need to record.
        const metaResponse = await graphFetch(
          token,
          `${GRAPH_BASE}${itemPath(fullPath(path))}?$select=eTag,size,file`,
        )
        const item = (await metaResponse.json()) as GraphItem
        return {
          bytes,
          rev: item.eTag ?? '',
          contentHash: item.file?.hashes?.quickXorHash,
          sizeBytes: item.size ?? bytes.byteLength,
        }
      } catch (error) {
        toProviderError(error)
      }
    },

    async upload(token, path, bytes, mode) {
      try {
        const conditionalHeaders: Record<string, string> =
          mode === 'add' ? { 'If-None-Match': '*' } : { 'If-Match': mode.updateRev }
        let item: GraphItem
        if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT_BYTES) {
          const response = await graphFetch(token, `${GRAPH_BASE}${itemPath(fullPath(path))}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', ...conditionalHeaders },
            body: bytes,
          })
          item = await response.json()
        } else {
          item = await uploadLarge(token, path, bytes, mode)
        }
        return {
          rev: item.eTag ?? '',
          contentHash: item.file?.hashes?.quickXorHash,
          sizeBytes: item.size ?? bytes.byteLength,
        }
      } catch (error) {
        toProviderError(error)
      }
    },

    async deleteFile(token, path) {
      try {
        const response = await fetch(`${GRAPH_BASE}${itemPath(fullPath(path))}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        // Already gone (404) is a success from this caller's point of view, matching
        // providers/dropboxClient.ts's identical treatment of Dropbox's 409-already-gone case.
        if (!response.ok && response.status !== 404) await throwForErrorResponse(response)
      } catch (error) {
        toProviderError(error)
      }
    },
  }
}
