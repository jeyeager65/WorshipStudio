import { describe, expect, it } from 'vitest'
import { formatSyncProgressLabel } from '../syncProgress'

describe('formatSyncProgressLabel', () => {
  it('returns an empty string when there is no progress', () => {
    expect(formatSyncProgressLabel(undefined)).toBe('')
  })

  it('returns an empty string for an empty batch', () => {
    expect(formatSyncProgressLabel({ phase: 'pull', completed: 0, total: 0 })).toBe('')
  })

  it('puts the total count before the kind, not after — an earlier "kind — count" phrasing read as a count of that kind', () => {
    const label = formatSyncProgressLabel({
      phase: 'pull',
      completed: 2,
      total: 745,
      currentPath: 'songs/song-3.json',
    })
    expect(label).toBe('Downloading 3 of 745 — songs')
  })

  it('labels a push as "Uploading"', () => {
    const label = formatSyncProgressLabel({
      phase: 'push',
      completed: 0,
      total: 4,
      currentPath: 'services/2026/2026-08-09.json',
    })
    expect(label).toBe('Uploading 1 of 4 — services')
  })

  it('falls back to "files" for a path outside the known top-level content folders', () => {
    const label = formatSyncProgressLabel({
      phase: 'pull',
      completed: 0,
      total: 1,
      currentPath: 'library-settings.json',
    })
    expect(label).toBe('Downloading 1 of 1 — files')
  })

  it('never shows a position past the total, even mid-tick before the counter catches up', () => {
    const label = formatSyncProgressLabel({ phase: 'pull', completed: 5, total: 5 })
    expect(label).toBe('Downloading 5 of 5 — files')
  })
})
