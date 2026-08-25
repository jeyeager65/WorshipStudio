// Leading punctuation (quotes, apostrophes, parens, …) is invisible to alphabetizing — 'Tis So
// Sweet to Trust in Jesus files under T, not under the apostrophe. Leading digits are left
// alone (10,000 Reasons stays "10,000 Reasons") since a number isn't noise the way punctuation is.
const LEADING_PUNCTUATION = /^[^\p{L}\p{N}]+/u
// "A "/"The " is what a hymnal index also ignores — "The Old Rugged Cross" files under O, not T
// — even though the title is still displayed in full everywhere else.
const LEADING_ARTICLE = /^(a|the)\s+/i

export function sortTitle(title: string): string {
  return title.replace(LEADING_PUNCTUATION, '').replace(LEADING_ARTICLE, '').trim()
}
