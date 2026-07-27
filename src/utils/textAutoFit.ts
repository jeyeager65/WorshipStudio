export interface FontSizeRange {
  minPx: number
  maxPx: number
}

// Reference box pagination decisions are estimated against — a representative widescreen
// presentation area, not the actual audience display's real resolution (only known once a
// specific monitor is live, per Display Setup — see design/feature-spec.md's aspect-ratio
// note). This only decides *how many slides* a passage/block splits into; PresentationView
// separately measures its own real container and shrinks-to-fit within the same font range,
// so an imprecise estimate here only risks a slightly suboptimal split, never lost or
// cut-off content.
const REFERENCE_BOX_WIDTH_PX = 1728
const REFERENCE_BOX_HEIGHT_PX = 800

// Average glyph width as a fraction of font size, for a bold sans-serif — used to estimate
// word-wrap without a real canvas/font-metrics call (this needs to run identically in tests
// and in the app, and jsdom's canvas has no real text-measurement backend).
const AVG_CHAR_WIDTH_RATIO = 0.55
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
    .reduce((total, line) => total + estimateWrappedLineCount(line, fontSizePx, REFERENCE_BOX_WIDTH_PX), 0)
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
export function paginateTextUnits(units: string[], range: FontSizeRange, separator: string = ' '): string[][] {
  if (units.length === 0) return [[]]
  const pages: string[][] = []
  let currentPage: string[] = []
  for (const unit of units) {
    const candidate = [...currentPage, unit]
    const fits = estimateBlockHeightPx(candidate.join(separator), range.minPx) <= REFERENCE_BOX_HEIGHT_PX
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

/**
 * Wraps a single authored line (a song lyric line, never itself split by paginateTextUnits)
 * to fit within `maxWidthPx`, only if it actually needs to — an unchanged `[line]` is returned
 * whenever it already fits. When a break is unavoidable, it only ever breaks at the last comma
 * or semicolon that keeps the segment within width (a natural pause point) — never at a plain
 * word boundary, even if that means the line is left wider than `maxWidthPx`. That's
 * deliberate: a mid-phrase word-wrap reads worse on a lyric slide than an oversized line the
 * auto-fit size search (see PresentationView) can instead avoid by not picking that size in
 * the first place, now that songs have a configurable minimum font size to search down to.
 *
 * `measureWidth` is injected (real canvas text measurement in PresentationView; jsdom's canvas
 * has no real measurement backend, so tests pass a synthetic character-count-based one).
 */
export function wrapLineAtPunctuation(line: string, maxWidthPx: number, measureWidth: (text: string) => number): string[] {
  if (measureWidth(line) <= maxWidthPx) return [line]
  const result: string[] = []
  let remaining = line
  while (measureWidth(remaining) > maxWidthPx) {
    let punctuationBreak = -1
    for (let i = 0; i < remaining.length; i++) {
      if (measureWidth(remaining.slice(0, i + 1)) > maxWidthPx) break
      const ch = remaining[i]
      if (ch === ',' || ch === ';') punctuationBreak = i
    }
    if (punctuationBreak === -1) {
      // No comma/semicolon within budget — leave the rest of the line intact rather than
      // breaking mid-phrase at a word boundary.
      result.push(remaining)
      remaining = ''
      break
    }
    result.push(remaining.slice(0, punctuationBreak + 1).trimEnd())
    remaining = remaining.slice(punctuationBreak + 1).trimStart()
  }
  if (remaining) result.push(remaining)
  return result
}
