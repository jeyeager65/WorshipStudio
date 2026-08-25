import { describe, expect, it } from 'vitest'
import { ALPHABET_INDEX_LETTERS, groupByIndexLetter, indexLetterFor } from '@/utils/alphabetIndex'

describe('indexLetterFor', () => {
  it('returns the uppercased first letter', () => {
    expect(indexLetterFor('amazing grace')).toBe('A')
    expect(indexLetterFor('Zion')).toBe('Z')
  })

  it('buckets anything that does not start with a letter under "#"', () => {
    expect(indexLetterFor('12 Gates')).toBe('#')
    expect(indexLetterFor('')).toBe('#')
    expect(indexLetterFor('   ')).toBe('#')
  })
})

describe('ALPHABET_INDEX_LETTERS', () => {
  it('is "#" followed by A-Z', () => {
    expect(ALPHABET_INDEX_LETTERS).toHaveLength(27)
    expect(ALPHABET_INDEX_LETTERS[0]).toBe('#')
    expect(ALPHABET_INDEX_LETTERS[1]).toBe('A')
    expect(ALPHABET_INDEX_LETTERS[26]).toBe('Z')
  })
})

describe('groupByIndexLetter', () => {
  it('groups consecutive same-letter items in order', () => {
    const items = ['Amazing Grace', 'Ancient Words', 'Blessed Be', 'Zion']
    const groups = groupByIndexLetter(items, (title) => title)
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B', 'Z'])
    expect(groups[0].items).toEqual(['Amazing Grace', 'Ancient Words'])
    expect(groups[1].items).toEqual(['Blessed Be'])
    expect(groups[2].items).toEqual(['Zion'])
  })

  it('returns an empty array for an empty input', () => {
    expect(groupByIndexLetter([], (x: string) => x)).toEqual([])
  })
})
