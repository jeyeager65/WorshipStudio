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

export interface WayfindingBook {
  name: string
  /** Signed distance in books from the current one: 0 = current, negative = before, positive = after. */
  distance: number
}

/**
 * The ordered run of books surrounding `bookName`, `radius` in each direction — for
 * reference-only mode's "wayfinding" live-slide visual (spec section 1), which mirrors the
 * physical experience of flipping through a Bible and seeing nearby book names. Always one
 * book per fade level regardless of length, so this is purely positional in the canonical
 * 66-book order, not a verse/page-count-weighted distance.
 */
export function getWayfindingBooks(bookName: string, radius = 2): WayfindingBook[] {
  const names = getBookNames()
  const currentIndex = names.findIndex((name) => name === findBook(bookName)?.name)
  if (currentIndex === -1) return []

  const books: WayfindingBook[] = []
  for (let distance = -radius; distance <= radius; distance++) {
    const index = currentIndex + distance
    if (index < 0 || index >= names.length) continue
    books.push({ name: names[index]!, distance })
  }
  return books
}

function totalVerses(book: BibleBookRef): number {
  return book.chapters.reduce((sum, count) => sum + count, 0)
}

// bibleBooks.json is the canonical 66-book order with no testament field of its own — Malachi
// (index 38) is the last Old Testament book and Matthew (index 39) the first New Testament one.
// Its chapters arrays (verse count per chapter, already used for reference validation above)
// double as a length proxy for the wayfinding progress bar below, without needing the full
// bundled KJV text.
const OLD_TESTAMENT_BOOK_COUNT = 39
const TOTAL_OT_VERSES = bibleBooks.slice(0, OLD_TESTAMENT_BOOK_COUNT).reduce((sum, b) => sum + totalVerses(b), 0)
const TOTAL_BIBLE_VERSES = bibleBooks.reduce((sum, b) => sum + totalVerses(b), 0)

/** Fraction of the whole Bible (by KJV verse count) that falls at the end of the Old Testament —
 *  the OT/NT split point for the wayfinding progress bar (see getBibleProgress). */
export const OLD_TESTAMENT_FRACTION = TOTAL_OT_VERSES / TOTAL_BIBLE_VERSES

/** How far into the whole Bible (0-1, by cumulative KJV verse count) a reference's starting
 *  point falls — Genesis near 0, Revelation at 1 — mirroring the physical feel of flipping open
 *  a Bible near the front or the back. Used for the wayfinding display's progress bar. */
export function getBibleProgress(ref: ScriptureReference): number | undefined {
  const book = findBook(ref.book)
  if (!book) return undefined
  const index = bibleBooks.findIndex((b) => b.name === book.name)
  const versesBeforeBook = bibleBooks.slice(0, index).reduce((sum, b) => sum + totalVerses(b), 0)
  const versesBeforeChapter = book.chapters.slice(0, ref.startChapter - 1).reduce((sum, c) => sum + c, 0)
  return (versesBeforeBook + versesBeforeChapter + ref.startVerse) / TOTAL_BIBLE_VERSES
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
