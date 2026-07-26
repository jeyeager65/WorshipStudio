import { describe, expect, it } from 'vitest'
import {
  findBook,
  formatReference,
  getChapterCount,
  getVerseCount,
  getWayfindingBooks,
  isValidReference,
  parseReference,
} from '@/utils/scriptureReference'

describe('findBook', () => {
  it('matches by canonical name, case-insensitively', () => {
    expect(findBook('john')?.name).toBe('John')
  })

  it('matches by abbreviation', () => {
    expect(findBook('Gen')?.name).toBe('Genesis')
  })

  it('matches numbered books', () => {
    expect(findBook('1 Corinthians')?.name).toBe('1 Corinthians')
  })

  it('matches common aliases', () => {
    expect(findBook('Psalms')?.name).toBe('Psalm')
    expect(findBook('Revelations')?.name).toBe('Revelation')
  })

  it('returns undefined for an unknown book', () => {
    expect(findBook('Not A Book')).toBeUndefined()
  })
})

describe('getChapterCount / getVerseCount', () => {
  it('reports the correct chapter count', () => {
    expect(getChapterCount('Psalm')).toBe(150)
    expect(getChapterCount('Jude')).toBe(1)
  })

  it('reports the correct verse count for a chapter', () => {
    expect(getVerseCount('John', 3)).toBe(36)
    expect(getVerseCount('Genesis', 1)).toBe(31)
  })
})

describe('parseReference', () => {
  it('parses a single verse', () => {
    expect(parseReference('John 3:16')).toEqual({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 })
  })

  it('parses a verse range within one chapter', () => {
    expect(parseReference('John 3:16-17')).toEqual({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 17 })
  })

  it('parses a range crossing chapters', () => {
    expect(parseReference('John 3:16-4:2')).toEqual({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 })
  })

  it('parses a whole-chapter reference with no verse given', () => {
    expect(parseReference('Psalm 23')).toEqual({ book: 'Psalm', startChapter: 23, startVerse: 1, endChapter: 23, endVerse: 6 })
  })

  it('parses a multi-word numbered book name', () => {
    expect(parseReference('1 Corinthians 13:4-7')).toEqual({
      book: '1 Corinthians',
      startChapter: 13,
      startVerse: 4,
      endChapter: 13,
      endVerse: 7,
    })
  })

  it('returns undefined for an unrecognized book', () => {
    expect(parseReference('Not A Book 1:1')).toBeUndefined()
  })

  it('returns undefined for text with no chapter/verse numbers', () => {
    expect(parseReference('John')).toBeUndefined()
  })
})

describe('isValidReference', () => {
  it('accepts a reference within bounds', () => {
    expect(isValidReference({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 17 })).toBe(true)
  })

  it('rejects a verse beyond the chapter length', () => {
    expect(isValidReference({ book: 'John', startChapter: 3, startVerse: 1, endChapter: 3, endVerse: 999 })).toBe(false)
  })

  it('rejects a chapter beyond the book length', () => {
    expect(isValidReference({ book: 'Jude', startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 1 })).toBe(false)
  })

  it('rejects an end that comes before the start', () => {
    expect(isValidReference({ book: 'John', startChapter: 3, startVerse: 20, endChapter: 3, endVerse: 16 })).toBe(false)
  })

  it('rejects an unknown book', () => {
    expect(isValidReference({ book: 'Not A Book', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 })).toBe(false)
  })
})

describe('getWayfindingBooks', () => {
  it('returns the current book at distance 0, flanked by neighbors within the radius', () => {
    const books = getWayfindingBooks('John', 2)
    expect(books.map((b) => [b.name, b.distance])).toEqual([
      ['Mark', -2],
      ['Luke', -1],
      ['John', 0],
      ['Acts', 1],
      ['Romans', 2],
    ])
  })

  it('matches by alias/abbreviation like findBook does', () => {
    expect(getWayfindingBooks('Gen', 1).find((b) => b.distance === 0)?.name).toBe('Genesis')
  })

  it('truncates rather than wrapping at the start of the canon', () => {
    const books = getWayfindingBooks('Genesis', 2)
    expect(books.map((b) => b.name)).toEqual(['Genesis', 'Exodus', 'Leviticus'])
  })

  it('truncates rather than wrapping at the end of the canon', () => {
    const books = getWayfindingBooks('Revelation', 2)
    expect(books.map((b) => b.name)).toEqual(['3 John', 'Jude', 'Revelation'])
  })

  it('returns an empty list for an unknown book', () => {
    expect(getWayfindingBooks('Not A Book')).toEqual([])
  })
})

describe('formatReference', () => {
  it('formats a single verse', () => {
    expect(formatReference({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 })).toBe('John 3:16')
  })

  it('formats a range within one chapter', () => {
    expect(formatReference({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 17 })).toBe('John 3:16-17')
  })

  it('formats a range crossing chapters', () => {
    expect(formatReference({ book: 'John', startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 })).toBe('John 3:16-4:2')
  })

  it('formats a whole chapter without a verse range', () => {
    expect(formatReference({ book: 'Psalm', startChapter: 23, startVerse: 1, endChapter: 23, endVerse: 6 })).toBe('Psalm 23')
  })
})
