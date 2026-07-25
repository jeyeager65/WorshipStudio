import bibleBooksData from '@/data/bibleBooks.json'
import type { BibleBookRef, ScriptureReference } from '@/models/scripture'

export const bibleBooks = bibleBooksData as BibleBookRef[]

// Common alternate spellings that don't match a book's canonical name or abbreviation.
const BOOK_ALIASES: Record<string, string> = {
  psalms: 'Psalm',
  revelations: 'Revelation',
  'song of songs': 'Song of Solomon',
  canticles: 'Song of Solomon',
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\./g, '')
}

export function findBook(name: string): BibleBookRef | undefined {
  const normalized = normalize(name)
  if (!normalized) return undefined
  const aliased = BOOK_ALIASES[normalized]
  return bibleBooks.find(
    (b) => normalize(b.name) === normalized || normalize(b.abbr) === normalized || (aliased && b.name === aliased),
  )
}

export function getBookNames(): string[] {
  return bibleBooks.map((b) => b.name)
}

export function getChapterCount(bookName: string): number {
  return findBook(bookName)?.chapters.length ?? 0
}

export function getVerseCount(bookName: string, chapter: number): number {
  const book = findBook(bookName)
  return book?.chapters[chapter - 1] ?? 0
}

function isValidChapterVerse(book: BibleBookRef, chapter: number, verse: number): boolean {
  const verseCount = book.chapters[chapter - 1]
  return verseCount !== undefined && verse >= 1 && verse <= verseCount
}

/**
 * Validates a reference's book/chapter/verse against the reference table (spec section 1)
 * — used both for "Type a reference" free-text validation and "Choose fields" cascading
 * dropdown population, so an invalid reference is never selectable either way.
 */
export function isValidReference(ref: ScriptureReference): boolean {
  const book = findBook(ref.book)
  if (!book) return false
  if (!isValidChapterVerse(book, ref.startChapter, ref.startVerse)) return false
  if (!isValidChapterVerse(book, ref.endChapter, ref.endVerse)) return false
  if (ref.endChapter < ref.startChapter) return false
  if (ref.endChapter === ref.startChapter && ref.endVerse < ref.startVerse) return false
  return true
}

// Matches "Book C", "Book C:V", "Book C:V-V2", "Book C:V-C2:V2" — book name is everything
// before the trailing chapter/verse numbers, so it naturally handles multi-word and
// numbered-prefix book names ("1 Corinthians", "Song of Solomon") without a fixed list.
const REFERENCE_PATTERN = /^(.+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+))?)?\s*$/

/**
 * Parses a free-text reference like "John 3:16-17" or "John 3:16-4:2" (spec section 2,
 * "Type a reference" mode). Returns undefined if the text doesn't look like a reference at
 * all, or refers to an unknown book — callers should distinguish that from a
 * structurally-valid-but-out-of-range reference via isValidReference, so the UI can show
 * "verse out of range" instead of a generic parse failure.
 *
 * A bare "Book C" (no verse) resolves to the whole chapter. Disjoint multi-clause
 * references (e.g. "Psalm 135:3, 5-7") are out of scope for this parser — per spec, those
 * are only supported by API-based translations passing the raw text straight through,
 * which isn't implemented yet (M5 local-file-import slice only).
 */
export function parseReference(text: string): ScriptureReference | undefined {
  const match = REFERENCE_PATTERN.exec(text.trim())
  if (!match) return undefined
  const [, bookText, chapterText, startVerseText, endChapterText, endVerseText] = match
  const book = findBook(bookText)
  if (!book) return undefined

  const startChapter = Number(chapterText)
  const startVerse = startVerseText ? Number(startVerseText) : 1
  const endChapter = endChapterText ? Number(endChapterText) : startChapter
  const endVerse = endVerseText ? Number(endVerseText) : startVerseText ? startVerse : (book.chapters[startChapter - 1] ?? startVerse)

  return { book: book.name, startChapter, startVerse, endChapter, endVerse }
}

export function formatReference(ref: ScriptureReference): string {
  const wholeChapter = ref.startVerse === 1 && ref.endChapter === ref.startChapter && ref.endVerse === getVerseCount(ref.book, ref.startChapter)
  if (wholeChapter) return `${ref.book} ${ref.startChapter}`
  if (ref.startChapter === ref.endChapter) {
    return ref.startVerse === ref.endVerse
      ? `${ref.book} ${ref.startChapter}:${ref.startVerse}`
      : `${ref.book} ${ref.startChapter}:${ref.startVerse}-${ref.endVerse}`
  }
  return `${ref.book} ${ref.startChapter}:${ref.startVerse}-${ref.endChapter}:${ref.endVerse}`
}
