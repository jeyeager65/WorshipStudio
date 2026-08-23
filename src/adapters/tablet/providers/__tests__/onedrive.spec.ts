import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOneDriveProvider } from '../onedrive'
import { ProviderApiError, ProviderReauthRequiredError } from '../types'

const { getValidAccessToken, isConnected, disconnect } = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  isConnected: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock('../onedriveAuth', () => ({ getValidAccessToken, isConnected, disconnect }))

// jsdom (this project's vitest environment) has no real IndexedDB, so onedriveIdMap.ts's own
// real implementation can't run here — an in-memory stand-in, same reasoning/pattern as
// cloudSync.spec.ts's fake syncStore.
const idMapEntries = vi.hoisted(() => new Map<string, string>())
vi.mock('../onedriveIdMap', () => ({
  getPathForId: async (id: string) => idMapEntries.get(id),
  setPathForId: async (id: string, path: string) => {
    idMapEntries.set(id, path)
  },
  deletePathForId: async (id: string) => {
    idMapEntries.delete(id)
  },
}))

const fetchMock = vi.fn()

beforeEach(() => {
  getValidAccessToken.mockReset().mockResolvedValue('token-1')
  isConnected.mockReset()
  disconnect.mockReset()
  fetchMock.mockReset()
  idMapEntries.clear()
  vi.stubGlobal('fetch', fetchMock)
})

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    ok: (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: new Headers(init?.headers ?? {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as Response
}

function makeProvider(libraryFolderPath = 'Library') {
  return createOneDriveProvider({ clientId: 'client-1', libraryFolderPath })
}

describe('getValidAccessToken', () => {
  it('throws ProviderReauthRequiredError when this device has no tokens', async () => {
    getValidAccessToken.mockResolvedValueOnce(undefined)
    await expect(makeProvider().getValidAccessToken()).rejects.toBeInstanceOf(ProviderReauthRequiredError)
  })

  it('returns the token from onedriveAuth otherwise', async () => {
    getValidAccessToken.mockResolvedValueOnce('a-real-token')
    await expect(makeProvider().getValidAccessToken()).resolves.toBe('a-real-token')
  })
})

describe('listChanges', () => {
  it('does an initial delta call scoped to the library folder when there is no cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            name: 'song-1.json',
            parentReference: { path: '/drive/root:/Library/songs' },
            file: { hashes: { quickXorHash: 'hash-1' } },
            eTag: 'etag-1',
            size: 10,
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=final',
      }),
    )

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library:/delta',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }),
    )
    expect(result).toEqual({
      entries: [
        { tag: 'file', path: 'songs/song-1.json', rev: 'etag-1', contentHash: 'hash-1', sizeBytes: 10 },
      ],
      cursor: 'https://graph.microsoft.com/v1.0/delta?token=final',
      isFromScratchListing: true,
    })
  })

  it('GETs the given cursor URL directly on a later sync, reporting it as an incremental (not from-scratch) listing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=next' }),
    )

    const result = await makeProvider().listChanges('token-1', 'https://graph.microsoft.com/v1.0/delta?token=prev')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/delta?token=prev',
      expect.anything(),
    )
    expect(result.isFromScratchListing).toBe(false)
  })

  it('follows nextLink pagination until a deltaLink terminates it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ name: 'a.json', parentReference: { path: '/drive/root:/Library' }, eTag: 'a', size: 1 }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ name: 'b.json', parentReference: { path: '/drive/root:/Library' }, eTag: 'b', size: 1 }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=final',
        }),
      )

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://graph.microsoft.com/v1.0/page2', expect.anything())
    expect(result.entries.map((e) => e.path)).toEqual(['a.json', 'b.json'])
    expect(result.cursor).toBe('https://graph.microsoft.com/v1.0/delta?token=final')
  })

  // isFromScratchListing must be true here even though a real cursor was passed in — this is
  // exactly the case cloudSync.ts's orphan reconciliation depends on being told about (a listing
  // that can't represent deletions since the last real cursor, despite not being the caller's
  // very first pull) — see providers/types.ts's own doc comment on that field.
  it('recovers from a resync-required (410) by restarting a fresh full delta, reporting it as a from-scratch listing', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'resyncRequired' } }, { status: 410 }))
      .mockResolvedValueOnce(
        jsonResponse({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=fresh' }),
      )

    const result = await makeProvider().listChanges('token-1', 'https://graph.microsoft.com/v1.0/delta?token=stale')

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library:/delta',
      expect.anything(),
    )
    expect(result.cursor).toBe('https://graph.microsoft.com/v1.0/delta?token=fresh')
    expect(result.isFromScratchListing).toBe(true)
  })

  it('drops folder entries and items outside the configured library folder', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [
          { name: 'songs', parentReference: { path: '/drive/root:/Library' }, folder: {} },
          { name: 'Library', parentReference: { path: '/drive/root:' }, folder: {} },
          { name: 'other.json', parentReference: { path: '/drive/root:/SomewhereElse' }, eTag: 'x', size: 1 },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=final',
      }),
    )

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(result.entries).toEqual([])
  })

  it('maps a deleted item to a ProviderEntry with tag "deleted"', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [{ name: 'a.json', parentReference: { path: '/drive/root:/Library' }, deleted: { state: 'deleted' } }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=final',
      }),
    )

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(result.entries).toEqual([{ tag: 'deleted', path: 'a.json' }])
  })

  it('records a live item\'s id -> path, then resolves a later deletion that reports only that id', async () => {
    const provider = makeProvider()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            id: 'item-1',
            name: 'a.json',
            parentReference: { path: '/drive/root:/Library/songs' },
            eTag: 'etag-1',
            size: 5,
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=page1',
      }),
    )
    await provider.listChanges('token-1', undefined)

    // Real Graph behavior for a deletion: only `id` is guaranteed -- parentReference/name are
    // absent here, unlike the fully-described deletion in the test above.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [{ id: 'item-1', deleted: { state: 'deleted' } }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=page2',
      }),
    )
    const result = await provider.listChanges(
      'token-1',
      'https://graph.microsoft.com/v1.0/delta?token=page1',
    )

    expect(result.entries).toEqual([{ tag: 'deleted', path: 'songs/a.json' }])
  })

  it('drops a deletion it has never seen the id for and cannot otherwise resolve a path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [{ id: 'never-seen', deleted: { state: 'deleted' } }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=final',
      }),
    )

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(result.entries).toEqual([])
  })

  it('normalizes a 429 as ProviderApiError kind "rate-limit"', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '30' } }),
    )

    const error: unknown = await makeProvider()
      .listChanges('token-1', undefined)
      .catch((e) => e)

    expect(error).toBeInstanceOf(ProviderApiError)
    expect((error as ProviderApiError).kind).toBe('rate-limit')
    expect((error as ProviderApiError).retryAfterSeconds).toBe(30)
  })
})

describe('download', () => {
  it('fetches content then a metadata follow-up, scoped to the library folder', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new TextEncoder().encode('abc').buffer,
      })
      .mockResolvedValueOnce(jsonResponse({ eTag: 'etag-1', size: 3, file: { hashes: { quickXorHash: 'h1' } } }))

    const result = await makeProvider().download('token-1', 'songs/a.json')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library/songs/a.json:/content',
      expect.anything(),
    )
    expect(result).toEqual({
      bytes: expect.anything(),
      rev: 'etag-1',
      contentHash: 'h1',
      sizeBytes: 3,
    })
  })
})

describe('upload', () => {
  it('uses If-None-Match for mode "add"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ eTag: 'etag-new', size: 5 }))

    await makeProvider().upload('token-1', 'songs/a.json', new ArrayBuffer(5), 'add')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library/songs/a.json:/content',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-None-Match': '*' }),
      }),
    )
  })

  it('uses If-Match with the given rev for a conditional update', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ eTag: 'etag-new', size: 5 }))

    await makeProvider().upload('token-1', 'songs/a.json', new ArrayBuffer(5), { updateRev: 'etag-old' })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'If-Match': 'etag-old' }) }),
    )
  })

  it('normalizes a 412 conditional-check failure as ProviderApiError kind "conflict"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'etag mismatch' } }, { status: 412 }))

    await expect(
      makeProvider().upload('token-1', 'songs/a.json', new ArrayBuffer(5), { updateRev: 'etag-old' }),
    ).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('routes large files through an upload session, chunked', async () => {
    const bigBytes = new ArrayBuffer(5 * 1024 * 1024) // above the 4MB simple-upload limit
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ uploadUrl: 'https://upload.example/session-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ eTag: 'etag-final', size: bigBytes.byteLength, file: { hashes: {} } }),
      )

    const result = await makeProvider().upload('token-1', 'media/big.mp4', bigBytes, 'add')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library/media/big.mp4:/createUploadSession',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://upload.example/session-1',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(result.rev).toBe('etag-final')
  })
})

describe('deleteFile', () => {
  it('sends a DELETE scoped to the library folder', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() })

    await makeProvider().deleteFile('token-1', 'songs/gone.json')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/drive/root:/Library/songs/gone.json:',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('treats an already-gone (404) delete as success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
    await expect(makeProvider().deleteFile('token-1', 'songs/gone.json')).resolves.toBeUndefined()
  })
})

describe('isConnected / disconnect', () => {
  it('delegates to onedriveAuth', async () => {
    isConnected.mockResolvedValueOnce(true)
    await expect(makeProvider().isConnected()).resolves.toBe(true)
    await makeProvider().disconnect()
    expect(disconnect).toHaveBeenCalled()
  })
})
