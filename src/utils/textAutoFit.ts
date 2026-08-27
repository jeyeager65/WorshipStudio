export interface FontSizeRange {
  minPx: number
  maxPx: number
}

// Reference box pagination decisions are estimated against — a representative widescreen
// presentation area, not the actual audience display's real resolution (only known once a
// specific monitor is live, per Display Setup — see design/feature-spec.md's aspect-ratio
// note). This only decides *how many slides* a passage/block splits into; PresentationView
// separately measures its own real container and shrinks-to-fit.
//
// That shrink-to-fit is what absorbs an imprecise estimate here, but only down to a bound: it may
// go 10% below the configured minimum and no further (SlideContentRenderer). An estimate optimistic
// enough to push past that produces text overrunning the header and footer, so being wrong
// generously here is not free — err toward splitting sooner.
const REFERENCE_BOX_WIDTH_PX = 1728
const REFERENCE_BOX_HEIGHT_PX = 800

// Average glyph width as a fraction of font size — used to estimate word-wrap without a real
// canvas/font-metrics call (this needs to run identically in tests and in the app, and jsdom's
// canvas has no real text-measurement backend).
//
// Raised from 0.55, which was measurably optimistic for the wide geometric sans faces themes
// actually use: a real 1 Peter 1:3-9 slide in Montserrat held ~36 characters per line where 0.55
// predicted ~43, so pagination packed a page ~20% fuller than would fit and the text ran over the
// header and footer. 0.62 sits between a narrow face and a wide one rather than tracking either
// exactly — the estimate cannot know the theme's font, so the aim is to be wrong in the harmless
// direction. Over-splitting costs one extra slide; under-splitting produces an unreadable one.
const AVG_CHAR_WIDTH_RATIO = 0.62
const LINE_HEIGHT_RATIO = 1.3

function estimateWrappedLineCount(line: string, fontSizePx: number, maxWidthPx: number): number {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  const charsPerLine = Math.max(1, Math.floor(maxWidthPx / (fontSizePx * AVG_CHAR_WIDTH_RATIO)))
  let lineCount = 1
  let currentLineLength = 0
  for (const word of words) {
    const wordLength = word.length + 1 // +1 for the trailing space
    if (currentLineLength > 0 && currentLineLength + wordLength > charsPerLine) {
      lineCount++
      currentLineLength = wordLength
    } else {
      currentLineLength += wordLength
    }
  }
  return lineCount
}

function estimateBlockHeightPx(joined: string, fontSizePx: number): number {
  // A joined block may itself contain explicit line breaks (song lyrics keep each line
  // distinct) — each one wraps independently rather than being treated as one long line.
  const lineCount = joined
    .split('\n')
    .reduce(
      (total, line) => total + estimateWrappedLineCount(line, fontSizePx, REFERENCE_BOX_WIDTH_PX),
      0,
    )
  return lineCount * fontSizePx * LINE_HEIGHT_RATIO
}

/**
 * Splits `units` (each atomic and never split across a page boundary — a scripture verse, a
 * song lyric line) into pages that each fit within `range.minPx` — the smallest allowed size
 * fits the most content, so this is the split point that guarantees every page is renderable
 * somewhere in the configured range. `separator` joins units within a page for the height
 * estimate (`' '` for flowing prose like scripture, `'\n'` to keep each unit on its own line
 * like song lyrics).
 *
 * A single unit too long to fit even alone at the minimum size still becomes its own page
 * (never split mid-unit) — PresentationView's live shrink-to-fit does what it can with it.
 */
export function paginateTextUnits(
  units: string[],
  range: FontSizeRange,
  separator: string = ' ',
): string[][] {
  if (units.length === 0) return [[]]
  const pages: string[][] = []
  let currentPage: string[] = []
  for (const unit of units) {
    const candidate = [...currentPage, unit]
    const fits =
      estimateBlockHeightPx(candidate.join(separator), range.minPx) <= REFERENCE_BOX_HEIGHT_PX
    if (currentPage.length === 0 || fits) {
      currentPage = candidate
    } else {
      pages.push(currentPage)
      currentPage = [unit]
    }
  }
  pages.push(currentPage)
  return pages
}

// Comma/semicolon/colon are mid-clause pause points; period/exclamation/question mark are full
// sentence ends — a single authored line sometimes contains more than one complete sentence
// (a repeated chorus line like "Great is Thy faithfulness! Great is Thy faithfulness!" is one
// line in the source but reads naturally as two), so those belong in the same break set. En/em
// dash (–/—) read the same way when used as punctuation ("...hath provided— Great is..."). A
// plain ASCII hyphen (-) is deliberately excluded — in lyrics it's overwhelmingly a compound-word
// joiner ("self-control", "well-being"), and breaking there would be exactly the mid-word wrap
// this function exists to avoid.
const BREAK_CHARS = new Set([',', ';', ':', '.', '!', '?', '–', '—'])

// A break character immediately followed by a closing quote/bracket ("vict'ry!"" — the sentence
// ends at "!", but a quotation the whole line was inside closes right after it) must keep that
// closer attached to the segment it belongs with — otherwise it's left as the entire *next*
// segment's content, producing a line that's nothing but a lone closing quote mark.
const TRAILING_CLOSER_CHARS = new Set(['"', '”', "'", '’', ')', ']'])

// A break character sitting right near the start of the remaining text (e.g. "Oh, praise the
// Lord...") produces a segment that reads as an orphaned scrap ("Oh," alone on its own line)
// rather than a deliberate line break — skip a candidate that short and keep scanning for a
// later one within budget instead. Expressed as a fraction of the width budget (not a fixed
// character count) since it has to scale with maxWidthPx/font size the same way the rest of
// this function's measurements do.
const MIN_SEGMENT_WIDTH_FRACTION = 0.3

/**
 * Wraps a single authored line (a song lyric line, never itself split by paginateTextUnits)
 * to fit within `maxWidthPx`, only if it actually needs to — an unchanged `[line]` is returned
 * whenever it already fits. When a break is unavoidable, it only ever breaks at the last
 * comma/semicolon/period/exclamation/question-mark that keeps the segment within width *and*
 * isn't suspiciously short (see MIN_SEGMENT_WIDTH_FRACTION) — never at a plain word boundary,
 * even if that means the line is left wider than `maxWidthPx`. That's deliberate: a mid-phrase
 * word-wrap reads worse on a lyric slide than an oversized line the auto-fit size search (see
 * SlideContentRenderer.vue) can instead avoid by not picking that size in the first place, now
 * that songs have a configurable minimum font size to search down to.
 *
 * `measureWidth` is injected (real canvas text measurement in SlideContentRenderer.vue; jsdom's
 * canvas has no real measurement backend, so tests pass a synthetic character-count-based one).
 */
export function wrapLineAtPunctuation(
  line: string,
  maxWidthPx: number,
  measureWidth: (text: string) => number,
): string[] {
  if (measureWidth(line) <= maxWidthPx) return [line]
  const result: string[] = []
  let remaining = line
  while (measureWidth(remaining) > maxWidthPx) {
    let punctuationBreak = -1
    for (let i = 0; i < remaining.length; i++) {
      const widthSoFar = measureWidth(remaining.slice(0, i + 1))
      if (widthSoFar > maxWidthPx) break
      if (BREAK_CHARS.has(remaining[i]) && widthSoFar >= maxWidthPx * MIN_SEGMENT_WIDTH_FRACTION) {
        punctuationBreak = i
      }
    }
    if (punctuationBreak === -1) {
      // No break character within budget past the minimum segment length — leave the rest of
      // the line intact rather than breaking mid-phrase at a word boundary or producing an
      // orphaned scrap of a line.
      result.push(remaining)
      remaining = ''
      break
    }
    let breakEnd = punctuationBreak + 1
    while (breakEnd < remaining.length && TRAILING_CLOSER_CHARS.has(remaining[breakEnd]!))
      breakEnd++
    result.push(remaining.slice(0, breakEnd).trimEnd())
    remaining = remaining.slice(breakEnd).trimStart()
  }
  if (remaining) result.push(remaining)
  return result
}
