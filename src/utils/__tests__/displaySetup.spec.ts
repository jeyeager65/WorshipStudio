import { describe, expect, it } from 'vitest'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import type { DisplayInfo } from '@/adapters/types'

function makeDisplay(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return { id: 'display-1', name: 'Built-in Display', resolution: '1920x1080', role: 'operator', ...overrides }
}

describe('needsSingleMonitorFallback', () => {
  it('is true with no displays', () => {
    expect(needsSingleMonitorFallback([])).toBe(true)
  })

  it('is true with exactly one display', () => {
    expect(needsSingleMonitorFallback([makeDisplay()])).toBe(true)
  })

  it('is false with two or more displays', () => {
    expect(needsSingleMonitorFallback([makeDisplay({ id: 'display-1' }), makeDisplay({ id: 'display-2' })])).toBe(false)
  })
})
