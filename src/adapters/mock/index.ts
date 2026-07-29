import type {
  StudioAdapter,
  ScripturePassage,
  DisplayInfo,
  DisplayRole,
  RemoteDevice,
  SyncStatus,
  StagedMediaFile,
  MediaImportCommit,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { MediaItem } from '@/models/library'
import { MockCollection, MockSingleton } from './collection'
import {
  seedSongs,
  seedServices,
  seedSlides,
  seedMedia,
  seedThemes,
  seedPeople,
  seedLibrarySettings,
  seedMachineSettings,
} from './fixtures'
import { parseOpenSongXml } from './opensongParser'
import { pickFilesInBrowser } from './pickFiles'
import { availableTranslations, loadKjv } from './scriptureFixtures'
import { formatReference, getBookNames, isValidReference, parseReference } from '@/utils/scriptureReference'

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function nowStamp() {
  return { updatedAt: new Date().toISOString(), updatedByDevice: 'demo-machine' }
}

// Mirrors the Tauri backend's songs::recompute_usage — recomputed from every saved service
// rather than incremented on each save, so "last used" stays correct if a service's songs or
// date are edited later, or the most recent service referencing a song is deleted. lastUsedAt
// is the service's own date, not when it was saved. Only songs whose stats actually changed are
// re-saved.
async function recomputeSongUsage(songs: MockCollection<Song>, services: MockCollection<Service>) {
  const allServices = (await services.list()) as Service[]
  const oneYearAgo = new Date()
  oneYearAgo.setDate(oneYearAgo.getDate() - 365)
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10)

  const lastUsedAt = new Map<string, string>()
  const usesPastYear = new Map<string, number>()
  for (const service of allServices) {
    for (const item of service.items) {
      if (item.type !== 'song') continue
      const current = lastUsedAt.get(item.songId)
      if (!current || service.date > current) lastUsedAt.set(item.songId, service.date)
      if (service.date >= oneYearAgoStr) usesPastYear.set(item.songId, (usesPastYear.get(item.songId) ?? 0) + 1)
    }
  }

  const allSongs = (await songs.list()) as Song[]
  for (const song of allSongs) {
    const newLastUsedAt = lastUsedAt.get(song.id)
    const newUsesPastYear = usesPastYear.get(song.id) ?? 0
    if (song.usage.lastUsedAt === newLastUsedAt && song.usage.usesPastYear === newUsesPastYear) continue
    await songs.save({ ...song, usage: { lastUsedAt: newLastUsedAt, usesPastYear: newUsesPastYear }, ...nowStamp() })
  }
}

export function createMockAdapter(): StudioAdapter {
  const songs = new MockCollection('songs', seedSongs)
  const services = new MockCollection('services', seedServices)
  const slides = new MockCollection('slides', seedSlides)
  const media = new MockCollection('media', seedMedia)
  const themes = new MockCollection('themes', seedThemes)
  const people = new MockCollection('people', seedPeople)

  const librarySettingsStore = new MockSingleton('library-settings', seedLibrarySettings)
  const machineSettingsStore = new MockSingleton('machine-settings', seedMachineSettings)
  let liveIndex = -1
  // Real hardware enumeration would refresh id/name/resolution from the OS each time and
  // look up only the role from per-machine storage; the mock's "hardware" is fake and
  // stable either way, so persisting the whole record is equivalent and simpler.
  const displays = new MockCollection<DisplayInfo>('displays', [
    { id: 'display-1', name: 'Built-in Display', resolution: '1920x1080', role: 'operator' },
    { id: 'display-2', name: 'Preview (simulated audience)', resolution: '1920x1080', role: 'audience' },
  ])
  const mockRemoteDevices: RemoteDevice[] = []
  // Staged-but-not-yet-committed File objects from pickFilesToImport, keyed by the synthetic
  // "path" handed back to the caller — there's no real filesystem path in the browser demo,
  // so this in-memory map stands in for one between staging and commitImport.
  const stagedMediaFiles = new Map<string, File>()

  function guessMediaKind(file: File): 'image' | 'video' {
    return file.type.startsWith('video') ? 'video' : 'image'
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
      usage: { usesPastYear: 0 },
      ...nowStamp(),
    }
    await songs.save(song)
    return song
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
        await services.save({ ...service, ...nowStamp() })
        await recomputeSongUsage(songs, services)
      },
      delete: async (id) => {
        await services.delete(id)
        await recomputeSongUsage(songs, services)
      },
      listUpcoming: async (fromDate, toDate) => {
        const all = (await services.list()) as Service[]
        return all.filter((s) => s.date >= fromDate && s.date <= toDate)
      },
      // No real filesystem to pick an OpenSong Sets folder from in the browser demo.
      importOpenSongSets: async () => undefined,
      // Nothing to backfill — this adapter's fixtures already model the current (item-based) shape.
      migrateLegacySermonFields: async () => {},
    },
    slides: {
      list: () => slides.list(),
      get: (id) => slides.get(id),
      save: (item) => slides.save({ ...item, ...nowStamp() }),
      delete: (id) => slides.delete(id),
    },
    media: {
      list: () => media.list() as Promise<MediaItem[]>,
      save: (item) => media.save({ ...item, ...nowStamp() }),
      pickFilesToImport: async (): Promise<StagedMediaFile[]> => {
        const files = await pickFilesInBrowser()
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
            usage: { usesPastYear: 0 },
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
      getPreviewUrl: async (id) => mediaPreviewUrls.get(id),
    },
    themes: {
      list: () => themes.list(),
      save: (theme) => themes.save({ ...theme, ...nowStamp() }),
      delete: (id) => themes.delete(id),
    },
    people: {
      list: () => people.list(),
      save: (person) => people.save({ ...person, ...nowStamp() }),
      delete: (id) => people.delete(id),
    },
    settings: {
      getLibrarySettings: () => librarySettingsStore.get(),
      saveLibrarySettings: (next) => librarySettingsStore.save(next),
      getMachineSettings: () => machineSettingsStore.get(),
      saveMachineSettings: (next) => machineSettingsStore.save(next),
      // No real filesystem to pick a folder from in the browser demo.
      pickLibraryFolder: async () => undefined,
    },
    scripture: {
      resolve: async (reference, translation): Promise<ScripturePassage> => {
        const parsed = parseReference(reference)
        if (!parsed || !isValidReference(parsed)) throw new Error(`"${reference}" isn't a valid scripture reference.`)

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
          throw new Error(`No KJV text found for ${formatReference(parsed)} — this shouldn't happen.`)
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
    live: {
      startPresenting: async () => {
        if (liveIndex === -1) liveIndex = 0
      },
      stopPresenting: async () => {
        liveIndex = -1
      },
      goToIndex: async (index) => {
        liveIndex = index
      },
      next: async () => {
        liveIndex += 1
      },
      previous: async () => {
        liveIndex = Math.max(0, liveIndex - 1)
      },
      // No real second window exists in the browser demo, so there's nothing to broadcast to.
      setLiveContent: async () => {},
    },
    displays: {
      list: () => displays.list(),
      assignRole: async (displayId, role: DisplayRole) => {
        const display = await displays.get(displayId)
        if (display) await displays.save({ ...display, role })
      },
      identify: async () => {},
    },
    // externalApps intentionally omitted in the mock adapter — Windows-only, feature-detected off.
    remote: {
      listDevices: async () => structuredClone(mockRemoteDevices),
      provisionDevice: async (name, accessLevel) => {
        mockRemoteDevices.push({ id: newId('device'), name, accessLevel })
        return { qrDataUrl: '', pairingUrl: '' }
      },
      revokeDevice: async (id) => {
        const index = mockRemoteDevices.findIndex((d) => d.id === id)
        if (index !== -1) mockRemoteDevices.splice(index, 1)
      },
      // No real HTTP server in the browser demo — nothing to report state to or receive
      // commands from.
      getServerInfo: async () => ({ lanIp: undefined, port: 0 }),
      pushLiveState: async () => {},
      onCommand: async () => () => {},
    },
    sync: {
      getStatus: async (): Promise<SyncStatus> => ({
        folderReadable: true,
        syncClientRunning: true,
        lastLibraryChangeAt: new Date().toISOString(),
        conflictCount: 0,
      }),
      // No real Dropbox conflict artifacts to scan for in the browser demo.
      listConflicts: async () => [],
      resolveConflict: async () => {},
    },
    email: {
      sendOrderOfWorship: async () => {
        // Demo build never sends real email — see spec section 7 (what has to be faked).
      },
      sendAssignments: async () => {
        // Same as sendOrderOfWorship — no real mail transport exists in this codebase yet.
      },
    },
  }
}
