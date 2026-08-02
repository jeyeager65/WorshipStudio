import { describe, expect, it } from 'vitest'
import { localCalendarDate } from '@/utils/calendarDate'

describe('localCalendarDate', () => {
  it('preserves the local calendar day late at night', () => {
    const lateLocalDate = {
      getFullYear: () => 2026,
      getMonth: () => 7,
      getDate: () => 1,
      // This is the value the old implementation incorrectly reduced to 2026-08-02.
      toISOString: () => '2026-08-02T03:30:00.000Z',
    } as Date

    expect(localCalendarDate(lateLocalDate)).toBe('2026-08-01')
  })

  it('pads single-digit months and days', () => {
    expect(localCalendarDate(new Date(2026, 0, 2, 12))).toBe('2026-01-02')
  })
})
