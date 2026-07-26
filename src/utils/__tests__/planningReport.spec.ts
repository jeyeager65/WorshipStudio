import { describe, expect, it } from 'vitest'
import { buildPlanningReport } from '@/utils/planningReport'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

function song(id: string, title: string): Song {
  return {
    id,
    title,
    collections: [],
    tags: [],
    blocks: [],
    defaultArrangement: { sequence: [] },
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
  }
}

function service(overrides: Partial<Service> & Pick<Service, 'id' | 'date' | 'type'>): Service {
  return {
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('buildPlanningReport', () => {
  const songs = [song('song-1', 'Great Are You Lord'), song('song-2', "Our Lord's Prayer")]
  const volunteerNames = new Map([
    ['vol-1', 'Marlene'],
    ['vol-2', 'Jason'],
  ])

  it('lists rows sorted by date with song titles and roster resolved', () => {
    const services: Service[] = [
      service({
        id: 'svc-2',
        date: '2026-02-01',
        type: 'Sunday Morning Worship',
        sermonTitle: 'Grace Abounds',
        preacher: 'Pastor Dan',
        items: [{ id: 'i1', type: 'song', songId: 'song-2', arrangement: { sequence: [] } }],
        volunteerRoster: [{ role: 'Piano', volunteerId: 'vol-1', tentative: false }],
      }),
      service({
        id: 'svc-1',
        date: '2026-01-05',
        type: 'Sunday Morning Worship',
        items: [{ id: 'i1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
        volunteerRoster: [{ role: 'Guitar', volunteerId: 'vol-2', tentative: true }],
      }),
    ]

    const rows = buildPlanningReport(services, songs, volunteerNames, { fromDate: '2026-01-01', toDate: '2026-12-31' })

    expect(rows.map((r) => r.serviceId)).toEqual(['svc-1', 'svc-2'])
    expect(rows[0]).toMatchObject({ songTitles: ['Great Are You Lord'], roster: ['Guitar — Jason?'] })
    expect(rows[1]).toMatchObject({
      sermonTitle: 'Grace Abounds',
      preacher: 'Pastor Dan',
      songTitles: ["Our Lord's Prayer"],
      roster: ['Piano — Marlene'],
    })
  })

  it('excludes services outside the date range (inclusive boundaries)', () => {
    const services = [service({ id: 'svc-1', date: '2026-01-01', type: 'Sunday Morning Worship' })]
    expect(buildPlanningReport(services, songs, volunteerNames, { fromDate: '2026-01-01', toDate: '2026-01-01' })).toHaveLength(1)
    expect(buildPlanningReport(services, songs, volunteerNames, { fromDate: '2026-01-02', toDate: '2026-01-31' })).toHaveLength(0)
  })

  it('filters by service type when given', () => {
    const services = [
      service({ id: 'svc-1', date: '2026-01-05', type: 'Sunday Morning Worship' }),
      service({ id: 'svc-2', date: '2026-01-06', type: 'Wednesday Bible Study' }),
    ]
    const rows = buildPlanningReport(services, songs, volunteerNames, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      serviceType: 'Wednesday Bible Study',
    })
    expect(rows.map((r) => r.serviceId)).toEqual(['svc-2'])
  })

  it('omits an unassigned or empty roster/song list rather than erroring', () => {
    const services = [service({ id: 'svc-1', date: '2026-01-05', type: 'Sunday Morning Worship' })]
    const rows = buildPlanningReport(services, songs, volunteerNames, { fromDate: '2026-01-01', toDate: '2026-12-31' })
    expect(rows[0]).toMatchObject({ songTitles: [], roster: [] })
  })
})
