/**
 * ESV (api.esv.org) and api.bible (scripture.api.bible) network resolution for the web build —
 * a TypeScript port of src-tauri/src/domain/scripture.rs's resolve_esv/resolve_api_bible/
 * list_api_bible_catalog/osis_book_code/parse_bracketed_verses, kept close enough to a straight
 * translation that the two should be read side by side when either changes. Both APIs are
 * confirmed CORS-open for direct browser fetches (web-feature-parity.md §3) — no server-side
 * proxy needed.
 */

import type {
  ApiBibleCatalogEntry,
  ScripturePassage,
  ScripturePassageVerse,
} from '@/adapters/types'
import { formatReference, isValidReference, parseReference } from '@/utils/scriptureReference'

const VERSE_MARKER = /\[(\d+)\]\s*/g

function normalizeVerseText(text: string): string {
  return text
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ')
}

/** Splits a flat "[16] text [17] text..." response on each verse-number marker, pairing it with
 *  the text run up to the next marker (or end of string) — mirrors parse_bracketed_verses. */
export function parseBracketedVerses(text: string): ScripturePassageVerse[] {
  const verses: ScripturePassageVerse[] = []
  let lastEnd = 0
  let pendingNumber: number | undefined
  VERSE_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VERSE_MARKER.exec(text)) !== null) {
    if (pendingNumber !== undefined) {
      verses.push({
        number: pendingNumber,
        text: normalizeVerseText(text.slice(lastEnd, match.index)),
      })
    }
    pendingNumber = Number(match[1])
    lastEnd = match.index + match[0].length
  }
  if (pendingNumber !== undefined) {
    verses.push({ number: pendingNumber, text: normalizeVerseText(text.slice(lastEnd)) })
  }
  return verses
}

/** Maps the app's canonical book name (see @/utils/scriptureReference's parseReference) to its
 *  OSIS abbreviation — the code api.bible's passage-lookup endpoint expects (e.g. "JHN" for
 *  John, "1CO" for 1 Corinthians). These are the standard, stable OSIS codes, ported verbatim
 *  from src-tauri/src/domain/scripture.rs's osis_book_code table. */
const OSIS_BOOK_CODES: Record<string, string> = {
  Genesis: 'GEN',
  Exodus: 'EXO',
  Leviticus: 'LEV',
  Numbers: 'NUM',
  Deuteronomy: 'DEU',
  Joshua: 'JOS',
  Judges: 'JDG',
  Ruth: 'RUT',
  '1 Samuel': '1SA',
  '2 Samuel': '2SA',
  '1 Kings': '1KI',
  '2 Kings': '2KI',
  '1 Chronicles': '1CH',
  '2 Chronicles': '2CH',
  Ezra: 'EZR',
  Nehemiah: 'NEH',
  Esther: 'EST',
  Job: 'JOB',
  Psalm: 'PSA',
  Proverbs: 'PRO',
  Ecclesiastes: 'ECC',
  'Song of Solomon': 'SNG',
  Isaiah: 'ISA',
  Jeremiah: 'JER',
  Lamentations: 'LAM',
  Ezekiel: 'EZK',
  Daniel: 'DAN',
  Hosea: 'HOS',
  Joel: 'JOL',
  Amos: 'AMO',
  Obadiah: 'OBA',
  Jonah: 'JON',
  Micah: 'MIC',
  Nahum: 'NAM',
  Habakkuk: 'HAB',
  Zephaniah: 'ZEP',
  Haggai: 'HAG',
  Zechariah: 'ZEC',
  Malachi: 'MAL',
  Matthew: 'MAT',
  Mark: 'MRK',
  Luke: 'LUK',
  John: 'JHN',
  Acts: 'ACT',
  Romans: 'ROM',
  '1 Corinthians': '1CO',
  '2 Corinthians': '2CO',
  Galatians: 'GAL',
  Ephesians: 'EPH',
  Philippians: 'PHP',
  Colossians: 'COL',
  '1 Thessalonians': '1TH',
  '2 Thessalonians': '2TH',
  '1 Timothy': '1TI',
  '2 Timothy': '2TI',
  Titus: 'TIT',
  Philemon: 'PHM',
  Hebrews: 'HEB',
  James: 'JAS',
  '1 Peter': '1PE',
  '2 Peter': '2PE',
  '1 John': '1JN',
  '2 John': '2JN',
  '3 John': '3JN',
  Jude: 'JUD',
  Revelation: 'REV',
}

function osisBookCode(bookName: string): string | undefined {
  return OSIS_BOOK_CODES[bookName]
}

function resolveCanonicalReference(referenceText: string) {
  const parsed = parseReference(referenceText)
  if (!parsed || !isValidReference(parsed)) {
    throw new Error(`"${referenceText}" isn't a valid scripture reference.`)
  }
  return parsed
}

/** Real ESV API fetch (https://api.esv.org/docs/passage-text/) — see notes/release-process.md
 *  sibling note in Settings (Bible Translations) for the attribution this requires. Verse
 *  numbers are requested so the flat text can be split back into the same
 *  ScripturePassageVerse[] shape the local KJV sample and the rest of the app already use;
 *  footnotes/headings/references are excluded since this app displays verse text only. */
export async function resolveEsv(referenceText: string, apiKey: string): Promise<ScripturePassage> {
  const parsed = resolveCanonicalReference(referenceText)
  const canonicalReference = formatReference(parsed)

  const url = new URL('https://api.esv.org/v3/passage/text/')
  url.searchParams.set('q', canonicalReference)
  url.searchParams.set('include-passage-references', 'false')
  url.searchParams.set('include-verse-numbers', 'true')
  url.searchParams.set('include-footnotes', 'false')
  url.searchParams.set('include-headings', 'false')
  url.searchParams.set('include-short-copyright', 'false')

  let response: Response
  try {
    response = await fetch(url, { headers: { Authorization: `Token ${apiKey}` } })
  } catch (error) {
    throw new Error(
      `Failed to reach the ESV API: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`ESV API request failed (${response.status}).`)

  let body: { passages?: string[] }
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(
      `Failed to parse the ESV API response: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const text = body.passages?.[0]
  if (text === undefined) {
    throw new Error(`The ESV API returned no text for ${canonicalReference}.`)
  }

  const verses = parseBracketedVerses(text)
  if (verses.length === 0) {
    throw new Error(`The ESV API returned no verse text for ${canonicalReference}.`)
  }

  return {
    reference: canonicalReference,
    translation: 'ESV',
    verses,
    // Compact per-quotation designator (ESV API terms: "include the letters 'ESV'" with each
    // quotation) — the full copyright/permission notice is shown once, in Settings' Bible
    // Translations section, not repeated on every passage/live slide.
    copyright: '(ESV)',
  }
}

/** api.bible sends an explicit JSON `null` for some editions' copyright/description fields (not
 *  merely an absent field) — this treats both "missing" and "null" as empty, same fix as the
 *  Rust side's empty_string_if_null. */
function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Real api.bible fetch (https://scripture.api.bible/docs) for translations beyond the bundled
 *  KJV/ESV — e.g. NIV. `bibleId` is the specific catalog id chosen in Settings (Bible
 *  Translations), since api.bible hosts many editions per language. `translationCode` is the
 *  app's own short label (e.g. "NIV") echoed back into the response, since api.bible's own
 *  abbreviation for the same edition may differ (e.g. "NIV11"). */
export async function resolveApiBible(
  referenceText: string,
  bibleId: string,
  translationCode: string,
  apiKey: string,
): Promise<ScripturePassage> {
  const parsed = resolveCanonicalReference(referenceText)
  const canonicalReference = formatReference(parsed)
  const bookCode = osisBookCode(parsed.book)
  if (bookCode === undefined) {
    throw new Error(`"${parsed.book}" isn't supported by api.bible yet.`)
  }
  const passageId =
    parsed.startChapter === parsed.endChapter && parsed.startVerse === parsed.endVerse
      ? `${bookCode}.${parsed.startChapter}.${parsed.startVerse}`
      : `${bookCode}.${parsed.startChapter}.${parsed.startVerse}-${bookCode}.${parsed.endChapter}.${parsed.endVerse}`

  const url = new URL(`https://api.scripture.api.bible/v1/bibles/${bibleId}/passages/${passageId}`)
  url.searchParams.set('content-type', 'text')
  url.searchParams.set('include-verse-numbers', 'true')
  url.searchParams.set('include-verse-spans', 'false')

  let response: Response
  try {
    response = await fetch(url, { headers: { 'api-key': apiKey } })
  } catch (error) {
    throw new Error(
      `Failed to reach api.bible: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`api.bible request failed (${response.status}).`)

  let body: { data?: { content?: string; copyright?: unknown } }
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(
      `Failed to parse the api.bible response: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const content = body.data?.content ?? ''
  const verses = parseBracketedVerses(content)
  if (verses.length === 0) {
    throw new Error(`api.bible returned no verse text for ${canonicalReference}.`)
  }

  const copyright = stringOrEmpty(body.data?.copyright).trim()
  return {
    reference: canonicalReference,
    translation: translationCode,
    verses,
    copyright: copyright.length === 0 ? undefined : copyright,
  }
}

/** Fetches api.bible's own catalog of English Bible editions (https://scripture.api.bible), so
 *  Settings can offer a real picker (spec: "entered in Bible Translations settings") rather than
 *  free-text entry of an unvalidated code. */
export async function listApiBibleCatalog(apiKey: string): Promise<ApiBibleCatalogEntry[]> {
  const url = new URL('https://api.scripture.api.bible/v1/bibles')
  url.searchParams.set('language', 'eng')

  let response: Response
  try {
    response = await fetch(url, { headers: { 'api-key': apiKey } })
  } catch (error) {
    throw new Error(
      `Failed to reach api.bible: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`api.bible request failed (${response.status}).`)

  let body: { data?: unknown[] }
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(
      `Failed to parse the api.bible catalog response: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return (body.data ?? []).map((raw) => {
    const entry = raw as Record<string, unknown>
    return {
      id: stringOrEmpty(entry.id),
      name: stringOrEmpty(entry.name),
      abbreviation: stringOrEmpty(entry.abbreviation),
      description: stringOrEmpty(entry.description),
    }
  })
}
