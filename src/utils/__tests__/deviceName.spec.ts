import { describe, expect, it } from 'vitest'
import { suggestDeviceName } from '@/utils/deviceName'

describe('suggestDeviceName', () => {
  it('names the common tablets and phones', () => {
    expect(suggestDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad')
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(
      'iPhone',
    )
  })

  it('separates Android tablets from Android phones by the Mobile token', () => {
    // Android puts "Mobile" in the UA for phones and omits it for tablets — the only reliable
    // signal without client hints.
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)')).toBe(
      'Android Tablet',
    )
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe(
      'Android Phone',
    )
  })

  it('checks iPhone before the "like Mac OS X" its UA also contains', () => {
    // Both iOS strings mention Mac OS X; ordering is what keeps them from being reported as Macs.
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).not.toBe(
      'Mac',
    )
  })

  it('falls back to a neutral name rather than guessing', () => {
    expect(suggestDeviceName('some unknown agent')).toBe('Tablet')
    expect(suggestDeviceName('')).toBe('Tablet')
  })

  it('is case-insensitive', () => {
    expect(suggestDeviceName('MOZILLA/5.0 (IPAD; CPU OS 17_0)')).toBe('iPad')
  })
})
