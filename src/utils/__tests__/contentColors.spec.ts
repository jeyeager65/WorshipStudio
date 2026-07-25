import { describe, expect, it } from 'vitest'
import { colorForBlockLabel, colorForItemType } from '@/utils/contentColors'

describe('colorForBlockLabel', () => {
  it('matches common block labels by keyword, case-insensitively', () => {
    expect(colorForBlockLabel('Verse 1')).toBe('primary')
    expect(colorForBlockLabel('CHORUS')).toBe('secondary')
    expect(colorForBlockLabel('Pre-Chorus')).toBe('violet')
    expect(colorForBlockLabel('Bridge')).toBe('teal')
    expect(colorForBlockLabel('Intro')).toBe('slate')
    expect(colorForBlockLabel('Outro')).toBe('terracotta')
    expect(colorForBlockLabel('Ending')).toBe('terracotta')
    expect(colorForBlockLabel('Other')).toBe('terracotta')
    expect(colorForBlockLabel('Tag')).toBe('amber')
  })

  it('falls back to primary for an unrecognized label', () => {
    expect(colorForBlockLabel('New Part')).toBe('primary')
  })
})

describe('colorForItemType', () => {
  it('maps every known service item type to a color', () => {
    expect(colorForItemType('song')).toBe('primary')
    expect(colorForItemType('scripture')).toBe('teal')
    expect(colorForItemType('video')).toBe('rose')
  })

  it('falls back to a neutral color for an unrecognized type', () => {
    expect(colorForItemType('something-new')).toBe('slate')
  })
})
