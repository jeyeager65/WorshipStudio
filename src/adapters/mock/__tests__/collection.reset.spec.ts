import { beforeEach, describe, expect, it } from 'vitest'
import { clearMockStorage, MOCK_STORAGE_PREFIX } from '@/adapters/mock/collection'

describe('clearMockStorage', () => {
  beforeEach(() => localStorage.clear())

  it('removes every demo key so the next load seeds fresh', () => {
    localStorage.setItem(`${MOCK_STORAGE_PREFIX}songs`, '[]')
    localStorage.setItem(`${MOCK_STORAGE_PREFIX}themes`, '[]')

    clearMockStorage()

    expect(localStorage.getItem(`${MOCK_STORAGE_PREFIX}songs`)).toBeNull()
    expect(localStorage.getItem(`${MOCK_STORAGE_PREFIX}themes`)).toBeNull()
  })

  it('leaves everything that is not the demo alone', () => {
    // The real web/tablet builds keep machine settings and cloud tokens in this same localStorage;
    // resetting the demo must not sign anyone out or forget a library folder.
    localStorage.setItem('worship-studio:web:machine-settings', '{"a":1}')
    localStorage.setItem('unrelated', 'x')
    localStorage.setItem(`${MOCK_STORAGE_PREFIX}songs`, '[]')

    clearMockStorage()

    expect(localStorage.getItem('worship-studio:web:machine-settings')).toBe('{"a":1}')
    expect(localStorage.getItem('unrelated')).toBe('x')
    expect(localStorage.getItem(`${MOCK_STORAGE_PREFIX}songs`)).toBeNull()
  })

  it('removes them all, not every other one', () => {
    // Deleting while walking localStorage by index shifts the remaining entries underneath the
    // loop, which silently leaves half of them behind.
    for (let i = 0; i < 12; i++) localStorage.setItem(`${MOCK_STORAGE_PREFIX}k${i}`, '[]')

    clearMockStorage()

    for (let i = 0; i < 12; i++) {
      expect(localStorage.getItem(`${MOCK_STORAGE_PREFIX}k${i}`), `k${i}`).toBeNull()
    }
  })
})
