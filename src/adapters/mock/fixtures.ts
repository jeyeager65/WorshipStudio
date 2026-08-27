import type { SlideLibraryItem, MediaItem, Theme } from '@/models/library'
import { stockBackgrounds, stockThemes } from '@/data/stockContent'
import { presentationThemeDefaults } from '@/utils/presentationTheme'
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
  withSampleUsageDates,
} from '@/utils/sampleData'
import { buildSampleAnnouncements } from '@/utils/sampleAnnouncements'
import { buildSampleSlides } from '@/utils/sampleSlides'

// The public GitHub Pages demo shares its content with the in-app "Load Sample Data" feature
// (src/utils/sampleData.ts) rather than maintaining a second hand-written dataset — both need
// the same thing: public-domain songs (no CCLI/copyright entanglement) and fabricated people
// (no real names). Services are built fresh (not a static array) so their dates stay relative
// to "today" instead of drifting into the past as a hardcoded date would.
const seedStamp = new Date().toISOString()

export const seedServices = buildSampleServices()
// Pre-populated from seedServices (rather than left empty like sampleSongs itself) so the
// public demo's very first render already shows real "last used"/"used Nx this year" figures —
// see withSampleUsageDates's own doc comment for why this differs from the in-app "Load Sample
// Data" flow, which fills usageDates in via the normal save path instead.
export const seedSongs = withSampleUsageDates(sampleSongs, seedServices)
export const seedPeople = samplePeople
/** The two sample themes plus the stock ones, which is what puts a real background behind real
 *  text — a theme with no background cannot demonstrate what themes are for.
 *
 *  Stock defaults are filtered against what the sample themes already claim, exactly as
 *  importStockBackgrounds does when adding stock content to a library that already has themes.
 *  Without that the demo would end up with two themes both defaulting for songs, which is the one
 *  state the real import goes out of its way never to create. The result is all four presentation
 *  targets covered by four different backgrounds. */
const claimedDefaults = new Set(sampleThemes.flatMap(presentationThemeDefaults))

export const seedThemes: Theme[] = [
  ...sampleThemes,
  ...stockThemes.map((stock) => ({
    id: stock.id,
    name: stock.name,
    backgroundId: stock.backgroundMediaId,
    font: stock.font,
    textColor: stock.textColor,
    outline: true,
    appliesTo: [],
    useAsDefaultFor: stock.intendedDefaults.filter((target) => !claimedDefaults.has(target)),
    updatedAt: seedStamp,
    updatedByDevice: 'sample-data',
  })),
]

export const seedSongCollections = structuredClone(sampleCollections)
export const seedServiceTypes = structuredClone(sampleServiceTypes)
export const seedRoleGroups = structuredClone(sampleRoleGroups)
export const seedRoles = structuredClone(sampleRoles)
export const seedServiceTemplates = structuredClone(sampleServiceTemplates)

// A pre-service announcement loop and a giving slide. Seeded (unlike media) because slides are
// self-contained scene data with no backing file to be missing — leaving the Slide Library empty
// meant the Slides page and the whole native editor behind it demonstrated nothing.
export const seedSlides: SlideLibraryItem[] = buildSampleSlides()

/** The 6 bundled stock backgrounds, seeded rather than offered.
 *
 *  The desktop app deliberately starts with no media — a real church's library should not arrive
 *  pre-filled with images nobody chose. That reasoning does not transfer to the demo, whose entire
 *  job is to show the app working: an empty Media page, themes with no backgrounds behind their
 *  text, and a Themes page that cannot show what a background even does. Reaching that state
 *  required knowing to press "Add Stock Backgrounds" in Settings, which nobody evaluating the app
 *  would think to look for.
 *
 *  Built from the same `stockContent` catalogue the real import uses, so the ids match what
 *  `getPreviewUrl` serves from public/stock-backgrounds/ (adapters/mock/index.ts) — the files are
 *  genuinely there, unlike a fabricated media item would be. */
export const seedMedia: MediaItem[] = stockBackgrounds.map((background) => ({
  id: background.id,
  filename: background.filename,
  title: background.title,
  kind: 'image',
  tags: ['Background', 'Stock'],
  location: 'synced',
  // No real file to hash here — the demo serves these as static assets rather than importing
  // them, so this mirrors the placeholder the mock's own importStockBackgrounds() writes.
  contentHash: `stock:${background.id}`,
  usage: {},
  updatedAt: seedStamp,
  updatedByDevice: 'sample-data',
}))
// Built fresh like services, and for the same reason with more force: announcementVisibility.ts
// filters out anything whose dates have passed, so hardcoded ones would leave page 2 of the
// bulletin silently empty a few weeks on — a demo failing in a way that looks like a broken feature.
export const seedAnnouncements: Announcement[] = buildSampleAnnouncements()

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
  fontSizesPx: {
    scripture: { min: 72, max: 120 },
    song: { min: 16, max: 120 },
    slide: { header: 48, footer: 48 },
    wayfinding: { min: 56, max: 150 },
  },
  bulletin: {
    page1: {
      title: 'Order of Worship',
      footer: { title: 'Heart Preparation', enabled: true },
    },
    page2: {
      enabled: true,
      title: 'Announcements',
      footer: { title: 'Thought to Ponder', enabled: true },
      announcements: { enabled: true },
      servingSchedule: { enabled: true, roleIds: [] },
    },
  },
}

export const seedMachineSettings: MachineSettings = {
  thisComputerName: 'Demo Machine',
  darkMode: true,
  libraryPath: '',
  // The demo build's sample data (above) stands in for the wizard's library import, so
  // there's no reason to make an evaluator click through it before seeing the app.
  hasCompletedSetup: true,
  // Empty: the demo has no displays port (it presents into a browser window, not onto a monitor),
  // so roles here would name displays that do not exist.
  displayRoles: {},
  remoteControlPort: undefined,
  remoteControlHostname: undefined,
  lastRemoteControlPort: undefined,
  canvaCallbackPort: undefined,
}
