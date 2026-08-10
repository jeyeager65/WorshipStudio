import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteFile, download, getMetadata, listFolder, listFolderContinue, upload } from '../dropboxClient'

function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number; headers?: Record<string, string> },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: '',
    headers: new Headers(init?.headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listFolder', () => {
  it('requests the RPC endpoint with the expected body and auth header, normalizing entries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            '.tag': 'file',
            name: 'song-1.json',
            path_lower: '/library/songs/song-1.json',
            path_display: '/Library/songs/song-1.json',
            rev: 'abc123',
            content_hash: 'hash1',
            size: 42,
          },
        ],
        cursor: 'cursor-1',
        has_more: false,
      }),
    )

    const result = await listFolder('token-1', '/Library', { recursive: true })

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.dropboxapi.com/2/files/list_folder')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init!.body as string)).toEqual({
      path: '/Library',
      recursive: true,
      include_deleted: true,
    })
    expect(result).toEqual({
      entries: [
        {
          tag: 'file',
          name: 'song-1.json',
          pathLower: '/library/songs/song-1.json',
          pathDisplay: '/Library/songs/song-1.json',
          rev: 'abc123',
          contentHash: 'hash1',
          sizeBytes: 42,
        },
      ],
      cursor: 'cursor-1',
      hasMore: false,
    })
  })
})

describe('listFolderContinue', () => {
  it('throws a DropboxApiError carrying the parsed reset error body on a 409', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error_summary: 'reset/...', error: { '.tag': 'reset' } },
        { ok: false, status: 409 },
      ),
    )

    await expect(listFolderContinue('token-1', 'stale-cursor')).rejects.toMatchObject({
      status: 409,
      body: { error: { '.tag': 'reset' } },
    })
  })
})

describe('error handling', () => {
  it('captures Retry-After on a 429', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error_summary: 'too_many_requests/...' },
        { ok: false, status: 429, headers: { 'Retry-After': '30' } },
      ),
    )

    await expect(listFolder('token-1', '')).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    })
  })

  it('getMetadata resolves undefined (not a thrown error) for a 409 not-found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 409 }))
    await expect(getMetadata('token-1', '/missing.json')).resolves.toBeUndefined()
  })

  it('deleteFile treats a 409 (already gone) as success, not an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 409 }))
    await expect(deleteFile('token-1', '/gone.json')).resolves.toBeUndefined()
  })
})

describe('download', () => {
  it('sends the path via the Dropbox-API-Arg header and returns bytes plus metadata', async () => {
    const bytes = new TextEncoder().encode('hello').buffer
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Dropbox-API-Result': JSON.stringify({
          '.tag': 'file',
          name: 'a.jpg',
          path_lower: '/library/media/a.jpg',
          path_display: '/Library/media/a.jpg',
          rev: 'rev-1',
          size: 5,
        }),
      }),
      arrayBuffer: async () => bytes,
    } as unknown as Response)

    const result = await download('token-1', '/library/media/a.jpg')

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://content.dropboxapi.com/2/files/download')
    const arg = JSON.parse((init!.headers as Record<string, string>)['Dropbox-API-Arg']!)
    expect(arg).toEqual({ path: '/library/media/a.jpg' })
    expect(new TextDecoder().decode(result.bytes)).toBe('hello')
    expect(result.entry.rev).toBe('rev-1')
  })
})

describe('upload', () => {
  it('escapes non-ASCII characters in the Dropbox-API-Arg header and uses strict_conflict', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        '.tag': 'file',
        name: 'résumé.txt',
        path_lower: '/library/résumé.txt',
        path_display: '/Library/résumé.txt',
        rev: 'rev-2',
        size: 3,
      }),
    )

    await upload('token-1', '/Library/résumé.txt', new TextEncoder().encode('abc').buffer, {
      updateRev: 'rev-1',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const argHeader = (init!.headers as Record<string, string>)['Dropbox-API-Arg']!
    expect(/^[\x00-\x7f]*$/.test(argHeader)).toBe(true)
    const arg = JSON.parse(argHeader.replace(/\\u([0-9a-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))))
    expect(arg).toEqual({
      path: '/Library/résumé.txt',
      mode: { '.tag': 'update', update: 'rev-1' },
      autorename: false,
      mute: true,
      strict_conflict: true,
    })
  })
})
