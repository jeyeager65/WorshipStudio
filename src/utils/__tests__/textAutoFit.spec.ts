import { describe, expect, it } from 'vitest'
import { paginateTextUnits, wrapLineAtPunctuation } from '@/utils/textAutoFit'

// A synthetic, deterministic stand-in for real canvas text measurement (unavailable under
// jsdom) — one "pixel" per character keeps the math in these tests easy to reason about.
const charWidth = (text: string) => text.length

describe('paginateTextUnits', () => {
  it('returns a single empty page for no units', () => {
    expect(paginateTextUnits([], { minPx: 28, maxPx: 72 })).toEqual([[]])
  })

  it('keeps a short list of units on a single page', () => {
    const units = ['16 For God so loved the world...', '17 For God sent not his Son...']
    const pages = paginateTextUnits(units, { minPx: 28, maxPx: 72 })
    expect(pages).toEqual([units])
  })

  it('splits onto multiple pages without ever splitting a unit', () => {
    const units = Array.from({ length: 60 }, (_, i) => `${i + 1} ${'word '.repeat(40).trim()}`)
    const pages = paginateTextUnits(units, { minPx: 28, maxPx: 72 })
    expect(pages.length).toBeGreaterThan(1)
    // Every unit appears in exactly one page, in order, none dropped or duplicated.
    expect(pages.flat()).toEqual(units)
  })

  it('keeps a single unit too long to fit even at the minimum size on its own page', () => {
    const hugeUnit = 'word '.repeat(2000).trim()
    const pages = paginateTextUnits([hugeUnit, 'short unit'], { minPx: 28, maxPx: 72 })
    expect(pages[0]).toEqual([hugeUnit])
    expect(pages[1]).toEqual(['short unit'])
  })

  it('fits more units per page at a smaller minimum font size', () => {
    const units = Array.from(
      { length: 20 },
      (_, i) => `${i + 1} A modestly sized line of scripture text here.`,
    )
    const smallRangePages = paginateTextUnits(units, { minPx: 20, maxPx: 40 })
    const largeRangePages = paginateTextUnits(units, { minPx: 60, maxPx: 90 })
    expect(smallRangePages.length).toBeLessThan(largeRangePages.length)
  })
})

describe('wrapLineAtPunctuation', () => {
  it('leaves a line that already fits untouched', () => {
    expect(wrapLineAtPunctuation('Amazing grace, how sweet the sound', 100, charWidth)).toEqual([
      'Amazing grace, how sweet the sound',
    ])
  })

  it('breaks at the last comma that keeps the segment within width', () => {
    // "Amazing grace, how sweet the sound" is 35 chars; breaking at the comma (14 chars) fits
    // a width of 20, while breaking mid-phrase at a plain word boundary would not honor the
    // punctuation preference.
    const wrapped = wrapLineAtPunctuation('Amazing grace, how sweet the sound', 20, charWidth)
    expect(wrapped[0]).toBe('Amazing grace,')
    expect(wrapped.join(' ')).toBe('Amazing grace, how sweet the sound')
  })

  it('breaks at a semicolon the same way as a comma', () => {
    const wrapped = wrapLineAtPunctuation('Come now; let us reason together', 15, charWidth)
    expect(wrapped[0]).toBe('Come now;')
  })

  it('skips a break character too close to the start rather than orphaning a tiny first line', () => {
    // "Oh," alone (3 chars) is well under 30% of a 20-char budget — the algorithm should keep
    // scanning past it for the next comma instead of splitting there.
    const line = 'Oh, praise the Lord, for He is good'
    const wrapped = wrapLineAtPunctuation(line, 20, charWidth)
    expect(wrapped[0]).toBe('Oh, praise the Lord,')
  })

  it('breaks a repeated-sentence line at the exclamation point', () => {
    const line = 'Great is Thy faithfulness! Great is Thy faithfulness!'
    const wrapped = wrapLineAtPunctuation(line, 30, charWidth)
    expect(wrapped[0]).toBe('Great is Thy faithfulness!')
    expect(wrapped.join(' ')).toBe(line)
  })

  it('breaks at a period and a question mark too', () => {
    expect(wrapLineAtPunctuation('This is one. This is two', 15, charWidth)[0]).toBe(
      'This is one.',
    )
    expect(wrapLineAtPunctuation('Who is this King? He is the Lord', 20, charWidth)[0]).toBe(
      'Who is this King?',
    )
  })

  it('breaks at a colon and an em/en dash', () => {
    expect(wrapLineAtPunctuation('Remember this: God is faithful', 18, charWidth)[0]).toBe(
      'Remember this:',
    )
    expect(wrapLineAtPunctuation('All I have needed— Thy hand hath provided', 22, charWidth)[0]).toBe(
      'All I have needed—',
    )
  })

  it('never breaks at a plain hyphen inside a compound word', () => {
    // A bare "-" is excluded from the break set on purpose — unlike an em/en dash used as
    // punctuation, a hyphen in lyrics is overwhelmingly a compound-word joiner, and breaking
    // there would be exactly the mid-word wrap this function exists to avoid.
    const line = 'Well-being and self-control are gifts of the Spirit'
    expect(wrapLineAtPunctuation(line, 15, charWidth)).toEqual([line])
  })

  it('leaves a line intact when there is no punctuation to break at, even if it overflows', () => {
    // Never falls back to a plain word boundary — an oversized single line is preferred over
    // a mid-phrase wrap; the auto-fit size search is what's supposed to avoid this by picking
    // a size where the line fits in the first place.
    const line = 'How great is our God who sings over me'
    expect(wrapLineAtPunctuation(line, 15, charWidth)).toEqual([line])
  })

  it('produces multiple breaks for a line with several punctuation-separated clauses', () => {
    const line = 'Praise the Lord, oh my soul; sing to the King, forever and ever'
    const wrapped = wrapLineAtPunctuation(line, 25, charWidth)
    expect(wrapped.length).toBeGreaterThan(2)
    expect(wrapped.join(' ')).toBe(line)
    // Every break but the last segment falls right after a comma or semicolon, never mid-word.
    expect(wrapped.slice(0, -1).every((segment) => /[,;]$/.test(segment))).toBe(true)
  })

  it('leaves a single oversized word alone rather than looping forever', () => {
    const wrapped = wrapLineAtPunctuation('Supercalifragilisticexpialidocious', 10, charWidth)
    expect(wrapped).toEqual(['Supercalifragilisticexpialidocious'])
  })

  it('keeps a closing quote attached to the break instead of orphaning it on its own line', () => {
    // Reproduces a real reported bug: "Death is swallowed up in vict'ry!"" wrapped with the
    // closing curly quote left alone as its own line, because the break at "!" left only the
    // trailing "”" as the entire next segment.
    const line = '“Death is swallowed up in vict’ry!”'
    const wrapped = wrapLineAtPunctuation(line, 34, charWidth)
    expect(wrapped).toEqual([line])
  })

  it('keeps a closing quote attached even when it forces a break mid-quote', () => {
    const line = '“Great is Thy faithfulness!” he cried, and all the earth agreed'
    const wrapped = wrapLineAtPunctuation(line, 30, charWidth)
    expect(wrapped[0]).toBe('“Great is Thy faithfulness!”')
    expect(wrapped.some((segment) => segment.trim() === '”')).toBe(false)
  })
})
