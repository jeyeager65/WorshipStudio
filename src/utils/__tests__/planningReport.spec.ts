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
  const personNames = new Map([
    ['person-1', 'Marlene'],
    ['person-2', 'Jason'],
    ['person-3', 'Pastor Dan'],
  ])
  const roleGroups = [{ name: 'Praise Team', roles: ['Piano', 'Guitar'] }]

  it('lists rows sorted by date with song titles and roster resolved', () => {
    const services: Service[] = [
      service({
        id: 'svc-2',
        date: '2026-02-01',
        type: 'Sunday Morning Worship',
        items: [
          { id: 'i1', type: 'song', songId: 'song-2', arrangement: { sequence: [] } },
          {
            id: 'i2',
            type: 'sermon',
            title: 'Grace Abounds',
            role: 'Preacher',
            passages: [],
            mainPassageId: '',
            outline: [],
          },
        ],
        assignments: [
          { role: 'Piano', personId: 'person-1', tentative: false },
          { role: 'Guitar', personId: 'person-2', tentative: false },
          { role: 'Preacher', personId: 'person-3', tentative: false },
        ],
      }),
      service({
        id: 'svc-1',
        date: '2026-01-05',
        type: 'Sunday Morning Worship',
        items: [{ id: 'i1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
        assignments: [{ role: 'Guitar', personId: 'person-2', tentative: true }],
      }),
    ]

    const rows = buildPlanningReport(services, songs, personNames, roleGroups, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })

    expect(rows.map((r) => r.serviceId)).toEqual(['svc-1', 'svc-2'])
    expect(rows[0]).toMatchObject({
      songTitles: ['Great Are You Lord'],
      rosterGroups: [
        {
          category: 'Praise Team',
          assignments: [{ role: 'Guitar', person: 'Jason', tentative: true }],
        },
      ],
    })
    expect(rows[1]).toMatchObject({
      sermonTitle: 'Grace Abounds',
      preacher: 'Pastor Dan',
      songTitles: ["Our Lord's Prayer"],
      rosterGroups: [
        {
          category: 'Praise Team',
          assignments: [
            { role: 'Piano', person: 'Marlene', tentative: false },
            { role: 'Guitar', person: 'Jason', tentative: false },
          ],
        },
        {
          assignments: [{ role: 'Preacher', person: 'Pastor Dan', tentative: false }],
        },
      ],
    })
  })

  it('excludes services outside the date range (inclusive boundaries)', () => {
    const services = [service({ id: 'svc-1', date: '2026-01-01', type: 'Sunday Morning Worship' })]
    expect(
      buildPlanningReport(services, songs, personNames, roleGroups, {
        fromDate: '2026-01-01',
        toDate: '2026-01-01',
      }),
    ).toHaveLength(1)
    expect(
      buildPlanningReport(services, songs, personNames, roleGroups, {
        fromDate: '2026-01-02',
        toDate: '2026-01-31',
      }),
    ).toHaveLength(0)
  })

  it('filters by service type when given', () => {
    const services = [
      service({ id: 'svc-1', date: '2026-01-05', type: 'Sunday Morning Worship' }),
      service({ id: 'svc-2', date: '2026-01-06', type: 'Wednesday Bible Study' }),
    ]
    const rows = buildPlanningReport(services, songs, personNames, roleGroups, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      serviceType: 'Wednesday Bible Study',
    })
    expect(rows.map((r) => r.serviceId)).toEqual(['svc-2'])
  })

  it('omits an unassigned or empty roster/song list rather than erroring', () => {
    const services = [service({ id: 'svc-1', date: '2026-01-05', type: 'Sunday Morning Worship' })]
    const rows = buildPlanningReport(services, songs, personNames, roleGroups, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })
    expect(rows[0]).toMatchObject({ songTitles: [], rosterGroups: [] })
  })
})
