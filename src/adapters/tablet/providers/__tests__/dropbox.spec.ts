import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDropboxProvider } from '../dropbox'
import { ProviderApiError, ProviderReauthRequiredError } from '../types'
import { DropboxApiError, type DropboxEntry } from '../dropboxClient'

const { getValidAccessToken, isConnected, disconnect } = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  isConnected: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock('../dropboxAuth', () => ({ getValidAccessToken, isConnected, disconnect }))

const { listFolder, listFolderContinue, download, uploadFile, deleteFile } = vi.hoisted(() => ({
  listFolder: vi.fn(),
  listFolderContinue: vi.fn(),
  download: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}))
vi.mock('../dropboxClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dropboxClient')>()),
  listFolder,
  listFolderContinue,
  download,
  uploadFile,
  deleteFile,
}))

function fileEntry(overrides: Partial<DropboxEntry> & { name: string }): DropboxEntry {
  return {
    tag: 'file',
    pathLower: `/library/${overrides.name}`.toLowerCase(),
    pathDisplay: `/Library/${overrides.name}`,
    rev: 'rev-1',
    sizeBytes: 10,
    ...overrides,
  } as DropboxEntry
}

function deletedEntry(name: string): DropboxEntry {
  return {
    tag: 'deleted',
    name,
    pathLower: `/library/${name}`.toLowerCase(),
    pathDisplay: `/Library/${name}`,
  }
}

beforeEach(() => {
  getValidAccessToken.mockReset().mockResolvedValue('token-1')
  isConnected.mockReset()
  disconnect.mockReset()
  listFolder.mockReset()
  listFolderContinue.mockReset()
  download.mockReset()
  uploadFile.mockReset()
  deleteFile.mockReset()
})

function makeProvider(libraryFolderPath = '/Library') {
  return createDropboxProvider({ appKey: 'app-key-1', libraryFolderPath })
}

describe('getValidAccessToken', () => {
  it('throws ProviderReauthRequiredError when this device has no tokens', async () => {
    getValidAccessToken.mockResolvedValueOnce(undefined)
    await expect(makeProvider().getValidAccessToken()).rejects.toBeInstanceOf(ProviderReauthRequiredError)
  })

  it('returns the token from dropboxAuth otherwise', async () => {
    getValidAccessToken.mockResolvedValueOnce('a-real-token')
    await expect(makeProvider().getValidAccessToken()).resolves.toBe('a-real-token')
  })
})

describe('listChanges', () => {
  it('does a full recursive listFolder scoped to the library folder when there is no cursor', async () => {
    listFolder.mockResolvedValueOnce({
      entries: [fileEntry({ name: 'songs/song-1.json', rev: 'rev-1' })],
      cursor: 'cursor-1',
      hasMore: false,
    })

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(listFolder).toHaveBeenCalledWith('token-1', '/Library', { recursive: true })
    expect(result).toEqual({
      entries: [{ tag: 'file', path: 'songs/song-1.json', rev: 'rev-1', contentHash: undefined, sizeBytes: 10 }],
      cursor: 'cursor-1',
      isFromScratchListing: true,
    })
  })

  it('uses listFolderContinue with the given cursor, reporting it as an incremental (not from-scratch) listing', async () => {
    listFolderContinue.mockResolvedValueOnce({ entries: [], cursor: 'cursor-1', hasMore: false })

    const result = await makeProvider().listChanges('token-1', 'cursor-0')

    expect(listFolderContinue).toHaveBeenCalledWith('token-1', 'cursor-0')
    expect(listFolder).not.toHaveBeenCalled()
    expect(result.isFromScratchListing).toBe(false)
  })

  // isFromScratchListing must be true here even though a real cursor was passed in — this is
  // exactly the case cloudSync.ts's orphan reconciliation depends on being told about (a listing
  // that can't represent deletions since the last real cursor, despite not being the caller's
  // very first pull) — see providers/types.ts's own doc comment on that field.
  it('recovers from a stale cursor by re-listing from scratch, reporting it as a from-scratch listing', async () => {
    listFolderContinue.mockRejectedValueOnce(
      new DropboxApiError('reset', 409, { error: { '.tag': 'reset' } }),
    )
    listFolder.mockResolvedValueOnce({ entries: [], cursor: 'fresh-cursor', hasMore: false })

    const result = await makeProvider().listChanges('token-1', 'stale-cursor')

    expect(listFolder).toHaveBeenCalledWith('token-1', '/Library', { recursive: true })
    expect(result.cursor).toBe('fresh-cursor')
    expect(result.isFromScratchListing).toBe(true)
  })

  it('paginates through every page before returning, using the final cursor', async () => {
    listFolder.mockResolvedValueOnce({
      entries: [fileEntry({ name: 'songs/a.json', rev: 'rev-a' })],
      cursor: 'page-2',
      hasMore: true,
    })
    listFolderContinue.mockResolvedValueOnce({
      entries: [fileEntry({ name: 'songs/b.json', rev: 'rev-b' })],
      cursor: 'final-cursor',
      hasMore: false,
    })

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(listFolderContinue).toHaveBeenCalledWith('token-1', 'page-2')
    expect(result.entries.map((e) => e.path)).toEqual(['songs/a.json', 'songs/b.json'])
    expect(result.cursor).toBe('final-cursor')
  })

  it('drops folder entries and the library folder entry itself, keeping real-case relative paths', async () => {
    listFolder.mockResolvedValueOnce({
      entries: [
        { tag: 'folder', name: 'songs', pathLower: '/library/songs', pathDisplay: '/Library/Songs' },
        { tag: 'folder', name: 'Library', pathLower: '/library', pathDisplay: '/Library' },
        fileEntry({ name: 'Songs/Song One.json', rev: 'rev-1' }),
      ],
      cursor: 'c',
      hasMore: false,
    })

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(result.entries).toEqual([
      { tag: 'file', path: 'Songs/Song One.json', rev: 'rev-1', contentHash: undefined, sizeBytes: 10 },
    ])
  })

  it('maps a deleted entry to a ProviderEntry with tag "deleted"', async () => {
    listFolder.mockResolvedValueOnce({
      entries: [deletedEntry('songs/a.json')],
      cursor: 'c',
      hasMore: false,
    })

    const result = await makeProvider().listChanges('token-1', undefined)

    expect(result.entries).toEqual([{ tag: 'deleted', path: 'songs/a.json' }])
  })

  it('wraps a non-reset failure as a normalized ProviderApiError', async () => {
    listFolder.mockRejectedValueOnce(new DropboxApiError('rate limited', 429, {}, 30))

    const error: unknown = await makeProvider()
      .listChanges('token-1', undefined)
      .catch((e) => e)

    expect(error).toBeInstanceOf(ProviderApiError)
    expect((error as ProviderApiError).kind).toBe('rate-limit')
    expect((error as ProviderApiError).retryAfterSeconds).toBe(30)
  })
})

describe('download/upload/deleteFile', () => {
  it('prefixes the configured library folder path onto a relative path', async () => {
    download.mockResolvedValueOnce({
      bytes: new TextEncoder().encode('abc').buffer,
      entry: fileEntry({ name: 'media/photo.jpg', rev: 'rev-1' }),
    })

    const result = await makeProvider().download('token-1', 'media/photo.jpg')

    expect(download).toHaveBeenCalledWith('token-1', '/Library/media/photo.jpg')
    expect(result).toEqual({ bytes: expect.anything(), rev: 'rev-1', contentHash: undefined, sizeBytes: 10 })
  })

  it('uploads scoped to the library folder and returns the new rev', async () => {
    uploadFile.mockResolvedValueOnce(fileEntry({ name: 'songs/a.json', rev: 'rev-new', sizeBytes: 20 }))

    const result = await makeProvider().upload('token-1', 'songs/a.json', new ArrayBuffer(0), 'add')

    expect(uploadFile).toHaveBeenCalledWith('token-1', '/Library/songs/a.json', expect.anything(), 'add')
    expect(result).toEqual({ rev: 'rev-new', contentHash: undefined, sizeBytes: 20 })
  })

  it('normalizes a 409 conflict from an upload as ProviderApiError kind "conflict"', async () => {
    uploadFile.mockRejectedValueOnce(new DropboxApiError('conflict', 409, {}))

    await expect(
      makeProvider().upload('token-1', 'songs/a.json', new ArrayBuffer(0), 'add'),
    ).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('deletes scoped to the library folder', async () => {
    await makeProvider().deleteFile('token-1', 'songs/gone.json')
    expect(deleteFile).toHaveBeenCalledWith('token-1', '/Library/songs/gone.json')
  })

  it('treats an empty (root) library folder path as the account root', async () => {
    uploadFile.mockResolvedValueOnce(fileEntry({ name: 'songs/a.json', rev: 'rev-1' }))
    await makeProvider('').upload('token-1', 'songs/a.json', new ArrayBuffer(0), 'add')
    expect(uploadFile).toHaveBeenCalledWith('token-1', '/songs/a.json', expect.anything(), 'add')
  })
})
