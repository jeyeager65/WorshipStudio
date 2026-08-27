import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeDemoReset, markDemoReset } from '../demoReset'

describe('demoReset', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('reports a reset exactly once', () => {
    markDemoReset()

    expect(consumeDemoReset()).toBe(true)
    // A plain reload afterwards is an ordinary demo launch and must show the introduction again,
    // so the flag has to be gone rather than merely read.
    expect(consumeDemoReset()).toBe(false)
  })

  it('reports no reset on a load that never set the flag', () => {
    expect(consumeDemoReset()).toBe(false)
  })

  it('survives storage being unavailable', () => {
    // Some contexts throw from the accessor itself rather than returning null — a private window,
    // or a browser set to block site data. Losing the confirmation is acceptable; throwing on the
    // way into the demo, or blocking the reset, is not.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => markDemoReset()).not.toThrow()
    expect(consumeDemoReset()).toBe(false)
  })
})
