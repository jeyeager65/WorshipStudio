import { describe, expect, it } from 'vitest'
import {
  affectedSongIds,
  applyServiceUsageChange,
  getLastUsedDate,
  getUsesInPastYear,
  isArchiveCandidate,
  songIdsInService,
} from '@/utils/songUsage'
import type { Song, SongUsageEntry } from '@/models/song'
import type { Service } from '@/models/service'

function song(usageDates: SongUsageEntry[]): Song {
  return {
    id: 'song-1',
    title: 'Amazing Grace',
    collections: [],
    tags: [],
    blocks: [],
    defaultArrangement: { sequence: [] },
    usageDates,
    updatedAt: '',
    updatedByDevice: '',
  }
}

function service(overrides: Partial<Service> & Pick<Service, 'id' | 'date'>): Service {
  return {
    serviceTypeId: 'type-sunday-morning-worship',
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('getLastUsedDate', () => {
  it('returns the most recent date on or before today', () => {
    const dates: SongUsageEntry[] = [
      { serviceId: 'svc-1', date: '2026-01-01' },
      { serviceId: 'svc-2', date: '2026-03-01' },
    ]
    expect(getLastUsedDate(dates, '2026-07-28')).toBe('2026-03-01')
  })

  it('excludes a future-dated entry — a planned service is not a use yet', () => {
    const dates: SongUsageEntry[] = [
      { serviceId: 'svc-1', date: '2024-01-01' },
      { serviceId: 'svc-2', date: '2099-01-01' },
    ]
    expect(getLastUsedDate(dates, '2026-07-28')).toBe('2024-01-01')
  })

  it('returns undefined for no entries', () => {
    expect(getLastUsedDate([], '2026-07-28')).toBeUndefined()
  })

  // A real production crash (not hypothetical): a song saved before usageDates existed has it
  // genuinely absent, not just empty, on the web/tablet ports — this must not throw.
  it('does not throw when dates is undefined, same as an empty array', () => {
    expect(getLastUsedDate(undefined, '2026-07-28')).toBeUndefined()
  })
})

describe('getUsesInPastYear', () => {
  it('counts only entries within the rolling 365-day window ending today', () => {
    const dates: SongUsageEntry[] = [
      { serviceId: 'svc-1', date: '2024-01-01' }, // well over a year before "today"
      { serviceId: 'svc-2', date: '2026-01-01' },
      { serviceId: 'svc-3', date: '2026-03-01' },
    ]
    expect(getUsesInPastYear(dates, '2026-07-28')).toBe(2)
  })

  it('excludes a future-dated entry', () => {
    const dates: SongUsageEntry[] = [{ serviceId: 'svc-1', date: '2099-01-01' }]
    expect(getUsesInPastYear(dates, '2026-07-28')).toBe(0)
  })

  it('does not throw when dates is undefined, same as an empty array', () => {
    expect(getUsesInPastYear(undefined, '2026-07-28')).toBe(0)
  })
})

describe('isArchiveCandidate', () => {
  it('is false with no usage history', () => {
    expect(isArchiveCandidate([], '2026-07-28')).toBe(false)
  })

  it('is false for a song used well within the 548-day window', () => {
    const dates: SongUsageEntry[] = [{ serviceId: 'svc-1', date: '2026-06-01' }]
    expect(isArchiveCandidate(dates, '2026-07-28')).toBe(false)
  })

  it('is true once the most recent use is more than 548 days in the past', () => {
    const dates: SongUsageEntry[] = [{ serviceId: 'svc-1', date: '2024-01-01' }]
    expect(isArchiveCandidate(dates, '2026-07-28')).toBe(true)
  })

  it('does not throw when dates is undefined, same as an empty array', () => {
    expect(isArchiveCandidate(undefined, '2026-07-28')).toBe(false)
  })
})

describe('songIdsInService', () => {
  it('deduplicates a song reprised twice in the same service', () => {
    const svc = service({
      id: 'svc-1',
      date: '2026-01-01',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
        { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      ],
    })
    expect(songIdsInService(svc)).toEqual(new Set(['song-1']))
  })

  it('ignores non-song items', () => {
    const svc = service({
      id: 'svc-1',
      date: '2026-01-01',
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'John 3:16',
          translation: 'ESV',
          displayMode: 'full',
        },
      ],
    })
    expect(songIdsInService(svc)).toEqual(new Set())
  })
})

describe('affectedSongIds', () => {
  it('unions songs from both the old and new versions of a service', () => {
    const oldService = service({
      id: 'svc-1',
      date: '2026-01-01',
      items: [{ id: 'item-1', type: 'song', songId: 'song-a', arrangement: { sequence: [] } }],
    })
    const newService = service({
      id: 'svc-1',
      date: '2026-01-08',
      items: [{ id: 'item-1', type: 'song', songId: 'song-b', arrangement: { sequence: [] } }],
    })
    expect(affectedSongIds(oldService, newService)).toEqual(new Set(['song-a', 'song-b']))
  })

  it('is just the old service songs when the new service is undefined (a deletion)', () => {
    const oldService = service({
      id: 'svc-1',
      date: '2026-01-01',
      items: [{ id: 'item-1', type: 'song', songId: 'song-a', arrangement: { sequence: [] } }],
    })
    expect(affectedSongIds(oldService, undefined)).toEqual(new Set(['song-a']))
  })
})

describe('applyServiceUsageChange', () => {
  it('adds a new entry for a song newly referencing a service', () => {
    const updated = applyServiceUsageChange(song([]), 'svc-1', '2026-03-01')
    expect(updated?.usageDates).toEqual([{ serviceId: 'svc-1', date: '2026-03-01' }])
  })

  it('updates an existing entry in place rather than duplicating it when the date changes', () => {
    const original = song([{ serviceId: 'svc-1', date: '2026-03-01' }])
    const updated = applyServiceUsageChange(original, 'svc-1', '2026-03-08')
    expect(updated?.usageDates).toEqual([{ serviceId: 'svc-1', date: '2026-03-08' }])
  })

  it('removes the entry when the song no longer references the service', () => {
    const original = song([{ serviceId: 'svc-1', date: '2026-03-01' }])
    const updated = applyServiceUsageChange(original, 'svc-1', undefined)
    expect(updated?.usageDates).toEqual([])
  })

  it('returns undefined (no-op) when nothing actually changed', () => {
    const original = song([{ serviceId: 'svc-1', date: '2026-03-01' }])
    expect(applyServiceUsageChange(original, 'svc-1', '2026-03-01')).toBeUndefined()
    expect(applyServiceUsageChange(song([]), 'svc-1', undefined)).toBeUndefined()
  })

  it('stores a future-dated entry without filtering it — the write side is date-agnostic', () => {
    const updated = applyServiceUsageChange(song([]), 'svc-1', '2099-01-01')
    expect(updated?.usageDates).toEqual([{ serviceId: 'svc-1', date: '2099-01-01' }])
  })
})
