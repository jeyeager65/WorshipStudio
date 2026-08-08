import { describe, expect, it } from 'vitest'
import { returnPath, routeWithReturnTo } from '@/utils/returnNavigation'

describe('return navigation', () => {
  it('uses a valid internal return path', () => {
    expect(returnPath('/service/service-1/plan', '/service/service-1')).toBe(
      '/service/service-1/plan',
    )
  })

  it('falls back for missing or external-looking paths', () => {
    expect(returnPath(undefined, '/')).toBe('/')
    expect(returnPath('//example.com', '/')).toBe('/')
    expect(returnPath('https://example.com', '/')).toBe('/')
  })

  it('builds a route that preserves its origin', () => {
    expect(routeWithReturnTo('/service/service-1/assignments', '/service/service-1/plan')).toEqual({
      path: '/service/service-1/assignments',
      query: { returnTo: '/service/service-1/plan' },
    })
  })
})
