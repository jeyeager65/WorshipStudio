import { describe, expect, it } from 'vitest'
import { SYNC_STALE_AFTER_MS, formatSyncAge, isSyncStale, syncAgeMs } from '@/utils/syncStaleness'

const NOW = Date.parse('2026-08-25T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString()
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString()

describe('syncAgeMs', () => {
  it('measures the gap since the last sync', () => {
    expect(syncAgeMs(hoursAgo(3), NOW)).toBe(3 * 60 * 60 * 1000)
  })

  it('is undefined when there is no usable timestamp', () => {
    expect(syncAgeMs(undefined, NOW)).toBeUndefined()
    expect(syncAgeMs('not a date', NOW)).toBeUndefined()
  })

  it('clamps a future timestamp to zero rather than reporting negative age', () => {
    // Two devices sharing one library can disagree on the clock.
    expect(syncAgeMs(hoursAgo(-5), NOW)).toBe(0)
  })
})

describe('isSyncStale', () => {
  it('is false for a recent sync and true past the threshold', () => {
    expect(isSyncStale(minutesAgo(5), NOW)).toBe(false)
    expect(isSyncStale(minutesAgo(29), NOW)).toBe(false)
    expect(isSyncStale(minutesAgo(31), NOW)).toBe(true)
    expect(isSyncStale(hoursAgo(1), NOW)).toBe(true)
    expect(isSyncStale(hoursAgo(48), NOW)).toBe(true)
  })

  it('leaves room for a missed interval, so healthy operation never trips it', () => {
    // useTabletSync syncs every 5 minutes; one or two skipped intervals must not warn, or the
    // indicator would flicker during ordinary use and stop meaning anything.
    expect(isSyncStale(minutesAgo(10), NOW)).toBe(false)
    expect(isSyncStale(minutesAgo(15), NOW)).toBe(false)
  })

  it('treats never-synced as stale — the least trustworthy state of all', () => {
    expect(isSyncStale(undefined, NOW)).toBe(true)
  })

  it('is exclusive at exactly the threshold', () => {
    const exactly = new Date(NOW - SYNC_STALE_AFTER_MS).toISOString()
    expect(isSyncStale(exactly, NOW)).toBe(false)
    expect(isSyncStale(new Date(NOW - SYNC_STALE_AFTER_MS - 1000).toISOString(), NOW)).toBe(true)
  })

  it('is scaled to the sync cadence, not to OneDrive’s 24h refresh cap', () => {
    // The cap bounds when a connection *must* fail; it says nothing about when silence is worth
    // reporting. Anchoring to it once put this at 12h — long enough to hide the overnight iPad
    // this exists to catch. Keep it a small multiple of useTabletSync's 5-minute interval.
    const SYNC_INTERVAL_MS = 5 * 60 * 1000
    expect(SYNC_STALE_AFTER_MS).toBeGreaterThanOrEqual(3 * SYNC_INTERVAL_MS)
    expect(SYNC_STALE_AFTER_MS).toBeLessThanOrEqual(12 * SYNC_INTERVAL_MS)
  })

  it('accepts a caller-supplied threshold', () => {
    expect(isSyncStale(hoursAgo(2), NOW, 60 * 60 * 1000)).toBe(true)
    expect(isSyncStale(hoursAgo(2), NOW, 5 * 60 * 60 * 1000)).toBe(false)
  })
})

describe('formatSyncAge', () => {
  it('describes the age in the largest sensible unit', () => {
    expect(formatSyncAge(new Date(NOW - 20_000).toISOString(), NOW)).toBe('just now')
    expect(formatSyncAge(new Date(NOW - 60_000).toISOString(), NOW)).toBe('1 minute ago')
    expect(formatSyncAge(new Date(NOW - 42 * 60_000).toISOString(), NOW)).toBe('42 minutes ago')
    expect(formatSyncAge(hoursAgo(1), NOW)).toBe('1 hour ago')
    expect(formatSyncAge(hoursAgo(13), NOW)).toBe('13 hours ago')
    expect(formatSyncAge(hoursAgo(24), NOW)).toBe('1 day ago')
    expect(formatSyncAge(hoursAgo(72), NOW)).toBe('3 days ago')
  })

  it('rounds down, so a unit never appears before it has fully elapsed', () => {
    expect(formatSyncAge(hoursAgo(23.9), NOW)).toBe('23 hours ago')
  })

  it('says so when it has never synced', () => {
    expect(formatSyncAge(undefined, NOW)).toBe('never synced')
  })
})
