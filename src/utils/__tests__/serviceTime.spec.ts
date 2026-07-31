import { describe, expect, it } from 'vitest'
import { formatServiceTime, serviceDateTimeSortKey } from '@/utils/serviceTime'

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
