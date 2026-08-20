import { describe, expect, it } from 'vitest'
import { computeSongUsage, quickRangeDates } from '@/utils/songUsageReport'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

function song(id: string, title: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title,
    collections: [],
    tags: [],
    blocks: [],
    defaultArrangement: { sequence: [] },
    usageDates: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

function service(id: string, date: string, type: string, songIds: string[]): Service {
  return {
    id,
    date,
    serviceTypeId: type,
    items: songIds.map((songId, i) => ({
      id: `item-${i}`,
      type: 'song' as const,
      songId,
      arrangement: { sequence: [] },
    })),
    updatedAt: '',
    updatedByDevice: '',
  }
}

describe('computeSongUsage', () => {
  const songs = [
    song('song-1', 'Great Are You Lord', { ccli: '7036939', author: 'Leonard, MacIntyre, Jordan' }),
    song('song-2', "Our Lord's Prayer", { author: 'Traditional' }),
  ]

  it('tallies uses per song within the date range', () => {
    const services = [
      service('svc-1', '2026-01-05', 'Sunday Morning Worship', ['song-1']),
      service('svc-2', '2026-01-12', 'Sunday Morning Worship', ['song-1', 'song-2']),
      service('svc-3', '2025-12-25', 'Sunday Morning Worship', ['song-1']), // out of range
    ]
    const summary = computeSongUsage(services, songs, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })
    expect(summary.totalUses).toBe(3)
    expect(summary.uniqueSongs).toBe(2)
    expect(summary.servicesIncluded).toBe(2)
    expect(summary.rows[0]).toMatchObject({
      songId: 'song-1',
      title: 'Great Are You Lord',
      timesUsed: 2,
    })
  })

  it('collects the actual dates a song was used, ascending', () => {
    const services = [
      service('svc-1', '2026-03-01', 'Sunday Morning Worship', ['song-1']),
      service('svc-2', '2026-01-12', 'Sunday Morning Worship', ['song-1']),
    ]
    const summary = computeSongUsage(services, songs, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })
    expect(summary.rows[0]).toMatchObject({
      songId: 'song-1',
      dates: ['2026-01-12', '2026-03-01'],
    })
  })

  it('excludes services outside the date range (inclusive boundaries)', () => {
    const services = [service('svc-1', '2026-01-01', 'Sunday Morning Worship', ['song-1'])]
    expect(
      computeSongUsage(services, songs, { fromDate: '2026-01-01', toDate: '2026-01-01' }).totalUses,
    ).toBe(1)
    expect(
      computeSongUsage(services, songs, { fromDate: '2026-01-02', toDate: '2026-01-31' }).totalUses,
    ).toBe(0)
  })

  it('filters by service type when given', () => {
    const services = [
      service('svc-1', '2026-01-05', 'Sunday Morning Worship', ['song-1']),
      service('svc-2', '2026-01-06', 'Wednesday Bible Study', ['song-2']),
    ]
    const summary = computeSongUsage(services, songs, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      serviceType: 'Sunday Morning Worship',
    })
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]?.songId).toBe('song-1')
  })

  it('ignores non-song service items', () => {
    const services: Service[] = [
      {
        id: 'svc-1',
        date: '2026-01-05',
        serviceTypeId: 'Sunday Morning Worship',
        items: [
          {
            id: 'item-1',
            type: 'scripture',
            reference: 'John 3:16',
            translation: 'ESV',
            displayMode: 'full',
          },
        ],
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const summary = computeSongUsage(services, songs, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })
    expect(summary.totalUses).toBe(0)
    expect(summary.servicesIncluded).toBe(0)
  })
})

describe('quickRangeDates', () => {
  it('computes year-to-date', () => {
    expect(quickRangeDates('ytd', new Date(2026, 6, 22))).toEqual({
      fromDate: '2026-01-01',
      toDate: '2026-07-22',
    })
  })

  it('computes last year as the full previous calendar year', () => {
    expect(quickRangeDates('last-year', new Date(2026, 6, 22))).toEqual({
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
    })
  })

  it('computes the current quarter start through today', () => {
    // July 22 falls in Q3 (Jul-Sep), which starts July 1.
    expect(quickRangeDates('quarter', new Date(2026, 6, 22))).toEqual({
      fromDate: '2026-07-01',
      toDate: '2026-07-22',
    })
  })
})
