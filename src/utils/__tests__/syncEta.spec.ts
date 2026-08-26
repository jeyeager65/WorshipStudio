import { describe, expect, it } from 'vitest'
import { estimateSecondsRemaining, formatSecondsRemaining, progressPercent } from '@/utils/syncEta'

describe('estimateSecondsRemaining', () => {
  it('projects the remaining items at the rate observed so far', () => {
    // 10 items in 10s = 1s each; 90 left.
    expect(estimateSecondsRemaining(10, 100, 10_000)).toBe(90)
  })

  it('says nothing until enough items have been seen to have a rate at all', () => {
    // The first few files are whatever they happened to be — often a burst of tiny JSON records
    // before a large video, which would promise a wildly optimistic finish.
    expect(estimateSecondsRemaining(1, 100, 10_000)).toBeUndefined()
    expect(estimateSecondsRemaining(4, 100, 10_000)).toBeUndefined()
    expect(estimateSecondsRemaining(5, 100, 10_000)).toBe(190)
  })

  it('says nothing until enough time has passed for the rate to mean anything', () => {
    expect(estimateSecondsRemaining(20, 100, 500)).toBeUndefined()
  })

  it('says nothing once there is nothing left, or when the total is unknown', () => {
    expect(estimateSecondsRemaining(100, 100, 10_000)).toBeUndefined()
    expect(estimateSecondsRemaining(120, 100, 10_000)).toBeUndefined()
    expect(estimateSecondsRemaining(10, 0, 10_000)).toBeUndefined()
  })
})

describe('formatSecondsRemaining', () => {
  it('never quotes seconds, since the estimate is not that precise', () => {
    expect(formatSecondsRemaining(5)).toBe('less than a minute left')
    expect(formatSecondsRemaining(59)).toBe('less than a minute left')
  })

  it('rounds to whole minutes above that', () => {
    expect(formatSecondsRemaining(60)).toBe('about a minute left')
    expect(formatSecondsRemaining(80)).toBe('about a minute left')
    expect(formatSecondsRemaining(150)).toBe('about 3 minutes left')
    expect(formatSecondsRemaining(600)).toBe('about 10 minutes left')
  })
})

describe('progressPercent', () => {
  it('reports the fraction done', () => {
    expect(progressPercent(25, 100)).toBe(25)
    expect(progressPercent(0, 100)).toBe(0)
  })

  it('cannot exceed full, even if more items turn up than were first counted', () => {
    expect(progressPercent(120, 100)).toBe(100)
  })

  it('is zero rather than NaN before a total is known', () => {
    expect(progressPercent(0, 0)).toBe(0)
  })
})
