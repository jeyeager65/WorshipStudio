/**
 * A pure Dropbox API v2 REST wrapper — every function takes an access token as a plain argument
 * rather than resolving/refreshing one itself (that's dropboxAuth.ts's job), which is what makes
 * this trivially mockable in tests (mocked `fetch`, same pattern as adapters/web/scripture.ts's
 * ESV/api.bible calls) independent of the token lifecycle.
 *
 * Token revocation lives in dropboxAuth.ts instead of here — it's tightly coupled to that
 * module's own disconnect flow (revoke, then immediately clear local token storage), not a file
 * operation like everything else in this file.
 */

// Dropbox paths are case-insensitive (path_lower is what all comparisons/prefix-matching should
// use) but OPFS is case-sensitive — pathDisplay (original case) is what actually has to be
// written locally, or a file whose real name has capitals would land in OPFS under the wrong
// name entirely.
export interface DropboxFileEntry {
  tag: 'file'
  name: string
  pathLower: string
  pathDisplay: string
  rev: string
  contentHash?: string
  sizeBytes: number
}

export interface DropboxFolderEntry {
  tag: 'folder'
  name: string
  pathLower: string
  pathDisplay: string
}

export interface DropboxDeletedEntry {
  tag: 'deleted'
  name: string
  pathLower: string
  pathDisplay: string
}

export type DropboxEntry = DropboxFileEntry | DropboxFolderEntry | DropboxDeletedEntry

export interface ListFolderResult {
  entries: DropboxEntry[]
  cursor: string
  hasMore: boolean
}

export type DropboxWriteMode = 'add' | { updateRev: string }

/** Thrown for every non-2xx Dropbox response. `status` and `body` let callers branch on the
 *  specific failure (429 rate limit with `retryAfterSeconds`, 409 conflict/cursor-reset with a
 *  parsed error body) without every caller re-implementing response parsing. */
export class DropboxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'DropboxApiError'
  }
}

const RPC_BASE = 'https://api.dropboxapi.com/2/files'
const CONTENT_BASE = 'https://content.dropboxapi.com/2/files'

// Dropbox-API-Arg is an HTTP header, and the Fetch API only allows ASCII/Latin-1 bytes in header
// values — Dropbox's own content-endpoint docs call this out explicitly and recommend escaping
// any non-ASCII character in the JSON as a literal \uXXXX sequence instead of sending it raw,
// since a church's song/media titles routinely contain characters (accents, etc.) outside plain
// ASCII. JSON.stringify itself does not escape these by default.
function apiArgHeader(value: unknown): string {
  return JSON.stringify(value).replace(
    /[-￿]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  )
}

function toApiEntry(raw: Record<string, unknown>): DropboxEntry {
  const tag = (raw['.tag'] as string) ?? 'file'
  const name = raw.name as string
  const pathLower = raw.path_lower as string
  const pathDisplay = (raw.path_display as string | undefined) ?? pathLower
  if (tag === 'folder') return { tag: 'folder', name, pathLower, pathDisplay }
  if (tag === 'deleted') return { tag: 'deleted', name, pathLower, pathDisplay }
  return {
    tag: 'file',
    name,
    pathLower,
    pathDisplay,
    rev: raw.rev as string,
    contentHash: typeof raw.content_hash === 'string' ? raw.content_hash : undefined,
    sizeBytes: raw.size as number,
  }
}

async function throwForErrorResponse(response: Response): Promise<never> {
  const retryAfterHeader = response.headers.get('Retry-After')
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = await response.text().catch(() => undefined)
  }
  const summary =
    body && typeof body === 'object' && 'error_summary' in body
      ? String((body as { error_summary: unknown }).error_summary)
      : response.statusText
  throw new DropboxApiError(
    `Dropbox request failed (${response.status}): ${summary}`,
    response.status,
    body,
    retryAfterSeconds,
  )
}

async function rpcCall<T>(token: string, endpoint: string, args: unknown): Promise<T> {
  const response = await fetch(`${RPC_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!response.ok) await throwForErrorResponse(response)
  return response.json()
}

function toListFolderResult(body: {
  entries: Record<string, unknown>[]
  cursor: string
  has_more: boolean
}): ListFolderResult {
  return {
    entries: body.entries.map(toApiEntry),
    cursor: body.cursor,
    hasMore: body.has_more,
  }
}

export async function listFolder(
  token: string,
  path: string,
  options?: { recursive?: boolean },
): Promise<ListFolderResult> {
  const body = await rpcCall<{
    entries: Record<string, unknown>[]
    cursor: string
    has_more: boolean
  }>(token, 'list_folder', {
    path,
    recursive: options?.recursive ?? false,
    include_deleted: true,
  })
  return toListFolderResult(body)
}

/** Throws DropboxApiError with status 409 and a `list_folder/continue/error/reset`-shaped body
 *  when the cursor is stale — callers should treat that as "start over with a fresh listFolder",
 *  not a fatal error. */
export async function listFolderContinue(token: string, cursor: string): Promise<ListFolderResult> {
  const body = await rpcCall<{
    entries: Record<string, unknown>[]
    cursor: string
    has_more: boolean
  }>(token, 'list_folder/continue', { cursor })
  return toListFolderResult(body)
}

export async function getMetadata(
  token: string,
  path: string,
): Promise<DropboxFileEntry | undefined> {
  try {
    const raw = await rpcCall<Record<string, unknown>>(token, 'get_metadata', { path })
    const entry = toApiEntry(raw)
    return entry.tag === 'file' ? entry : undefined
  } catch (error) {
    if (error instanceof DropboxApiError && error.status === 409) return undefined
    throw error
  }
}

export async function deleteFile(token: string, path: string): Promise<void> {
  try {
    await rpcCall(token, 'delete_v2', { path })
  } catch (error) {
    // Already gone is a success from this caller's point of view, not a real failure.
    if (error instanceof DropboxApiError && error.status === 409) return
    throw error
  }
}

export async function download(
  token: string,
  path: string,
): Promise<{ bytes: ArrayBuffer; entry: DropboxFileEntry }> {
  const response = await fetch(`${CONTENT_BASE}/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': apiArgHeader({ path }),
    },
  })
  if (!response.ok) await throwForErrorResponse(response)
  const resultHeader = response.headers.get('Dropbox-API-Result')
  const metadata = resultHeader ? (JSON.parse(resultHeader) as Record<string, unknown>) : {}
  const bytes = await response.arrayBuffer()
  const entry = toApiEntry(metadata)
  if (entry.tag !== 'file') throw new Error('Dropbox download response was not a file entry')
  return { bytes, entry }
}

function writeModeArg(mode: DropboxWriteMode): unknown {
  return typeof mode === 'string' ? mode : { '.tag': 'update', update: mode.updateRev }
}

// Dropbox's single-request upload endpoint caps out at 150MB — comfortably above anything this
// app's media library realistically holds, but the chunked session API below exists for the
// rare oversized video that exceeds it.
const SINGLE_REQUEST_UPLOAD_LIMIT_BYTES = 150 * 1024 * 1024
const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024

export async function upload(
  token: string,
  path: string,
  bytes: ArrayBuffer,
  mode: DropboxWriteMode,
): Promise<DropboxFileEntry> {
  const response = await fetch(`${CONTENT_BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArgHeader({
        path,
        mode: writeModeArg(mode),
        autorename: false,
        mute: true,
        // Without this, a concurrent write can sometimes succeed via Dropbox's own "safe merge"
        // heuristic even when revs differ — this design needs a rev mismatch to always fail loudly
        // so it can materialize a conflict artifact, never silently pick a winner on its own.
        strict_conflict: true,
      }),
    },
    body: bytes,
  })
  if (!response.ok) await throwForErrorResponse(response)
  const entry = toApiEntry(await response.json())
  if (entry.tag !== 'file') throw new Error('Dropbox upload response was not a file entry')
  return entry
}

interface UploadSessionCursor {
  sessionId: string
  offset: number
}

export async function uploadSessionStart(token: string, firstChunk: ArrayBuffer): Promise<string> {
  const response = await fetch(`${CONTENT_BASE}/upload_session/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArgHeader({ close: false }),
    },
    body: firstChunk,
  })
  if (!response.ok) await throwForErrorResponse(response)
  const body = (await response.json()) as { session_id: string }
  return body.session_id
}

export async function uploadSessionAppend(
  token: string,
  cursor: UploadSessionCursor,
  chunk: ArrayBuffer,
): Promise<void> {
  const response = await fetch(`${CONTENT_BASE}/upload_session/append_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArgHeader({
        cursor: { session_id: cursor.sessionId, offset: cursor.offset },
        close: false,
      }),
    },
    body: chunk,
  })
  if (!response.ok) await throwForErrorResponse(response)
}

export async function uploadSessionFinish(
  token: string,
  cursor: UploadSessionCursor,
  path: string,
  mode: DropboxWriteMode,
): Promise<DropboxFileEntry> {
  const response = await fetch(`${CONTENT_BASE}/upload_session/finish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArgHeader({
        cursor: { session_id: cursor.sessionId, offset: cursor.offset },
        commit: { path, mode: writeModeArg(mode), autorename: false, strict_conflict: true },
      }),
    },
  })
  if (!response.ok) await throwForErrorResponse(response)
  const entry = toApiEntry(await response.json())
  if (entry.tag !== 'file') throw new Error('Dropbox upload session response was not a file entry')
  return entry
}

/** Picks the single-request path for anything under Dropbox's own limit, and the chunked
 *  upload-session flow (start/append.../finish) otherwise — cloudSync.ts never needs to know
 *  which one actually ran. */
export async function uploadFile(
  token: string,
  path: string,
  bytes: ArrayBuffer,
  mode: DropboxWriteMode,
): Promise<DropboxFileEntry> {
  if (bytes.byteLength <= SINGLE_REQUEST_UPLOAD_LIMIT_BYTES) {
    return upload(token, path, bytes, mode)
  }
  const firstChunk = bytes.slice(0, UPLOAD_CHUNK_SIZE_BYTES)
  const sessionId = await uploadSessionStart(token, firstChunk)
  let offset = firstChunk.byteLength
  while (offset < bytes.byteLength) {
    const chunk = bytes.slice(offset, offset + UPLOAD_CHUNK_SIZE_BYTES)
    const isLast = offset + chunk.byteLength >= bytes.byteLength
    if (isLast) {
      return uploadSessionFinish(token, { sessionId, offset }, path, mode)
    }
    await uploadSessionAppend(token, { sessionId, offset }, chunk)
    offset += chunk.byteLength
  }
  // bytes.byteLength was 0 — an empty file never enters the loop above.
  return uploadSessionFinish(token, { sessionId, offset }, path, mode)
}
