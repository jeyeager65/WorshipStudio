import { describe, expect, it, vi } from 'vitest'
import { backupPath, readFileText, readJsonFile, writeBytes, writeJsonFile, writeTextFile } from '../fsaStorage'
import { createFakeRoot } from './fakeFsa'

const { writeViaSyncAccessHandle } = vi.hoisted(() => ({ writeViaSyncAccessHandle: vi.fn() }))
vi.mock('../opfsWriteFallback', () => ({ writeViaSyncAccessHandle }))

describe('writeJsonFile backup-on-write', () => {
  it('does not create a .backup on the first write of a new file', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'A' })
    expect(await readFileText(root, backupPath('songs/song-1.json'))).toBeNull()
  })

  it('backs up the previous version before overwriting on a second write', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'First' })
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'Second' })

    const current = await readJsonFile<{ title: string }>(root, 'songs/song-1.json')
    const backup = await readJsonFile<{ title: string }>(root, backupPath('songs/song-1.json'))
    expect(current?.title).toBe('Second')
    expect(backup?.title).toBe('First')
  })

  it('never overwrites a good backup with a corrupt "previous version"', async () => {
    const root = createFakeRoot()
    // First write: no previous file, so no backup yet. Second write: *this* is what actually
    // establishes the backup, containing "Good backup" (the first write's content).
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'Good backup' })
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'Then corrupted' })
    // Simulate external corruption of the primary file (e.g. a bad sync) without going through
    // writeJsonFile — the next writeJsonFile call must not let this garbage clobber the backup.
    const dir = await root.getDirectoryHandle('songs')
    const fileHandle = await dir.getFileHandle('song-1.json', { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write('{corrupt')
    await writable.close()

    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'Recovered' })

    const backup = await readJsonFile<{ title: string }>(root, backupPath('songs/song-1.json'))
    expect(backup?.title).toBe('Good backup')
  })

  it('a failed serialization touches nothing on disk', async () => {
    const root = createFakeRoot()
    await writeJsonFile(root, 'songs/song-1.json', { id: 'song-1', title: 'Untouched' })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(writeJsonFile(root, 'songs/song-1.json', circular)).rejects.toThrow()

    const current = await readJsonFile<{ title: string }>(root, 'songs/song-1.json')
    expect(current?.title).toBe('Untouched')
    expect(await readFileText(root, backupPath('songs/song-1.json'))).toBeNull()
  })
})

// WebKit (Safari/iOS) doesn't implement FileSystemFileHandle.createWritable() at all — these
// simulate that by handing back a file handle missing the method entirely, same as what a real
// WebKit OPFS handle looks like, rather than trying to run a real Worker in jsdom (which has no
// Worker implementation to run one in anyway — see opfsWriteFallback.spec.ts for that piece).
function createFakeRootWithoutCreateWritable(): FileSystemDirectoryHandle {
  const fileHandle = { getFile: async () => new File([], 'stub') }
  const dir: Record<string, unknown> = {
    getFileHandle: async () => fileHandle,
  }
  dir.getDirectoryHandle = async () => dir
  return dir as unknown as FileSystemDirectoryHandle
}

describe('falling back to the sync-access-handle worker when createWritable is unavailable', () => {
  it('writeTextFile encodes the string to bytes and routes through the fallback', async () => {
    writeViaSyncAccessHandle.mockReset().mockResolvedValue(undefined)
    const root = createFakeRootWithoutCreateWritable()

    await writeTextFile(root, 'songs/song-1.json', 'hello')

    expect(writeViaSyncAccessHandle).toHaveBeenCalledTimes(1)
    const [, bytes] = writeViaSyncAccessHandle.mock.calls[0]!
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('writeBytes passes an ArrayBuffer straight through to the fallback', async () => {
    writeViaSyncAccessHandle.mockReset().mockResolvedValue(undefined)
    const root = createFakeRootWithoutCreateWritable()
    const bytes = new TextEncoder().encode('raw bytes').buffer as ArrayBuffer

    await writeBytes(root, 'media/photo.jpg', bytes)

    expect(writeViaSyncAccessHandle).toHaveBeenCalledWith(expect.anything(), bytes)
  })

  it('writeBytes converts a Blob to an ArrayBuffer before handing it to the fallback', async () => {
    writeViaSyncAccessHandle.mockReset().mockResolvedValue(undefined)
    const root = createFakeRootWithoutCreateWritable()

    await writeBytes(root, 'media/photo.jpg', new Blob(['blob content']))

    const [, bytes] = writeViaSyncAccessHandle.mock.calls[0]!
    expect(new TextDecoder().decode(bytes)).toBe('blob content')
  })
})
