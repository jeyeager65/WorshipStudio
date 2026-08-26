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

  it('names a modern iPad an iPad, not a Mac', () => {
    // Since iPadOS 13 an iPad claims to be a Macintosh; only maxTouchPoints separates them. Without
    // that, every iPad was called "Mac" — reported from a real device.
    const iPadOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    expect(suggestDeviceName(iPadOS, 5)).toBe('iPad')
    expect(suggestDeviceName(iPadOS, 0)).toBe('Mac')
  })

  it('checks iPhone before the "like Mac OS X" its UA also contains', () => {
    // Both iOS strings mention Mac OS X; ordering is what keeps them from being reported as Macs.
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).not.toBe(
      'Mac',
    )
  })

  it('names desktop platforms the way people refer to them', () => {
    expect(suggestDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PC')
    expect(suggestDeviceName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux PC')
    expect(suggestDeviceName('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')).toBe('Linux PC')
  })

  it('checks Android before Linux, whose token its user-agent also carries', () => {
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)')).toBe(
      'Android Tablet',
    )
  })

  it('falls back to a name that asserts nothing rather than the wrong form factor', () => {
    // "Tablet" was the old fallback, which was actively wrong for an unrecognised desktop browser.
    expect(suggestDeviceName('some unknown agent')).toBe('Device')
    expect(suggestDeviceName('')).toBe('Device')
  })

  it('is case-insensitive', () => {
    expect(suggestDeviceName('MOZILLA/5.0 (IPAD; CPU OS 17_0)')).toBe('iPad')
  })
})
