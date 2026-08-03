import { describe, expect, it } from 'vitest'
import { formatServiceTime, serviceDateTimeIso, serviceDateTimeSortKey } from '@/utils/serviceTime'

describe('formatServiceTime', () => {
  it('formats a valid stored time and rejects missing or invalid values', () => {
    expect(formatServiceTime('10:30')).toMatch(/10:30/)
    expect(formatServiceTime(undefined)).toBeUndefined()
    expect(formatServiceTime('25:00')).toBeUndefined()
  })
})

describe('serviceDateTimeSortKey', () => {
  it('sorts timed services chronologically and legacy untimed services last', () => {
    const keys = [
      serviceDateTimeSortKey({ date: '2026-08-02' }),
      serviceDateTimeSortKey({ date: '2026-08-02', time: '18:00' }),
      serviceDateTimeSortKey({ date: '2026-08-02', time: '09:00' }),
    ].sort()
    expect(keys).toEqual(['2026-08-02T09:00', '2026-08-02T18:00', '2026-08-02T99:99'])
  })
})

describe('serviceDateTimeIso', () => {
  it('combines date and time into a real instant', () => {
    const iso = serviceDateTimeIso({ date: '2026-08-02', time: '10:30' })
    expect(iso).toBeDefined()
    const parsed = new Date(iso!)
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(2)
    expect(parsed.getHours()).toBe(10)
    expect(parsed.getMinutes()).toBe(30)
  })

  it('returns undefined when the service has no start time set', () => {
    expect(serviceDateTimeIso({ date: '2026-08-02' })).toBeUndefined()
  })
})
