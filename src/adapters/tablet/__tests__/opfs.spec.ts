import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from '../opfs'

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { storage })
}

afterEach(() => vi.unstubAllGlobals())

describe('requestPersistentStorage', () => {
  it('asks the browser to keep this origin, and reports what it said', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) })

    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalled()
  })

  it('does not ask again when it was already granted', async () => {
    // Some browsers prompt on every call; there is nothing to gain from a second one.
    const persist = vi.fn()
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(true) })

    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports a refusal rather than pretending it succeeded', async () => {
    stubStorage({
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    })
    expect(await requestPersistentStorage()).toBe(false)
  })

  // The whole point is that failure is survivable: the app works exactly as before, just with
  // storage the browser may reclaim. None of these may throw into adapter creation.
  it('survives a browser without the API', async () => {
    stubStorage({})
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('survives no storage object at all', async () => {
    stubStorage(undefined)
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('survives the call throwing', async () => {
    stubStorage({
      persist: vi.fn().mockRejectedValue(new Error('denied')),
      persisted: vi.fn().mockResolvedValue(false),
    })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('survives a browser with persist but no persisted', async () => {
    stubStorage({ persist: vi.fn().mockResolvedValue(true) })
    expect(await requestPersistentStorage()).toBe(true)
  })
})
