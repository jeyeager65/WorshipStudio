import { describe, expect, it } from 'vitest'
import { buildBulletinPage2, findNextWeekService } from '@/utils/bulletinPage2'
import type { Service } from '@/models/service'
import type { Announcement } from '@/models/announcement'
import type { BulletinSettings } from '@/models/settings'

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    date: '2026-06-07',
    serviceTypeId: 'Sunday Morning Worship',
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

// "Hope Happenings" here is deliberately a church's own custom title, not this code's name for
// the concept (see buildBulletinPage2's own doc comment) — proves the title is genuinely
// read from settings, not assumed.
const bulletinDefaults: BulletinSettings = {
  page1: {
    title: 'Order of Worship',
    footer: { title: 'Heart Preparation', enabled: true },
  },
  page2: {
    enabled: true,
    title: 'Hope Happenings',
    footer: { title: 'Thought to Ponder', enabled: true },
    announcements: { enabled: true },
    servingSchedule: { enabled: true, roleIds: ['role-nursery', 'role-greeters'] },
  },
}

describe('findNextWeekService', () => {
  const current = service({ id: 'this-week', date: '2026-06-07', serviceTypeId: 'Sunday Morning Worship' })

  it('finds the same-type service dated exactly 7 days later', () => {
    const nextWeek = service({
      id: 'next-week',
      date: '2026-06-14',
      serviceTypeId: 'Sunday Morning Worship',
    })
    expect(findNextWeekService([current, nextWeek], current)?.id).toBe('next-week')
  })

  it('ignores a different service type on the same +7 date', () => {
    const eveningService = service({ id: 'evening', date: '2026-06-14', serviceTypeId: 'Evening Service' })
    expect(findNextWeekService([current, eveningService], current)).toBeUndefined()
  })

  it('ignores the same type on a different date (not just "whatever comes next")', () => {
    const midweek = service({ id: 'midweek', date: '2026-06-10', serviceTypeId: 'Sunday Morning Worship' })
    expect(findNextWeekService([current, midweek], current)).toBeUndefined()
  })

  it('correctly crosses a month/year boundary regardless of local timezone', () => {
    // Regression check for a real bug: computing +7 days via toISOString() can land on the
    // wrong calendar day in timezones ahead of UTC (see calendarDate.ts). date-math to
    // localCalendarDate instead, so this must land on Jan 4, 2027, not Jan 3 or Jan 5.
    const yearEnd = service({ id: 'year-end', date: '2026-12-28', serviceTypeId: 'Sunday Morning Worship' })
    const nextYear = service({
      id: 'next-year',
      date: '2027-01-04',
      serviceTypeId: 'Sunday Morning Worship',
    })
    expect(findNextWeekService([yearEnd, nextYear], yearEnd)?.id).toBe('next-year')
  })

  it('returns undefined when next week has not been created yet', () => {
    expect(findNextWeekService([current], current)).toBeUndefined()
  })
})

describe('buildBulletinPage2', () => {
  const personNames = new Map([
    ['p-rob', 'Rob Pappas'],
    ['p-anne', 'Anne Pappas'],
    ['p-suzie', 'Suzie Nestico'],
  ])
  // Deliberately distinct from the ids themselves (role-nursery -> "Nursery") — a regression
  // check for a real bug: BulletinView.vue used to call buildBulletinPage2 without this map at
  // all, so every row silently printed the raw RoleDefinition id instead of its name.
  const roleNames = new Map([
    ['role-nursery', 'Nursery'],
    ['role-greeters', 'Greeters'],
  ])

  it('uses the configured page2 title', () => {
    const doc = buildBulletinPage2(service(), undefined, [], bulletinDefaults, personNames)
    expect(doc.title).toBe('Hope Happenings')
  })

  it('splits announcements into upcoming/general and formats a short upcoming range', () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: 'Church picnic',
        eventDate: '2026-06-14',
        eventEndDate: '2026-06-18',
        eventTime: '1-6pm',
        updatedAt: '',
        updatedByDevice: '',
      },
      {
        id: 'a2',
        text: 'Standing notice',
        showUntil: '2026-12-31',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-06-01' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([{ dateLabel: 'June 14–June 18 1-6pm', text: 'Church picnic' }])
    expect(doc.general).toEqual([{ text: 'Standing notice' }])
  })

  it('formats a window longer than a week as "Starting <date>" instead of a full range', () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: 'VBS registration open',
        eventDate: '2026-08-24',
        eventEndDate: '2026-09-30',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-08-01' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([
      { dateLabel: 'Starting August 24', text: 'VBS registration open' },
    ])
  })

  it('a range of exactly 7 days still prints as a range, not "Starting"', () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: 'VBS week',
        eventDate: '2026-06-14',
        eventEndDate: '2026-06-21',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-06-01' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([{ dateLabel: 'June 14–June 21', text: 'VBS week' }])
  })

  it("includes the year when the event falls outside the bulletin service's own year", () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: "New Year's Eve Service",
        eventDate: '2027-01-01',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-12-27' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([{ dateLabel: 'January 1, 2027', text: "New Year's Eve Service" }])
  })

  it("omits the year (both ends) for a range fully within the bulletin service's own year", () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: 'Church picnic',
        eventDate: '2026-06-14',
        eventEndDate: '2026-06-18',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-06-01' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([{ dateLabel: 'June 14–June 18', text: 'Church picnic' }])
  })

  it('includes the year on just the end date when a range crosses into a new year', () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        text: "New Year's retreat",
        eventDate: '2026-12-30',
        eventEndDate: '2027-01-02',
        updatedAt: '',
        updatedByDevice: '',
      },
    ]
    const doc = buildBulletinPage2(
      service({ date: '2026-12-27' }),
      undefined,
      announcements,
      bulletinDefaults,
      personNames,
    )
    expect(doc.upcoming).toEqual([
      { dateLabel: 'December 30–January 2, 2027', text: "New Year's retreat" },
    ])
  })

  it('omits announcements entirely when page2.announcements.enabled is off', () => {
    const announcements: Announcement[] = [
      { id: 'a1', text: 'x', eventDate: '2026-06-07', updatedAt: '', updatedByDevice: '' },
    ]
    const doc = buildBulletinPage2(
      service(),
      undefined,
      announcements,
      {
        ...bulletinDefaults,
        page2: { ...bulletinDefaults.page2, announcements: { enabled: false } },
      },
      personNames,
    )
    expect(doc.upcoming).toEqual([])
    expect(doc.general).toEqual([])
  })

  it('pivots this-week and next-week assignments by configured individual role', () => {
    const thisWeek = service({
      date: '2026-06-07',
      assignments: [
        { roleId: 'role-nursery', personId: 'p-suzie', tentative: false },
        { roleId: 'role-greeters', personId: 'p-rob', tentative: false },
        { roleId: 'role-greeters', personId: 'p-anne', tentative: false },
        { roleId: 'role-guitar', personId: 'p-rob', tentative: false }, // not a configured column
      ],
    })
    const nextWeek = service({
      id: 'svc-2',
      date: '2026-06-14',
      assignments: [{ roleId: 'role-nursery', personId: 'p-rob', tentative: false }],
    })
    const doc = buildBulletinPage2(thisWeek, nextWeek, [], bulletinDefaults, personNames, roleNames)
    expect(doc.servingSchedule).toEqual({
      headers: ['Role', 'This Week', 'Next Week'],
      rows: [
        { role: 'Nursery', thisWeek: ['Suzie Nestico'], nextWeek: ['Rob Pappas'] },
        { role: 'Greeters', thisWeek: ['Rob Pappas', 'Anne Pappas'], nextWeek: ['TBD'] },
      ],
    })
  })

  it('shows "TBD" (not an error, not blank) when a role has no one assigned yet', () => {
    const thisWeek = service({
      assignments: [{ roleId: 'role-nursery', personId: 'p-suzie', tentative: false }],
    })
    const doc = buildBulletinPage2(thisWeek, undefined, [], bulletinDefaults, personNames, roleNames)
    expect(doc.servingSchedule?.rows).toEqual([
      { role: 'Nursery', thisWeek: ['Suzie Nestico'], nextWeek: ['TBD'] },
      { role: 'Greeters', thisWeek: ['TBD'], nextWeek: ['TBD'] },
    ])
  })

  it('falls back to the raw id when a configured role has no matching RoleDefinition', () => {
    const thisWeek = service({ assignments: [] })
    const doc = buildBulletinPage2(
      thisWeek,
      undefined,
      [],
      bulletinDefaults,
      personNames,
      new Map(), // no role definitions at all — every id is unresolvable
    )
    expect(doc.servingSchedule?.rows.map((row) => row.role)).toEqual([
      'role-nursery',
      'role-greeters',
    ])
  })

  it('omits the serving schedule entirely when page2.servingSchedule.enabled is off', () => {
    const doc = buildBulletinPage2(
      service(),
      undefined,
      [],
      {
        ...bulletinDefaults,
        page2: {
          ...bulletinDefaults.page2,
          servingSchedule: { ...bulletinDefaults.page2.servingSchedule, enabled: false },
        },
      },
      personNames,
    )
    expect(doc.servingSchedule).toBeUndefined()
  })

  it('includes the page2 footer only when enabled and the service has text for it', () => {
    const withFooter = buildBulletinPage2(
      service({ bulletinPage2Footer: 'Grace upon grace.' }),
      undefined,
      [],
      bulletinDefaults,
      personNames,
    )
    expect(withFooter.footer).toEqual({ title: 'Thought to Ponder', text: 'Grace upon grace.' })

    const noText = buildBulletinPage2(service(), undefined, [], bulletinDefaults, personNames)
    expect(noText.footer).toBeUndefined()

    const disabled = buildBulletinPage2(
      service({ bulletinPage2Footer: 'Grace upon grace.' }),
      undefined,
      [],
      {
        ...bulletinDefaults,
        page2: {
          ...bulletinDefaults.page2,
          footer: { ...bulletinDefaults.page2.footer, enabled: false },
        },
      },
      personNames,
    )
    expect(disabled.footer).toBeUndefined()
  })
})
