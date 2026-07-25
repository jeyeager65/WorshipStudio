import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme } from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

const now = new Date().toISOString()
const device = 'demo-machine'

export const seedSongs: Song[] = [
  {
    id: 'song-amazing-grace',
    title: 'Amazing Grace',
    author: 'John Newton',
    collections: [{ collectionId: 'Hymns of Grace', number: '184' }],
    tags: ['hymn', 'grace'],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Amazing grace, how sweet the sound\nThat saved a wretch like me.' },
      { id: 'v2', label: 'Verse 2', text: "T'was grace that taught my heart to fear,\nand grace my fears relieved." },
    ],
    defaultArrangement: { sequence: ['v1', 'v2'] },
    usage: { usesPastYear: 3, lastUsedAt: now },
    updatedAt: now,
    updatedByDevice: device,
  },
]

export const seedServices: Service[] = [
  {
    id: 'service-2026-07-19',
    date: '2026-07-19',
    type: 'Sunday Morning Worship',
    preacher: 'Pastor Sample',
    sermonTitle: 'Sample Sermon',
    items: [
      { id: 'item-1', type: 'song', songId: 'song-amazing-grace', arrangement: { sequence: ['v1', 'v2'] } },
      { id: 'item-2', type: 'scripture', reference: 'John 3:16-17', translation: 'ESV', displayMode: 'full' },
    ],
    updatedAt: now,
    updatedByDevice: device,
  },
]

export const seedSlides: SlideLibraryItem[] = []
export const seedMedia: MediaItem[] = []
export const seedThemes: Theme[] = []

export const seedLibrarySettings: LibrarySettings = {
  serviceTypes: ['Sunday Morning Worship', 'Wednesday Bible Study'],
  preachers: ['Pastor Sample'],
  collections: ['Hymns of Grace'],
  volunteerRoles: ['Piano', 'Guitar', 'Vocals', 'Sound Booth'],
  branding: {
    churchName: 'Sample Church',
    primaryColor: '#1F3A5F',
    secondaryColor: '#C9A227',
  },
  bibleTranslations: [{ code: 'ESV', source: 'api-esv', label: 'English Standard Version' }],
  defaultTranslationCode: 'ESV',
  mediaMaxSyncedFileSizeMb: 50,
}

export const seedMachineSettings: MachineSettings = {
  thisComputerName: 'Demo Machine',
  darkMode: true,
  libraryPath: '',
}
