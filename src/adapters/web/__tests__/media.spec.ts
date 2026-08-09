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

const { loadStoredLocalMediaHandle, storeLocalMediaHandle } = vi.hoisted(() => ({
  loadStoredLocalMediaHandle: vi.fn(),
  storeLocalMediaHandle: vi.fn(),
}))
vi.mock('../handlePersistence', () => ({ loadStoredLocalMediaHandle, storeLocalMediaHandle }))

import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'

beforeEach(() => {
  localStorage.clear()
  vi.mocked(pickFilesInBrowser).mockReset()
  loadStoredLocalMediaHandle.mockReset().mockResolvedValue(undefined)
  storeLocalMediaHandle.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makePort(root: FileSystemDirectoryHandle) {
  const settings = createWebSettingsPort(root)
  const themes = createWebThemesPort(root, settings)
  return createWebMediaPort(root, settings, themes)
}

/** Attaches a fake queryPermission so a fake root can stand in for a previously-granted handle
 *  (fakeFsa.ts's minimal stand-in has no permission API of its own, since fsaStorage.ts's own
 *  helpers never call it — only media.ts's local-media granting does). */
function withQueryPermission(
  root: FileSystemDirectoryHandle,
  state: PermissionState = 'granted',
): FileSystemDirectoryHandle {
  return Object.assign(root, { queryPermission: vi.fn().mockResolvedValue(state) })
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

  describe('getStagedPreviewUrl', () => {
    it('resolves a real blob URL for a staged file and caches it across repeat calls', async () => {
      const root = createFakeRoot()
      const port = makePort(root)
      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'a.jpg')])
      const [staged] = await port.pickFilesToImport()

      const url = await port.getStagedPreviewUrl(staged!.path)
      expect(url).toMatch(/^blob:/)
      expect(await port.getStagedPreviewUrl(staged!.path)).toBe(url)
    })

    it('resolves undefined for a path that was never staged', async () => {
      const root = createFakeRoot()
      const port = makePort(root)
      expect(await port.getStagedPreviewUrl('staged-does-not-exist')).toBeUndefined()
    })
  })

  describe("'local' media routes to its own granted folder", () => {
    it('prompts for a folder once, writes flat bytes there (not under media/), and persists the handle', async () => {
      const root = createFakeRoot()
      const localRoot = createFakeRoot()
      const showDirectoryPicker = vi.fn().mockResolvedValue(localRoot)
      vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
      const port = makePort(root)

      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['big'], 'clip.mp4')])
      const [staged] = await port.pickFilesToImport()
      const [created] = await port.commitImport([
        { path: staged!.path, filename: 'clip.mp4', title: 'Clip', tags: [], location: 'local' },
      ])

      expect(created?.location).toBe('local')
      expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: 'readwrite',
        id: 'worship-studio-local-media',
      })
      expect(storeLocalMediaHandle).toHaveBeenCalledWith(localRoot)
      expect(new TextDecoder().decode((await readBytes(localRoot, 'clip.mp4'))!)).toBe('big')
      expect(await readBytes(root, 'media/clip.mp4')).toBeNull()
      expect(await readBytes(localRoot, 'media/clip.mp4')).toBeNull()

      // A second local commit in the same session reuses the already-granted handle.
      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['more'], 'clip2.mp4')])
      const [staged2] = await port.pickFilesToImport()
      await port.commitImport([
        {
          path: staged2!.path,
          filename: 'clip2.mp4',
          title: 'Clip 2',
          tags: [],
          location: 'local',
        },
      ])
      expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
    })

    it('reuses a previously stored handle without prompting when permission is still granted', async () => {
      const root = createFakeRoot()
      const localRoot = withQueryPermission(createFakeRoot(), 'granted')
      loadStoredLocalMediaHandle.mockResolvedValue(localRoot)
      const showDirectoryPicker = vi.fn()
      vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
      const port = makePort(root)

      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'a.jpg')])
      const [staged] = await port.pickFilesToImport()
      await port.commitImport([
        { path: staged!.path, filename: 'a.jpg', title: 'A', tags: [], location: 'local' },
      ])

      expect(showDirectoryPicker).not.toHaveBeenCalled()
      expect(storeLocalMediaHandle).not.toHaveBeenCalled()
      expect(new TextDecoder().decode((await readBytes(localRoot, 'a.jpg'))!)).toBe('x')
    })

    it('getPreviewUrl returns undefined for a local item on a machine that never granted the folder', async () => {
      const root = createFakeRoot()
      const port = makePort(root)
      // Simulates a media-items record synced in from another device — the metadata exists, but
      // this machine never picked (or was never granted) that device's local media folder.
      await port.save({
        id: 'media-remote-local',
        filename: 'from-another-device.mp4',
        title: 'Remote clip',
        kind: 'video',
        tags: [],
        location: 'local',
        contentHash: 'abc',
        usage: { usesPastYear: 0 },
        updatedAt: '',
        updatedByDevice: '',
      })

      expect(await port.getPreviewUrl('media-remote-local')).toBeUndefined()
    })

    it('getPreviewUrl and delete both work against a granted local folder', async () => {
      const root = createFakeRoot()
      const localRoot = createFakeRoot()
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(localRoot))
      const port = makePort(root)

      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'a.jpg')])
      const [staged] = await port.pickFilesToImport()
      const [created] = await port.commitImport([
        { path: staged!.path, filename: 'a.jpg', title: 'A', tags: [], location: 'local' },
      ])

      const url = await port.getPreviewUrl(created!.id)
      expect(url).toMatch(/^blob:/)

      await port.delete(created!.id)
      expect(await readJsonFile(root, `media-items/${created!.id}.json`)).toBeNull()
      expect(await readBytes(localRoot, 'a.jpg')).toBeNull()
    })
  })

  describe('save moves the backing file when location changes', () => {
    it('moves a synced file into the local folder, prompting for it if not yet granted', async () => {
      const root = createFakeRoot()
      const localRoot = createFakeRoot()
      const showDirectoryPicker = vi.fn().mockResolvedValue(localRoot)
      vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
      const port = makePort(root)

      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['clip'], 'clip.mp4')])
      const [staged] = await port.pickFilesToImport()
      const [created] = await port.commitImport([
        { path: staged!.path, filename: 'clip.mp4', title: 'Clip', tags: [], location: 'synced' },
      ])
      expect(await readBytes(root, 'media/clip.mp4')).not.toBeNull()

      await port.save({ ...created!, location: 'local' })

      expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
      expect(new TextDecoder().decode((await readBytes(localRoot, 'clip.mp4'))!)).toBe('clip')
      expect(await readBytes(root, 'media/clip.mp4')).toBeNull()
      const record = await readJsonFile<MediaItem>(root, `media-items/${created!.id}.json`)
      expect(record?.location).toBe('local')
    })

    it('moves a local file back into the synced folder, deduping a filename collision', async () => {
      const root = createFakeRoot()
      const localRoot = createFakeRoot()
      vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(localRoot))
      const port = makePort(root)

      // An unrelated synced item already occupies the destination filename.
      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['existing'], 'bg.jpg')])
      const [existingStaged] = await port.pickFilesToImport()
      await port.commitImport([
        {
          path: existingStaged!.path,
          filename: 'bg.jpg',
          title: 'A',
          tags: [],
          location: 'synced',
        },
      ])

      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['moving'], 'bg.jpg')])
      const [movingStaged] = await port.pickFilesToImport()
      const [created] = await port.commitImport([
        { path: movingStaged!.path, filename: 'bg.jpg', title: 'B', tags: [], location: 'local' },
      ])

      await port.save({ ...created!, location: 'synced' })

      const record = await readJsonFile<MediaItem>(root, `media-items/${created!.id}.json`)
      expect(record?.filename).toBe('bg (2).jpg')
      expect(new TextDecoder().decode((await readBytes(root, 'media/bg (2).jpg'))!)).toBe('moving')
      expect(new TextDecoder().decode((await readBytes(root, 'media/bg.jpg'))!)).toBe('existing')
      expect(await readBytes(localRoot, 'bg.jpg')).toBeNull()
    })

    it('updates metadata without moving anything when a local source is not accessible', async () => {
      const root = createFakeRoot()
      const port = makePort(root)
      await port.save({
        id: 'media-remote-local',
        filename: 'from-another-device.mp4',
        title: 'Remote clip',
        kind: 'video',
        tags: [],
        location: 'local',
        contentHash: 'abc',
        usage: { usesPastYear: 0 },
        updatedAt: '',
        updatedByDevice: '',
      })

      await port.save({
        id: 'media-remote-local',
        filename: 'from-another-device.mp4',
        title: 'Remote clip',
        kind: 'video',
        tags: [],
        location: 'synced',
        contentHash: 'abc',
        usage: { usesPastYear: 0 },
        updatedAt: '',
        updatedByDevice: '',
      })

      const record = await readJsonFile<MediaItem>(root, 'media-items/media-remote-local.json')
      expect(record?.location).toBe('synced')
    })

    it('does not touch the file when location is unchanged', async () => {
      const root = createFakeRoot()
      const port = makePort(root)
      vi.mocked(pickFilesInBrowser).mockResolvedValueOnce([new File(['x'], 'a.jpg')])
      const [staged] = await port.pickFilesToImport()
      const [created] = await port.commitImport([
        { path: staged!.path, filename: 'a.jpg', title: 'A', tags: [], location: 'synced' },
      ])

      await port.save({ ...created!, title: 'Renamed' })

      expect(new TextDecoder().decode((await readBytes(root, 'media/a.jpg'))!)).toBe('x')
    })
  })
})
