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

export interface Volunteer {
  id: string
  firstName: string
  lastName: string
  email?: string
  /** Not a restriction — just makes this volunteer show up first when filling roster fields for these roles. */
  preferredRoles: string[]
  unavailableDateRanges: UnavailableDateRange[]
  updatedAt: string
  updatedByDevice: string
}
