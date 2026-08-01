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
