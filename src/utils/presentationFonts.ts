export const bundledPresentationFonts = [
  { title: 'Inter', value: 'Inter Variable' },
  { title: 'Montserrat', value: 'Montserrat Variable' },
  { title: 'Source Sans 3', value: 'Source Sans 3 Variable' },
  { title: 'Source Serif 4', value: 'Source Serif 4 Variable' },
  { title: 'Oswald', value: 'Oswald Variable' },
  { title: 'Roboto Slab', value: 'Roboto Slab Variable' },
] as const

const bundledFontValues = new Set<string>(bundledPresentationFonts.map((option) => option.value))
const bundledFontAliases: Readonly<Record<string, string>> = {
  Inter: 'Inter Variable',
  Montserrat: 'Montserrat Variable',
  Georgia: 'Source Serif 4 Variable',
}

/** Keeps old known choices close to their original character and prevents any unbundled font
 * name from changing layout based on what happens to be installed on a particular computer. */
export function resolvePresentationFontFamily(font: string): string {
  if (bundledFontValues.has(font)) return font
  return bundledFontAliases[font] ?? 'Inter Variable'
}

/**
 * Quotes a resolved font-family value for actual CSS/Canvas use. Every bundled option's family
 * name has a space, and two of them ("Source Sans 3 Variable", "Source Serif 4 Variable") have a
 * bare digit as one of those space-separated words — not a valid unquoted CSS `<custom-ident>`
 * (an identifier token can't consist only of digits), so an inline `font-family: Source Sans 3
 * Variable` is invalid CSS and gets silently dropped by the browser, falling back to whatever
 * font was already inherited. Deliberately kept separate from resolvePresentationFontFamily's
 * own return value, which has to stay the plain unquoted name — it's also what's persisted on
 * Theme.font and matched against bundledPresentationFonts for the Font dropdown's selected
 * state, so quoting it there would corrupt saved themes and break that matching.
 */
export function cssFontFamily(family: string): string {
  return `"${family}"`
}
