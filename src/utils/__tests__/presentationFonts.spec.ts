import { describe, expect, it } from 'vitest'
import { resolvePresentationFontFamily } from '@/utils/presentationFonts'

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
