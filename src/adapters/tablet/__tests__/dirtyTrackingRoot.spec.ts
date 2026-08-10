import { describe, expect, it, vi } from 'vitest'
import { wrapWithDirtyTracking } from '../dirtyTrackingRoot'
import {
  joinPath,
  readFileText,
  readJsonFile,
  removeFile,
  writeJsonFile,
} from '@/adapters/web/fsaStorage'
import { createFakeRoot } from '@/adapters/web/__tests__/fakeFsa'

const { writeViaSyncAccessHandle } = vi.hoisted(() => ({ writeViaSyncAccessHandle: vi.fn() }))
vi.mock('@/adapters/web/opfsWriteFallback', () => ({ writeViaSyncAccessHandle }))

// Simulates WebKit, where the real handle has no createWritable at all — used to prove the
// wrapped createWritable trap detects this against the *real* target (not itself) and routes
// through fsaStorage.ts's writeFileHandleData fallback instead of throwing. See this codebase's
// own fsaStorage.spec.ts for the equivalent non-wrapped test (the Worker itself is stubbed out
// there too — see opfsWriteFallback.spec.ts for that piece).
function createFakeRootWithoutCreateWritable(): FileSystemDirectoryHandle {
  const fileHandle = { getFile: async () => new File([], 'stub') }
  const dir: Record<string, unknown> = {
    getFileHandle: async () => fileHandle,
  }
  dir.getDirectoryHandle = async () => dir
  return dir as unknown as FileSystemDirectoryHandle
}

describe('wrapWithDirtyTracking', () => {
  it('fires onChange with the relative path on a successful write', async () => {
    const onChange = vi.fn()
    const root = wrapWithDirtyTracking(createFakeRoot(), onChange)

    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1' })

    expect(onChange).toHaveBeenCalledWith('songs/song-1.json', 'write')
  })

  it('fires onChange with the relative path on a delete', async () => {
    const onChange = vi.fn()
    const fakeRoot = createFakeRoot()
    const root = wrapWithDirtyTracking(fakeRoot, onChange)
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1' })
    onChange.mockClear()

    await removeFile(root, 'songs/song-1.json')

    expect(onChange).toHaveBeenCalledWith('songs/song-1.json', 'remove')
  })

  it('reads never fire onChange', async () => {
    const onChange = vi.fn()
    const fakeRoot = createFakeRoot()
    await writeJsonFile(fakeRoot, 'songs/song-1.json', { id: 'song-1' })
    const root = wrapWithDirtyTracking(fakeRoot, onChange)

    await readJsonFile(root, 'songs/song-1.json')
    await readFileText(root, 'songs/song-1.json')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('tracks a nested path correctly through multiple directory levels', async () => {
    const onChange = vi.fn()
    const root = wrapWithDirtyTracking(createFakeRoot(), onChange)

    await writeJsonFile(root, joinPath('services', '2026', '2026-08-09.json'), { id: 's' })

    expect(onChange).toHaveBeenCalledWith('services/2026/2026-08-09.json', 'write')
  })

  it('a failed write (no create, missing parent) never fires onChange', async () => {
    const onChange = vi.fn()
    const root = wrapWithDirtyTracking(createFakeRoot(), onChange)

    await expect(readJsonFile(root, 'songs/missing.json')).resolves.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the wrapped root still behaves identically to the real one for reads/writes', async () => {
    const onChange = vi.fn()
    const root = wrapWithDirtyTracking(createFakeRoot(), onChange)

    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'A' })
    const record = await readJsonFile<{ title: string }>(root, 'songs/song-1.json')

    expect(record?.title).toBe('A')
  })

  it('falls back to the sync-access-handle worker (and still fires onChange) when the real handle has no createWritable', async () => {
    writeViaSyncAccessHandle.mockReset().mockResolvedValue(undefined)
    const onChange = vi.fn()
    const root = wrapWithDirtyTracking(createFakeRootWithoutCreateWritable(), onChange)

    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1' })

    expect(writeViaSyncAccessHandle).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('songs/song-1.json', 'write')
  })
})
