import { describe, expect, it } from 'vitest'
import { backupPath, readFileText, readJsonFile, writeJsonFile } from '../fsaStorage'
import { createFakeRoot } from './fakeFsa'

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
