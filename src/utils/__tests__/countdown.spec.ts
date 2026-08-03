import { describe, expect, it } from 'vitest'
import { formatCountdown, formatDaysUntil } from '@/utils/countdown'

describe('formatCountdown', () => {
  it('formats minutes and seconds when under an hour remains', () => {
    const now = new Date('2026-07-26T10:00:00Z')
    expect(formatCountdown('2026-07-26T10:12:34Z', now)).toBe('12:34')
  })

  it('formats hours, minutes, and seconds once an hour or more remains', () => {
    const now = new Date('2026-07-26T10:00:00Z')
    expect(formatCountdown('2026-07-26T11:02:03Z', now)).toBe('01:02:03')
  })

  it('pads single-digit values', () => {
    const now = new Date('2026-07-26T10:00:00Z')
    expect(formatCountdown('2026-07-26T10:01:05Z', now)).toBe('01:05')
  })

  it('clamps to 00:00 once the target has passed, rather than going negative', () => {
    const now = new Date('2026-07-26T10:00:00Z')
    expect(formatCountdown('2026-07-26T09:00:00Z', now)).toBe('00:00')
  })

  it('reads 00:00 exactly at the target time', () => {
    const now = new Date('2026-07-26T10:00:00Z')
    expect(formatCountdown('2026-07-26T10:00:00Z', now)).toBe('00:00')
  })
})

describe('formatDaysUntil', () => {
  it('counts whole calendar days remaining', () => {
    const now = new Date('2026-07-26T22:00:00')
    expect(formatDaysUntil('2026-08-07', now)).toBe('12 Days')
  })

  it('reads "1 Day" for tomorrow', () => {
    const now = new Date('2026-07-26T09:00:00')
    expect(formatDaysUntil('2026-07-27', now)).toBe('1 Day')
  })

  it('reads "Today!" for the target day itself, regardless of time of day', () => {
    const now = new Date('2026-07-26T23:30:00')
    expect(formatDaysUntil('2026-07-26', now)).toBe('Today!')
  })

  it('clamps to "Today!" once the target day has passed, rather than going negative', () => {
    const now = new Date('2026-07-28T08:00:00')
    expect(formatDaysUntil('2026-07-26', now)).toBe('Today!')
  })
})
