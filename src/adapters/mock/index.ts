import type {
  StudioAdapter,
  ScripturePassage,
  RemoteDevice,
  SyncStatus,
  StagedMediaFile,
  MediaImportCommit,
  DiagnosticSummary,
  ExternalAppProfile,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service, ServiceTemplate } from '@/models/service'
import type { MediaItem, Theme } from '@/models/library'
import type {
  SongCollectionDefinition,
  ServiceTypeDefinition,
  RoleGroupDefinition,
  RoleDefinition,
} from '@/models/settings'
import { MockCollection, MockSingleton } from './collection'
import { affectedSongIds, applyServiceUsageChange, songIdsInService } from '@/utils/songUsage'
import { stockBackgrounds, stockThemes } from '@/data/stockContent'
import { presentationThemeDefaults } from '@/utils/presentationTheme'
import {
  seedSongs,
  seedServices,
  seedSlides,
  seedMedia,
  seedThemes,
  seedSongCollections,
  seedServiceTypes,
  seedRoleGroups,
  seedRoles,
  seedServiceTemplates,
  seedPeople,
  seedAnnouncements,
  seedLibrarySettings,
  seedLibraryCredentials,
  seedMachineSettings,
} from './fixtures'
import { parseOpenSongXml } from './opensongParser'
import { pickFilesInBrowser } from './pickFiles'
import { availableTranslations, loadKjv } from './scriptureFixtures'
import { generateQrCodeDataUrl } from '@/utils/qrCode'
import { buildDefaultExternalAppProfiles } from '@/utils/externalAppDefaults'
import { createLiveAudienceWindowPort } from '@/utils/liveAudienceWindow'
import {
  formatReference,
  getBookNames,
  isValidReference,
  parseReference,
} from '@/utils/scriptureReference'

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function nowStamp() {
  return { updatedAt: new Date().toISOString(), updatedByDevice: 'demo-machine' }
}

// Incrementally updates every affected song's usageDates for one service being saved or
// deleted, mirroring songs::update_usage_dates_for_service (Rust) instead of a full-library
// recompute — see utils/songUsage.ts. `oldService` is the previously saved version (undefined
// for a brand new service), `newService` the version now being saved (undefined when the
// service is being deleted).
async function updateUsageDatesForService(
  songs: MockCollection<Song>,
  serviceId: string,
  oldService: Service | undefined,
  newService: Service | undefined,
) {
  const ids = affectedSongIds(oldService, newService)
  const newSongIds = newService ? songIdsInService(newService) : new Set<string>()
  for (const id of ids) {
    const song = (await songs.get(id)) as Song | undefined
    if (!song) continue
    const desiredDate = newService && newSongIds.has(id) ? newService.date : undefined
    const updated = applyServiceUsageChange(song, serviceId, desiredDate)
    if (updated) await songs.save({ ...updated, ...nowStamp() })
  }
}

export function createMockAdapter(): StudioAdapter {
  const songs = new MockCollection('songs', seedSongs)
  const services = new MockCollection('services', seedServices)
  const slides = new MockCollection('slides', seedSlides)
  const media = new MockCollection('media', seedMedia)
  const themes = new MockCollection('themes', seedThemes)
  const songCollections = new MockCollection<SongCollectionDefinition>(
    'song-collections',
    seedSongCollections,
  )
  const serviceTypes = new MockCollection<ServiceTypeDefinition>('service-types', seedServiceTypes)
  const roleGroups = new MockCollection<RoleGroupDefinition>('role-groups', seedRoleGroups)
  const roles = new MockCollection<RoleDefinition>('roles', seedRoles)
  const serviceTemplates = new MockCollection<ServiceTemplate>(
    'service-templates',
    seedServiceTemplates,
  )
  const people = new MockCollection('people', seedPeople)
  const announcements = new MockCollection('announcements', seedAnnouncements)
  const externalAppProfiles = new MockCollection<ExternalAppProfile>('external-app-profiles', [])

  const librarySettingsStore = new MockSingleton('library-settings', seedLibrarySettings)
  const credentialsStore = new MockSingleton('credentials', seedLibraryCredentials)
  const machineSettingsStore = new MockSingleton('machine-settings', seedMachineSettings)
  // Real hardware enumeration would refresh id/name/resolution from the OS each time and
  // look up only the role from per-machine storage; the mock's "hardware" is fake and
  // stable either way, so persisting the whole record is equivalent and simpler.
  const mockRemoteDevices: RemoteDevice[] = []
  // Staged-but-not-yet-committed File objects from pickFilesToImport, keyed by the synthetic
  // "path" handed back to the caller — there's no real filesystem path in the browser demo,
  // so this in-memory map stands in for one between staging and commitImport.
  const stagedMediaFiles = new Map<string, File>()

  // 'document' is the fallback for anything that isn't image/video — e.g. a PowerPoint deck
  // imported for use with an External App Hand-off item (before "document" existed, this fell
  // back to "image" for literally anything that wasn't a video, same bug the web/Tauri adapters
  // had until "document" was added there too).
  function guessMediaKind(file: File): 'image' | 'video' | 'document' {
    if (file.type.startsWith('video')) return 'video'
    if (file.type.startsWith('image')) return 'image'
    return 'document'
  }
  // Name+size stands in for a real content hash here — good enough to catch an obviously
  // re-picked file in a demo, not meant to be cryptographically meaningful.
  function fakeContentHash(file: File): string {
    return `${file.name}:${file.size}`
  }
  function titleFromFilename(filename: string): string {
    return filename.replace(/\.[^.]+$/, '')
  }
  // Real bytes for a committed item, kept only in memory (never JSON-serialized/persisted —
  // see MockCollection's localStorage-based persistence) so the Media Library grid can show a
  // real thumbnail for anything imported this session. Revoked on delete; there's no other
  // cleanup opportunity in a browser demo (no app-close hook to rely on either way).
  const mediaPreviewUrls = new Map<string, string>()
  // Same idea as mediaPreviewUrls, but for the Import Media dialog's own review rows — created
  // lazily per staged path the first time it's asked for, rather than eagerly for every staged
  // file, since not every staged file necessarily gets its preview shown before the dialog
  // closes.
  const stagedPreviewUrls = new Map<string, string>()

  async function importOpenSongXml(xml: string): Promise<Song> {
    const parsed = parseOpenSongXml(xml)
    const song: Song = {
      id: newId('song'),
      title: parsed.title,
      author: parsed.author,
      copyright: parsed.copyright,
      ccli: parsed.ccli,
      collections: [],
      tags: [],
      blocks: parsed.blocks,
      defaultArrangement: parsed.arrangement,
      usageDates: [],
      ...nowStamp(),
    }
    await songs.save(song)
    return song
  }

  async function mockDiagnosticSummary(): Promise<DiagnosticSummary> {
    const [songItems, serviceItems, slideItems, mediaItems, themeItems, peopleItems] =
      await Promise.all([
        songs.list(),
        services.list(),
        slides.list(),
        media.list(),
        themes.list(),
        people.list(),
      ])
    return {
      generatedAt: new Date().toISOString(),
      appVersion: 'Browser demo',
      buildProfile: 'development',
      platform: navigator.platform || 'browser',
      architecture: 'browser',
      installationMode: 'browser-demo',
      setupComplete: true,
      libraryReadable: true,
      libraryItems: {
        songs: songItems.length,
        services: serviceItems.length,
        slides: slideItems.length,
        media: mediaItems.length,
        themes: themeItems.length,
        people: peopleItems.length,
      },
      lastLibraryChangeAt: new Date().toISOString(),
      syncConflictCount: 0,
      recoveryIssueCount: 0,
      displayAssignmentCount: 2,
      remotePortMode: 'unavailable',
      logFileCount: 0,
      logBytes: 0,
    }
  }

  return {
    kind: 'mock',
    songs: {
      list: () => songs.list() as Promise<Song[]>,
      get: (id) => songs.get(id) as Promise<Song | undefined>,
      save: (song) => songs.save({ ...song, ...nowStamp() }),
      delete: (id) => songs.delete(id),
      importFromOpenSongXml: importOpenSongXml,
      importFromOpenSongFiles: async () => {
        const files = await pickFilesInBrowser()
        const created: Song[] = []
        for (const file of files) {
          created.push(await importOpenSongXml(await file.text()))
        }
        return created
      },
    },
    services: {
      list: () => services.list() as Promise<Service[]>,
      get: (id) => services.get(id) as Promise<Service | undefined>,
      save: async (service) => {
        const oldService = (await services.get(service.id)) as Service | undefined
        const stamped: Service = { ...service, ...nowStamp() }
        await services.save(stamped)
        await updateUsageDatesForService(songs, stamped.id, oldService, stamped)
      },
      delete: async (id) => {
        const oldService = (await services.get(id)) as Service | undefined
        await services.delete(id)
        if (oldService) await updateUsageDatesForService(songs, id, oldService, undefined)
      },
      listUpcoming: async (fromDate, toDate) => {
        const all = (await services.list()) as Service[]
        return all.filter((s) => s.date >= fromDate && s.date <= toDate)
      },
    },
    slides: {
      list: () => slides.list(),
      get: (id) => slides.get(id),
      save: (item) => slides.save({ ...item, ...nowStamp() }),
      delete: (id) => slides.delete(id),
      generateQrCode: (content) => generateQrCodeDataUrl(content),
    },
    media: {
      list: () => media.list() as Promise<MediaItem[]>,
      save: (item) => media.save({ ...item, ...nowStamp() }),
      pickFilesToImport: async (extensions): Promise<StagedMediaFile[]> => {
        const files = await pickFilesInBrowser(extensions)
        const existing = (await media.list()) as MediaItem[]
        const staged: StagedMediaFile[] = []
        for (const file of files) {
          const path = `mock-file-${crypto.randomUUID()}`
          stagedMediaFiles.set(path, file)
          const hash = fakeContentHash(file)
          const duplicate = existing.find((item) => item.contentHash === hash)
          staged.push({
            path,
            filename: file.name,
            sizeBytes: file.size,
            kind: guessMediaKind(file),
            duplicateOfId: duplicate?.id,
            duplicateOfFilename: duplicate?.filename,
          })
        }
        return staged
      },
      getStagedPreviewUrl: async (path) => {
        const cached = stagedPreviewUrls.get(path)
        if (cached) return cached
        const file = stagedMediaFiles.get(path)
        if (!file) return undefined
        const url = URL.createObjectURL(file)
        stagedPreviewUrls.set(path, url)
        return url
      },
      commitImport: async (files: MediaImportCommit[]) => {
        const created: MediaItem[] = []
        for (const file of files) {
          const source = stagedMediaFiles.get(file.path)
          stagedMediaFiles.delete(file.path)
          const item: MediaItem = {
            id: newId('media'),
            filename: file.filename,
            title: file.title.trim() || titleFromFilename(file.filename),
            description: file.description,
            kind: source ? guessMediaKind(source) : 'image',
            tags: file.tags,
            location: file.location,
            duplicateOfId: file.duplicateOfId,
            contentHash: source ? fakeContentHash(source) : newId('hash'),
            usage: {},
            ...nowStamp(),
          }
          if (source) mediaPreviewUrls.set(item.id, URL.createObjectURL(source))
          await media.save(item)
          created.push(item)
        }
        return created
      },
      detectDuplicates: async (item) => {
        const all = (await media.list()) as MediaItem[]
        return all.filter((other) => other.id !== item.id && other.contentHash === item.contentHash)
      },
      delete: async (id) => {
        const url = mediaPreviewUrls.get(id)
        if (url) {
          URL.revokeObjectURL(url)
          mediaPreviewUrls.delete(id)
        }
        await media.delete(id)
      },
      getPreviewUrl: async (id) => {
        // Resolved fresh from the static path every call, not cached in the in-session-only
        // mediaPreviewUrls map below — a blob: URL never survives a page reload, but these are
        // permanently bundled static files, so there's no need to depend on session memory at
        // all (matches the Tauri adapter, which also resolves fresh on every call rather than
        // caching). Still gated on the record actually existing, so a deleted stock item
        // correctly stops resolving instead of resurrecting its old preview.
        const stock = stockBackgrounds.find((background) => background.id === id)
        if (stock && (await media.get(id))) {
          return `${import.meta.env.BASE_URL}stock-backgrounds/${stock.filename}`
        }
        return mediaPreviewUrls.get(id)
      },
      importStockBackgrounds: async () => {
        const existingMedia = (await media.list()) as MediaItem[]
        let mediaAdded = 0
        for (const background of stockBackgrounds) {
          if (existingMedia.some((item) => item.id === background.id)) continue
          const item: MediaItem = {
            id: background.id,
            filename: background.filename,
            title: background.title,
            kind: 'image',
            tags: ['Background', 'Stock'],
            location: 'synced',
            // No real file to hash — this never goes through the fetch/File import path (see
            // getPreviewUrl above), so this is just a stable per-id placeholder, distinct
            // enough that it won't collide with a real import's hash.
            contentHash: `stock:${background.id}`,
            usage: {},
            ...nowStamp(),
          }
          await media.save(item)
          mediaAdded++
        }

        // Snapshotted once before the loop (not updated as stock themes get saved below) — same
        // "only fills gaps present before this run started" behavior as the Rust import command.
        const existingThemes = (await themes.list()) as Theme[]
        const claimedDefaults = new Set(existingThemes.flatMap(presentationThemeDefaults))
        let themesAdded = 0
        for (const stockTheme of stockThemes) {
          if (existingThemes.some((theme) => theme.id === stockTheme.id)) continue
          const theme: Theme = {
            id: stockTheme.id,
            name: stockTheme.name,
            backgroundId: stockTheme.backgroundMediaId,
            font: stockTheme.font,
            textColor: stockTheme.textColor,
            outline: true,
            appliesTo: [],
            useAsDefaultFor: stockTheme.intendedDefaults.filter(
              (target) => !claimedDefaults.has(target),
            ),
            ...nowStamp(),
          }
          await themes.save(theme)
          themesAdded++
        }

        return { mediaAdded, themesAdded }
      },
    },
    themes: {
      list: () => themes.list(),
      save: (theme) => themes.save({ ...theme, ...nowStamp() }),
      delete: (id) => themes.delete(id),
    },
    songCollections: {
      list: () => songCollections.list(),
      // No updatedAt/updatedByDevice stamp -- unlike per-item content types, this whole small
      // array-shaped file has no per-item audit fields (see SongCollectionDefinition's own
      // doc comment); a real conflict on it is resolved at the whole-file level, same as any
      // other singleton settings file.
      save: async (collection) => {
        await songCollections.save(collection)
        return collection
      },
      delete: (id) => songCollections.delete(id),
    },
    serviceTypes: {
      list: () => serviceTypes.list(),
      save: async (serviceType) => {
        await serviceTypes.save(serviceType)
        return serviceType
      },
      delete: (id) => serviceTypes.delete(id),
    },
    roleGroups: {
      list: () => roleGroups.list(),
      save: async (roleGroup) => {
        await roleGroups.save(roleGroup)
        return roleGroup
      },
      delete: (id) => roleGroups.delete(id),
    },
    roles: {
      list: () => roles.list(),
      save: async (role) => {
        await roles.save(role)
        return role
      },
      delete: (id) => roles.delete(id),
    },
    serviceTemplates: {
      list: () => serviceTemplates.list(),
      save: async (serviceTemplate) => {
        await serviceTemplates.save(serviceTemplate)
        return serviceTemplate
      },
      delete: (id) => serviceTemplates.delete(id),
    },
    people: {
      list: () => people.list(),
      save: (person) => people.save({ ...person, ...nowStamp() }),
      delete: async (id) => {
        await people.delete(id)
        for (let index = mockRemoteDevices.length - 1; index >= 0; index -= 1) {
          if (mockRemoteDevices[index]?.personId === id) mockRemoteDevices.splice(index, 1)
        }
      },
    },
    announcements: {
      list: () => announcements.list(),
      save: (announcement) => announcements.save({ ...announcement, ...nowStamp() }),
      delete: (id) => announcements.delete(id),
    },
    settings: {
      getLibrarySettings: () => librarySettingsStore.get(),
      saveLibrarySettings: (next) => librarySettingsStore.save(next),
      getLibraryCredentials: () => credentialsStore.get(),
      saveLibraryCredentials: (next) => credentialsStore.save(next),
      getMachineSettings: () => machineSettingsStore.get(),
      saveMachineSettings: (next) => machineSettingsStore.save(next),
      // No real filesystem to pick a folder from in the browser demo.
      pickLibraryFolder: async () => undefined,
      // MockCollection has no on-disk .backup concept at all — nothing to clear.
      clearSettingsListBackups: async () => {},
    },
    scripture: {
      resolve: async (reference, translation): Promise<ScripturePassage> => {
        const parsed = parseReference(reference)
        if (!parsed || !isValidReference(parsed))
          throw new Error(`"${reference}" isn't a valid scripture reference.`)

        const kjv = await loadKjv()
        const bookData = kjv[parsed.book]
        const verses: ScripturePassage['verses'] = []
        for (let chapter = parsed.startChapter; chapter <= parsed.endChapter; chapter++) {
          const verseFrom = chapter === parsed.startChapter ? parsed.startVerse : 1
          const verseTo = chapter === parsed.endChapter ? parsed.endVerse : Number.MAX_SAFE_INTEGER
          const chapterData = bookData?.[chapter] ?? {}
          for (const [verseNumber, text] of Object.entries(chapterData)) {
            const number = Number(verseNumber)
            if (number >= verseFrom && number <= verseTo) verses.push({ number, text })
          }
        }

        if (verses.length === 0) {
          // Every reference is validated against the same chapter/verse-count table this
          // dataset was checked against when it was built, so this shouldn't happen.
          throw new Error(
            `No KJV text found for ${formatReference(parsed)} — this shouldn't happen.`,
          )
        }
        return { reference: formatReference(parsed), translation, verses }
      },
      getBookList: async () => getBookNames(),
      listTranslations: async () => availableTranslations,
      // This mock powers the publicly-hosted static demo, which must never embed a real API
      // key client-side (see scriptureFixtures.ts) — so there's no real api.bible catalog to
      // return here.
      listApiBibleCatalog: async () => [],
    },
    // A real audience window — the mock/demo adapter gets the exact same window.open()+
    // BroadcastChannel presentation the real web adapter uses (createLiveAudienceWindowPort is
    // genuinely storage-independent, so there's no reason for the demo to fake this with a
    // no-op instead of showing the real feature working).
    live: createLiveAudienceWindowPort(),
    // `displays` intentionally omitted, matching adapters/web/index.ts. This build presents into a
    // browser window via BroadcastChannel, so it cannot target a monitor at all — the simulated
    // "Built-in Display"/"Preview" entries that used to live here produced a Choose Audience
    // Display picker whose choice changed nothing, and offered monitors that do not exist.
    // Profile CRUD (shared/synced data) works the same way here as on the web/tablet build —
    // only the per-machine executable path and actual launching are genuinely Tauri/Win32-only
    // (see ExternalAppPort's own doc comment), so those methods stay absent.
    externalApps: {
      listProfiles: () => externalAppProfiles.list(),
      saveProfile: async (profile) => {
        await externalAppProfiles.save({ ...profile, ...nowStamp() })
      },
      deleteProfile: (id) => externalAppProfiles.delete(id),
      importDefaultProfiles: async () => {
        const existing = await externalAppProfiles.list()
        const { updatedAt, updatedByDevice } = nowStamp()
        const additions = buildDefaultExternalAppProfiles(existing, updatedAt, updatedByDevice)
        for (const profile of additions) await externalAppProfiles.save(profile)
        return additions.length
      },
    },
    remote: {
      listDevices: async () => structuredClone(mockRemoteDevices),
      provisionDevice: async (personId, name, accessLevel) => {
        mockRemoteDevices.push({ id: newId('device'), personId, name, accessLevel })
        return { qrDataUrl: '', pairingUrl: '' }
      },
      repairDevice: async () => ({ qrDataUrl: '', pairingUrl: '' }),
      revokeDevice: async (id) => {
        const index = mockRemoteDevices.findIndex((d) => d.id === id)
        if (index !== -1) mockRemoteDevices.splice(index, 1)
      },
      // No real HTTP server in the browser demo — nothing to report state to or receive
      // commands from.
      getServerInfo: async () => ({ hostname: undefined, lanIp: undefined, port: 0 }),
      pushLiveState: async () => {},
      pushServiceOutline: async () => {},
      pushServiceOpen: async () => {},
      onCommand: async () => () => {},
    },
    sync: {
      getStatus: async (): Promise<SyncStatus> => ({
        folderReadable: true,
        lastLibraryChangeAt: new Date().toISOString(),
        conflictCount: 0,
        recoveryCount: 0,
      }),
      getCloudSyncClientStatus: async () => ({ running: true }),
      listRecoveryIssues: async () => [],
      recoverFile: async () => {},
      quarantineFile: async () => 'damaged-file.json.damaged',
      // No real Dropbox conflict artifacts to scan for in the browser demo.
      listConflicts: async () => [],
      resolveConflict: async () => {},
    },
    diagnostics: {
      getSummary: mockDiagnosticSummary,
      createBundle: async () => {
        const summary = await mockDiagnosticSummary()
        return JSON.stringify(
          {
            privacyNotice:
              'Browser demo diagnostics contain operational summary data only. No local logs or settings files are available.',
            summary,
            logs: [],
          },
          null,
          2,
        )
      },
    },
    exports: {
      saveFile: async ({ suggestedName, mimeType, bytes }) => {
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: mimeType,
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = suggestedName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        return 'saved'
      },
    },
    // No `open` — there's no bundled help site to open in a browser demo yet (deploying the
    // VitePress site to GitHub Pages is a separate, still-open item; see
    // notes/help-system-plan.md). The Help button checks for this and hides itself.
    help: {},
  }
}
