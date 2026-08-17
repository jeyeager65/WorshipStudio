import type { SlideLibraryItem, MediaItem } from '@/models/library'
import type { LibraryCredentials, LibrarySettings, MachineSettings } from '@/models/settings'
import type { Announcement } from '@/models/announcement'
import {
  sampleSongs,
  samplePeople,
  sampleThemes,
  sampleCollections,
  sampleRoleGroups,
  sampleRoles,
  sampleServiceTypes,
  sampleServiceTemplates,
  buildSampleServices,
} from '@/utils/sampleData'

// The public GitHub Pages demo shares its content with the in-app "Load Sample Data" feature
// (src/utils/sampleData.ts) rather than maintaining a second hand-written dataset — both need
// the same thing: public-domain songs (no CCLI/copyright entanglement) and fabricated people
// (no real names). Services are built fresh (not a static array) so their dates stay relative
// to "today" instead of drifting into the past as a hardcoded date would.
export const seedSongs = sampleSongs
export const seedPeople = samplePeople
export const seedThemes = sampleThemes
export const seedServices = buildSampleServices()
export const seedSongCollections = structuredClone(sampleCollections)
export const seedServiceTypes = structuredClone(sampleServiceTypes)
export const seedRoleGroups = structuredClone(sampleRoleGroups)
export const seedRoles = structuredClone(sampleRoles)
export const seedServiceTemplates = structuredClone(sampleServiceTemplates)

export const seedSlides: SlideLibraryItem[] = []
// Empty by default, matching the desktop app's real "no reasonable default media" stance — the
// 6 real stock backgrounds are offered (not seeded automatically) via Settings > Data tools'
// "Add Stock Backgrounds" button, the same as the desktop app's Setup Wizard/Settings action.
export const seedMedia: MediaItem[] = []
export const seedAnnouncements: Announcement[] = []

export const seedLibraryCredentials: LibraryCredentials = {
  canvaIntegration: { clientId: '', clientSecret: '' },
  // The demo build never resolves the 'tablet' adapter kind — no cloud app registration to seed.
  dropboxIntegration: { appKey: '' },
  oneDriveIntegration: { clientId: '' },
  // The mock/demo adapter only ever resolves KJV (see scriptureFixtures.ts) — an ESV/api.bible
  // key here would be exactly the disconnected-Settings-vs-real-picker bug this model shape
  // exists to prevent, so the demo's seed data doesn't pretend otherwise.
}

export const seedLibrarySettings: LibrarySettings = {
  branding: {
    churchName: 'Worship Studio Church',
    primaryColor: '#1F3A5F',
    secondaryColor: '#C9A227',
  },
  apiBibleTranslations: [],
  defaultTranslationCode: 'KJV',
  mediaMaxSyncedFileSizeMb: 50,
  scriptureMinFontSizePx: 72,
  scriptureMaxFontSizePx: 120,
  songMinFontSizePx: 16,
  songMaxFontSizePx: 120,
  slideHeaderFontSizePx: 48,
  slideFooterFontSizePx: 48,
  wayfindingMinFontSizePx: 56,
  wayfindingMaxFontSizePx: 150,
  bulletin: {
    page1Title: 'Order of Worship',
    page2Title: 'Announcements',
    page1FooterTitle: 'Heart Preparation',
    page1FooterEnabled: true,
    page2FooterTitle: 'Thought to Ponder',
    page2FooterEnabled: true,
    page2Enabled: true,
    showAnnouncements: true,
    showServingSchedule: true,
    servingScheduleRoleIds: [],
  },
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
  remoteControlPort: undefined,
  remoteControlHostname: undefined,
  lastRemoteControlPort: undefined,
  canvaCallbackPort: undefined,
}
