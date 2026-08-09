import { describe, expect, it } from 'vitest'
import { cssFontFamily, resolvePresentationFontFamily } from '@/utils/presentationFonts'

describe('presentation fonts', () => {
  it('keeps bundled font families unchanged', () => {
    expect(resolvePresentationFontFamily('Oswald Variable')).toBe('Oswald Variable')
  })

  it('maps the old serif option to the bundled serif family', () => {
    expect(resolvePresentationFontFamily('Georgia')).toBe('Source Serif 4 Variable')
  })

  it('falls unknown system fonts back to a bundled family', () => {
    expect(resolvePresentationFontFamily('Some Font Installed On One PC')).toBe('Inter Variable')
  })
})

describe('cssFontFamily', () => {
  // Regression coverage: an unquoted "Source Sans 3 Variable"/"Source Serif 4 Variable" is
  // invalid CSS (a bare digit isn't a valid unquoted <custom-ident>), so the browser silently
  // drops the whole font-family declaration — this is what makes those two options actually
  // render, unlike the other bundled fonts which happened to work unquoted since none of their
  // names contain a digit.
  it('wraps a font-family value in quotes for CSS/Canvas use', () => {
    expect(cssFontFamily('Source Sans 3 Variable')).toBe('"Source Sans 3 Variable"')
    expect(cssFontFamily('Source Serif 4 Variable')).toBe('"Source Serif 4 Variable"')
    expect(cssFontFamily('Inter Variable')).toBe('"Inter Variable"')
  })
})
