// '#' collects anything that doesn't start with a letter (numbers, punctuation, empty), same as
// the iOS/macOS Contacts index — it's always present in the rail so that bucket has a home even
// when nothing occupies it yet.
export const ALPHABET_INDEX_LETTERS = [
  '#',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
]

export function indexLetterFor(key: string): string {
  const first = key.trim().charAt(0).toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : '#'
}

export interface AlphabetGroup<T> {
  letter: string
  items: T[]
}

// Scrolls `container` so `heading` sits at the top of its scrollport.
//
// The letter headings are `position: sticky`, and a sticky element reports its *pinned* position
// through offsetTop (and getBoundingClientRect) once the list has scrolled — every heading above
// the fold reports the same stuck offset rather than where it actually lives. Both the obvious
// implementations therefore fail in the same direction: scrollIntoView decides it has nothing to
// do, and offsetTop arithmetic computes "you're already there". The visible symptom is a rail
// that scrolls down but never back up.
//
// The element right after a heading is that group's first row, which is not sticky and so still
// reports a true layout position. Subtracting the heading's own height and the list's row gap
// recovers the heading's real top from it.
export function scrollToIndexHeading(container: HTMLElement, heading: HTMLElement): void {
  const firstRow = heading.nextElementSibling as HTMLElement | null
  const rowGap = parseFloat(getComputedStyle(container).rowGap) || 0
  const naturalTop = firstRow
    ? firstRow.offsetTop - heading.offsetHeight - rowGap
    : heading.offsetTop
  container.scrollTop = Math.max(0, naturalTop - container.offsetTop)
}

// Assumes `items` is already sorted by `keyFn` — same-letter items are always consecutive, so a
// single pass can build the groups without a second sort pass or a Map.
export function groupByIndexLetter<T>(items: T[], keyFn: (item: T) => string): AlphabetGroup<T>[] {
  const groups: AlphabetGroup<T>[] = []
  for (const item of items) {
    const letter = indexLetterFor(keyFn(item))
    const current = groups[groups.length - 1]
    if (current?.letter === letter) current.items.push(item)
    else groups.push({ letter, items: [item] })
  }
  return groups
}
