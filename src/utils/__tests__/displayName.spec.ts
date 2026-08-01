import { describe, expect, it } from 'vitest'
import { friendlyDisplayName } from '@/utils/displayName'

describe('friendlyDisplayName', () => {
  it('turns Windows device paths into readable display numbers', () => {
    expect(friendlyDisplayName('\\\\.\\DISPLAY1', 0)).toBe('Display 1')
    expect(friendlyDisplayName('\\\\?\\DISPLAY2', 1)).toBe('Display 2')
  })

  it('handles abbreviated Windows display identifiers', () => {
    expect(friendlyDisplayName('DISPLAY3', 2)).toBe('Display 3')
  })

  it('preserves descriptive monitor names', () => {
    expect(friendlyDisplayName('Built-in Retina Display', 0)).toBe('Built-in Retina Display')
  })

  it('falls back to the monitor position when no name is reported', () => {
    expect(friendlyDisplayName(undefined, 1)).toBe('Display 2')
  })
})
