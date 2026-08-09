import { describe, expect, it } from 'vitest'
import { readJsonFile, writeTextFile } from '../fsaStorage'
import {
  detectConflicts,
  detectRecoveryIssues,
  quarantineDamagedFile,
  recoverFromBackup,
  resolveConflict,
} from '../sync'
import { createFakeRoot } from './fakeFsa'

function songJson(id: string, updatedAt: string, device: string, extra = ''): string {
  return `{"id":"${id}","title":"Great Are You Lord","updatedAt":"${updatedAt}","updatedByDevice":"${device}"${extra}}`
}

describe('detectConflicts', () => {
  it('detects a conflicted copy alongside its original', async () => {
    const root = createFakeRoot()
    await writeTextFile(root, 'songs/song-1.json', songJson('song-1', 'now', 'This Computer'))
    await writeTextFile(
      root,
      'songs/song-1 (Conflicted copy 2026-07-25).json',
      songJson('song-1', 'earlier', "Pastor's Mac"),
    )

    const conflicts = await detectConflicts(root)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'song',
      id: 'song-1',
      label: 'Great Are You Lord',
      otherDevice: "Pastor's Mac",
      otherUpdatedAt: 'earlier',
      conflictFilePath: 'songs/song-1 (Conflicted copy 2026-07-25).json',
    })
  })

  it('skips a conflicted copy whose original no longer exists', async () => {
    const root = createFakeRoot()
    await writeTextFile(
      root,
      'songs/song-1 (Conflicted copy 2026-07-25).json',
      songJson('song-1', 'earlier', "Pastor's Mac"),
    )

    expect(await detectConflicts(root)).toHaveLength(0)
  })

  it('scans each year subfolder under services', async () => {
    const root = createFakeRoot()
    await writeTextFile(root, 'services/2026/2026-08-09.json', songJson('svc-1', 'now', 'Device A'))
    await writeTextFile(
      root,
      'services/2026/2026-08-09 (Conflicted copy 2026-08-08).json',
      songJson('svc-1', 'earlier', 'Device B'),
    )

    const conflicts = await detectConflicts(root)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.kind).toBe('service')
  })
})

describe('resolveConflict', () => {
  it('keep "theirs" overwrites the original and removes the conflict artifact', async () => {
    const root = createFakeRoot()
    await writeTextFile(
      root,
      'songs/song-1.json',
      songJson('song-1', 'now', 'This Computer', ',"key":"C"'),
    )
    const conflictPath = 'songs/song-1 (Conflicted copy 2026-07-25).json'
    await writeTextFile(
      root,
      conflictPath,
      songJson('song-1', 'earlier', "Pastor's Mac", ',"key":"G"'),
    )

    await resolveConflict(root, conflictPath, 'theirs')

    expect(await readJsonFile(root, conflictPath)).toBeNull()
    const kept = await readJsonFile<{ key: string }>(root, 'songs/song-1.json')
    expect(kept?.key).toBe('G')
  })

  it('keep "mine" leaves the original untouched and still removes the conflict artifact', async () => {
    const root = createFakeRoot()
    await writeTextFile(
      root,
      'songs/song-1.json',
      songJson('song-1', 'now', 'This Computer', ',"key":"C"'),
    )
    const conflictPath = 'songs/song-1 (Conflicted copy 2026-07-25).json'
    await writeTextFile(
      root,
      conflictPath,
      songJson('song-1', 'earlier', "Pastor's Mac", ',"key":"G"'),
    )

    await resolveConflict(root, conflictPath, 'mine')

    expect(await readJsonFile(root, conflictPath)).toBeNull()
    const kept = await readJsonFile<{ key: string }>(root, 'songs/song-1.json')
    expect(kept?.key).toBe('C')
  })
})

describe('detectRecoveryIssues / recoverFromBackup', () => {
  it('identifies a damaged file and a verified backup, then recovers it', async () => {
    const root = createFakeRoot()
    await writeTextFile(root, 'songs/song-1.json', '{interrupted')
    await writeTextFile(
      root,
      'songs/song-1.json.backup',
      songJson('song-1', 'now', 'This Computer'),
    )

    const issues = await detectRecoveryIssues(root)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ relativePath: 'songs/song-1.json', backupAvailable: true })

    await recoverFromBackup(root, issues[0]!.filePath)
    expect(await detectRecoveryIssues(root)).toHaveLength(0)
  })

  it('reports backupAvailable: false when the backup is itself invalid', async () => {
    const root = createFakeRoot()
    await writeTextFile(root, 'songs/song-1.json', '{interrupted')
    await writeTextFile(root, 'songs/song-1.json.backup', '{also interrupted')

    const issues = await detectRecoveryIssues(root)
    expect(issues[0]?.backupAvailable).toBe(false)
    await expect(recoverFromBackup(root, 'songs/song-1.json')).rejects.toThrow()
  })

  it('does not flag a file whose JSON parses but is missing a required field, if it does not look record-like', async () => {
    // library-settings.json isn't in the record-like top-level list, so only "does it parse"
    // is checked, matching validateLibraryJson's generic fallback branch.
    const root = createFakeRoot()
    await writeTextFile(root, 'library-settings.json', '{"anything": true}')
    expect(await detectRecoveryIssues(root)).toHaveLength(0)
  })
})

describe('quarantineDamagedFile', () => {
  it('preserves the damaged bytes but removes them from the active library', async () => {
    const root = createFakeRoot()
    await writeTextFile(root, 'songs/song-1.json', '{interrupted')

    const destination = await quarantineDamagedFile(root, 'songs/song-1.json')

    expect(await readJsonFile(root, 'songs/song-1.json')).toBeNull()
    expect(destination).toMatch(/^songs\/song-1\.json\.damaged-\d{8}-\d{6}$/)
    expect(await detectRecoveryIssues(root)).toHaveLength(0)
  })
})

describe('path boundary enforcement', () => {
  it('rejects a non-JSON path', async () => {
    const root = createFakeRoot()
    await expect(recoverFromBackup(root, 'songs/song-1.txt')).rejects.toThrow()
    await expect(quarantineDamagedFile(root, 'songs/song-1.txt')).rejects.toThrow()
  })

  it('rejects a path containing ".."', async () => {
    const root = createFakeRoot()
    await expect(recoverFromBackup(root, '../outside.json')).rejects.toThrow()
  })
})
