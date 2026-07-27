import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme, Volunteer } from '@/models/library'
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
export const seedMedia: MediaItem[] = [
  {
    id: 'media-worship-hands-sunset',
    filename: 'worship-hands-sunset.jpg',
    kind: 'image',
    tags: ['Worship'],
    location: 'synced',
    contentHash: 'seed-1',
    usage: { usesPastYear: 8, lastUsedAt: now },
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'media-gentle-water-loop',
    filename: 'gentle-water-loop.mp4',
    kind: 'video',
    tags: ['Nature'],
    location: 'synced',
    contentHash: 'seed-2',
    usage: { usesPastYear: 5, lastUsedAt: now },
    updatedAt: now,
    updatedByDevice: device,
  },
]
export const seedThemes: Theme[] = []
export const seedVolunteers: Volunteer[] = [
  {
    id: 'volunteer-marlene',
    firstName: 'Marlene',
    lastName: 'Diaz',
    email: 'marlene.diaz@email.com',
    preferredRoles: ['Piano'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
  {
    id: 'volunteer-mark',
    firstName: 'Mark',
    lastName: 'Ellison',
    preferredRoles: ['Drums'],
    unavailableDateRanges: [],
    updatedAt: now,
    updatedByDevice: device,
  },
]

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
  // The mock/demo adapter only ever resolves KJV (see scriptureFixtures.ts) — an ESV/api.bible
  // entry here would be exactly the disconnected-Settings-vs-real-picker bug this model shape
  // exists to prevent, so the demo's seed data doesn't pretend otherwise.
  apiBibleTranslations: [],
  defaultTranslationCode: 'KJV',
  mediaMaxSyncedFileSizeMb: 50,
  scriptureMinFontSizePx: 28,
  scriptureMaxFontSizePx: 72,
  songMinFontSizePx: 16,
  songMaxFontSizePx: 72,
  slideHeaderFontSizePx: 24,
  slideFooterFontSizePx: 24,
}

export const seedMachineSettings: MachineSettings = {
  thisComputerName: 'Demo Machine',
  darkMode: true,
  libraryPath: '',
  // The demo build's sample data (above) stands in for the wizard's library import, so
  // there's no reason to make an evaluator click through it before seeing the app.
  hasCompletedSetup: true,
  localMediaPath: '',
  displayRoles: { 'display-1': 'operator', 'display-2': 'audience' },
}
