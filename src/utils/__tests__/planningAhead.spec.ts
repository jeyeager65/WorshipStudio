import { describe, expect, it } from 'vitest'
import { groupUpcomingByMonth, hasStarted, needsPreacher } from '@/utils/planningAhead'
import type { Service } from '@/models/service'

function service(overrides: Partial<Service> & Pick<Service, 'id' | 'date' | 'type'>): Service {
  return {
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('groupUpcomingByMonth', () => {
  it('excludes past services and groups the rest by calendar month, sorted within each', () => {
    const services: Service[] = [
      service({ id: 'past', date: '2026-01-01', type: 'Sunday Morning Worship' }),
      service({ id: 'feb-2', date: '2026-02-15', type: 'Sunday Morning Worship' }),
      service({ id: 'feb-1', date: '2026-02-08', type: 'Sunday Morning Worship' }),
      service({ id: 'mar-1', date: '2026-03-01', type: 'Sunday Morning Worship' }),
    ]

    const months = groupUpcomingByMonth(services, '2026-02-01')

    expect(months.map((m) => m.monthKey)).toEqual(['2026-02', '2026-03'])
    expect(months[0]!.services.map((s) => s.id)).toEqual(['feb-1', 'feb-2'])
    expect(months[0]!.monthLabel).toBe('February 2026')
  })

  it('includes a service dated exactly today', () => {
    const services = [service({ id: 'today', date: '2026-02-01', type: 'Sunday Morning Worship' })]
    expect(groupUpcomingByMonth(services, '2026-02-01')).toHaveLength(1)
  })
})

describe('needsPreacher', () => {
  it('flags a missing preacher', () => {
    expect(needsPreacher(service({ id: '1', date: '2026-01-01', type: 'x' }))).toBe(true)
    expect(
      needsPreacher(
        service({
          id: '1',
          date: '2026-01-01',
          type: 'x',
          items: [{ id: 'item-sermon', type: 'sermon', role: 'Preacher', passages: [], mainPassageId: '', outline: [] }],
          assignments: [{ role: 'Preacher', personId: 'person-daniel-renno', tentative: false }],
        }),
      ),
    ).toBe(false)
  })
})

describe('hasStarted', () => {
  it('reports whether any items have been added', () => {
    expect(hasStarted(service({ id: '1', date: '2026-01-01', type: 'x' }))).toBe(false)
    expect(
      hasStarted(
        service({
          id: '1',
          date: '2026-01-01',
          type: 'x',
          items: [{ id: 'i1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
        }),
      ),
    ).toBe(true)
  })
})
