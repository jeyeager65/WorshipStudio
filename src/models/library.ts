import type { SongBlock } from './song'

export interface SlideLibraryItem {
  id: string
  label: string
  slides: SongBlock[]
  backgroundId?: string
  loop?: {
    enabled: boolean
    secondsPerSlide: number
    countdownOverlay?: { targetTime: string }
  }
  usage: {
    lastUsedAt?: string
    usesPastYear: number
  }
  updatedAt: string
  updatedByDevice: string
}

export interface MediaItem {
  id: string
  filename: string
  kind: 'image' | 'video'
  tags: string[]
  location: 'synced' | 'local'
  duplicateOfId?: string
  /** Non-cryptographic content hash used only to notice accidental duplicate imports. */
  contentHash: string
  usage: {
    lastUsedAt?: string
    usesPastYear: number
  }
  updatedAt: string
  updatedByDevice: string
}

export interface Theme {
  id: string
  name: string
  backgroundId?: string
  font: string
  textColor: string
  outline: boolean
  useAsDefaultFor: Array<'songs' | 'scripture' | 'announcements' | 'welcome-closing'>
  updatedAt: string
  updatedByDevice: string
}

export interface UnavailableDateRange {
  start: string
  end: string
}

export interface Person {
  id: string
  firstName: string
  lastName: string
  /** How this person's name should appear elsewhere in the app (e.g. "Mike Smith" for Michael
   *  Smith, or "Pastor Dan" for Daniel Renno) — falls back to first + last name when unset. */
  displayName?: string
  email?: string
  /** Not a restriction — just makes this person show up first when filling roles for these. */
  preferredRoles: string[]
  unavailableDateRanges: UnavailableDateRange[]
  updatedAt: string
  updatedByDevice: string
}

export function personDisplayName(person: Person): string {
  return person.displayName || `${person.firstName} ${person.lastName}`
}

/** Sorts people with `role` in their preferredRoles first — a hint for filling pickers faster,
 *  never a restriction on who can be picked (anyone remains selectable, just further down). */
export function sortByPreferredRole<T extends Person>(people: T[], role: string): T[] {
  return [...people].sort((a, b) => Number(b.preferredRoles.includes(role)) - Number(a.preferredRoles.includes(role)))
}
