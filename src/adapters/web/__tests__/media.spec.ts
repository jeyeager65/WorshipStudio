import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@/models/library'
import { createWebMediaPort } from '../media'
import { createWebSettingsPort } from '../settings'
import { createWebThemesPort } from '../themes'
import { readBytes, readJsonFile } from '../fsaStorage'
import { createFakeRoot } from './fakeFsa'

vi.mock('@/adapters/mock/pickFiles', () => ({
  pickFilesInBrowser: vi.fn(),
}))

import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'

beforeEach(() => {
  localStorage.clear()
  vi.mocked(pickFilesInBrowser).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makePort(root: FileSystemDirectoryHandle) {
  const settings = createWebSettingsPort(root)
  const themes = createWebThemesPort(root, settings)
  return createWebMediaPort(root, settings, themes)
}

describe('createWebMediaPort', () => {
  it('pickFilesToImport stages files with real size/kind and flags a content-hash duplicate', async () => {
    const root = createFakeRoot()
    const port = makePort(root)

    // Commit an existing item first so the second pick can be recognized as its duplicate.
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([
      new File(['same bytes'], 'first.jpg', { type: 'image/jpeg' }),
    ])
    const [staged1] = await port.pickFilesToImport()
    await port.commitImport([
      {
        path: staged1!.path,
        filename: 'first.jpg',
        title: 'First',
        tags: [],
        location: 'synced',
      },
    ])

    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([
      new File(['same bytes'], 'copy.jpg', { type: 'image/jpeg' }),
      new File(['different'], 'unique.mp4', { type: 'video/mp4' }),
    ])
    const staged = await port.pickFilesToImport()

    expect(staged).toHaveLength(2)
    expect(staged[0]?.sizeBytes).toBe(new Blob(['same bytes']).size)
    expect(staged[0]?.kind).toBe('image')
    expect(staged[0]?.duplicateOfFilename).toBe('first.jpg')
    expect(staged[1]?.kind).toBe('video')
    expect(staged[1]?.duplicateOfId).toBeUndefined()
  })

  it('commitImport writes real bytes and creates a media-items record', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([
      new File(['pixels'], 'sunset.jpg', { type: 'image/jpeg' }),
    ])
    const [staged] = await port.pickFilesToImport()

    const [created] = await port.commitImport([
      {
        path: staged!.path,
        filename: 'sunset.jpg',
        title: 'Sunset',
        description: 'Over the hills',
        tags: ['Worship'],
        location: 'synced',
      },
    ])

    expect(created?.filename).toBe('sunset.jpg')
    expect(created?.title).toBe('Sunset')
    const bytes = await readBytes(root, 'media/sunset.jpg')
    expect(new TextDecoder().decode(bytes!)).toBe('pixels')
    const record = await readJsonFile<MediaItem>(root, `media-items/${created!.id}.json`)
    expect(record?.contentHash).toBe(created!.contentHash)
  })

  it('commitImport dedupes a destination filename collision with a "(2)" suffix', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['a'], 'bg.jpg')])
    const [first] = await port.pickFilesToImport()
    await port.commitImport([
      { path: first!.path, filename: 'bg.jpg', title: 'A', tags: [], location: 'synced' },
    ])

    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['b'], 'bg.jpg')])
    const [second] = await port.pickFilesToImport()
    const [createdSecond] = await port.commitImport([
      { path: second!.path, filename: 'bg.jpg', title: 'B', tags: [], location: 'synced' },
    ])

    expect(createdSecond?.filename).toBe('bg (2).jpg')
  })

  it('detectDuplicates matches by content hash, excluding itself', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['same'], 'a.jpg')])
    const [a] = await port.commitImport([
      {
        path: (await port.pickFilesToImport())[0]!.path,
        filename: 'a.jpg',
        title: 'A',
        tags: [],
        location: 'synced',
      },
    ])
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['same'], 'b.jpg')])
    await port.commitImport([
      {
        path: (await port.pickFilesToImport())[0]!.path,
        filename: 'b.jpg',
        title: 'B',
        tags: [],
        location: 'synced',
      },
    ])

    const duplicates = await port.detectDuplicates(a!)
    expect(duplicates.map((d) => d.id)).toEqual(
      expect.arrayContaining(duplicates.length ? [duplicates[0]!.id] : []),
    )
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.filename).toBe('b.jpg')
  })

  it('delete removes both the record and the underlying file', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'gone.jpg')])
    const [staged] = await port.pickFilesToImport()
    const [created] = await port.commitImport([
      { path: staged!.path, filename: 'gone.jpg', title: 'Gone', tags: [], location: 'synced' },
    ])

    await port.delete(created!.id)
    expect(await readJsonFile(root, `media-items/${created!.id}.json`)).toBeNull()
    expect(await readBytes(root, 'media/gone.jpg')).toBeNull()
  })

  it('getPreviewUrl returns a real blob URL for an existing item and undefined for a missing one', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'a.jpg')])
    const [staged] = await port.pickFilesToImport()
    const [created] = await port.commitImport([
      { path: staged!.path, filename: 'a.jpg', title: 'A', tags: [], location: 'synced' },
    ])

    const url = await port.getPreviewUrl(created!.id)
    expect(url).toMatch(/^blob:/)
    expect(await port.getPreviewUrl('does-not-exist')).toBeUndefined()
  })

  it('importStockBackgrounds fetches bundled assets, writes real bytes, and is idempotent', async () => {
    const root = createFakeRoot()
    const port = makePort(root)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('stock pixels').buffer,
      }),
    )

    const first = await port.importStockBackgrounds()
    expect(first.mediaAdded).toBe(6)
    expect(first.themesAdded).toBe(2)

    const second = await port.importStockBackgrounds()
    expect(second.mediaAdded).toBe(0)
    expect(second.themesAdded).toBe(0)

    const media = await port.list()
    expect(media).toHaveLength(6)
  })
})
