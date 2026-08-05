import { describe, expect, it } from 'vitest'
import {
  effectiveStopDate,
  isEventDated,
  isVisibleOn,
  requiresExplicitStopDate,
  splitForBulletin,
} from '@/utils/announcementVisibility'
import type { Announcement } from '@/models/announcement'

function base(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'ann-1',
    text: 'Test announcement',
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('effectiveStopDate', () => {
  it('prefers an explicit showUntil over the event dates', () => {
    const a = base({ eventDate: '2026-06-07', showUntil: '2026-06-14' })
    expect(effectiveStopDate(a)).toBe('2026-06-14')
  })

  it('falls back to eventEndDate, then eventDate, when showUntil is unset', () => {
    expect(effectiveStopDate(base({ eventDate: '2026-06-07', eventEndDate: '2026-06-14' }))).toBe(
      '2026-06-14',
    )
    expect(effectiveStopDate(base({ eventDate: '2026-06-07' }))).toBe('2026-06-07')
  })

  it('is undefined when nothing gives it a stop date', () => {
    expect(effectiveStopDate(base())).toBeUndefined()
  })
})

describe('requiresExplicitStopDate', () => {
  it('is true only when there is no event date and no showUntil', () => {
    expect(requiresExplicitStopDate(base())).toBe(true)
    expect(requiresExplicitStopDate(base({ eventDate: '2026-06-07' }))).toBe(false)
    expect(requiresExplicitStopDate(base({ showUntil: '2026-06-28' }))).toBe(false)
  })
})

describe('isVisibleOn', () => {
  it('pattern 1 (event-dated): visible through the event date, gone the day after', () => {
    const a = base({ eventDate: '2026-06-07' })
    expect(isVisibleOn(a, '2026-06-06')).toBe(true)
    expect(isVisibleOn(a, '2026-06-07')).toBe(true)
    expect(isVisibleOn(a, '2026-06-08')).toBe(false)
  })

  it('pattern 1 with a date range: visible through eventEndDate', () => {
    const a = base({ eventDate: '2026-06-14', eventEndDate: '2026-06-18' })
    expect(isVisibleOn(a, '2026-06-17')).toBe(true)
    expect(isVisibleOn(a, '2026-06-18')).toBe(true)
    expect(isVisibleOn(a, '2026-06-19')).toBe(false)
  })

  it('pattern 2 (ongoing): hidden before showFrom, visible after, until showUntil', () => {
    const a = base({ showFrom: '2026-06-01', showUntil: '2026-06-28' })
    expect(isVisibleOn(a, '2026-05-31')).toBe(false)
    expect(isVisibleOn(a, '2026-06-01')).toBe(true)
    expect(isVisibleOn(a, '2026-06-28')).toBe(true)
    expect(isVisibleOn(a, '2026-06-29')).toBe(false)
  })

  it('pattern 2 with no showFrom is visible immediately, still bounded by showUntil', () => {
    const a = base({ showUntil: '2026-06-28' })
    expect(isVisibleOn(a, '2026-01-01')).toBe(true)
    expect(isVisibleOn(a, '2026-06-29')).toBe(false)
  })

  it('comparisons use the service date passed in, never wall-clock "today"', () => {
    // An event long past relative to *today* is still visible for a bulletin dated before it.
    const a = base({ eventDate: '2020-01-01' })
    expect(isVisibleOn(a, '2019-12-31')).toBe(true)
    expect(isVisibleOn(a, '2020-01-02')).toBe(false)
  })
})

describe('isEventDated', () => {
  it('is true only when eventDate is set', () => {
    expect(isEventDated(base({ eventDate: '2026-06-07' }))).toBe(true)
    expect(isEventDated(base())).toBe(false)
  })
})

describe('splitForBulletin', () => {
  it('routes event-dated entries to upcoming (sorted soonest-first) and the rest to general', () => {
    const announcements: Announcement[] = [
      base({ id: 'a', text: 'Later event', eventDate: '2026-06-14' }),
      base({ id: 'b', text: 'Standing notice', showUntil: '2026-06-28' }),
      base({ id: 'c', text: 'Sooner event', eventDate: '2026-06-07' }),
    ]
    const { upcoming, general } = splitForBulletin(announcements, '2026-06-01')
    expect(upcoming.map((a) => a.id)).toEqual(['c', 'a'])
    expect(general.map((a) => a.id)).toEqual(['b'])
  })

  it('excludes anything not visible on the given service date', () => {
    const announcements: Announcement[] = [
      base({ id: 'expired', eventDate: '2026-05-01' }),
      base({ id: 'not-yet', showFrom: '2026-07-01', showUntil: '2026-08-01' }),
      base({ id: 'active', eventDate: '2026-06-07' }),
    ]
    const { upcoming, general } = splitForBulletin(announcements, '2026-06-01')
    expect(upcoming.map((a) => a.id)).toEqual(['active'])
    expect(general).toEqual([])
  })
})
