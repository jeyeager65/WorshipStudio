import type {
  StudioAdapter,
  ScripturePassage,
  DisplayInfo,
  DisplayRole,
  RemoteDevice,
  SyncStatus,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import { MockCollection } from './collection'
import {
  seedSongs,
  seedServices,
  seedSlides,
  seedMedia,
  seedThemes,
  seedLibrarySettings,
  seedMachineSettings,
} from './fixtures'

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function nowStamp() {
  return { updatedAt: new Date().toISOString(), updatedByDevice: 'demo-machine' }
}

export function createMockAdapter(): StudioAdapter {
  const songs = new MockCollection('songs', seedSongs)
  const services = new MockCollection('services', seedServices)
  const slides = new MockCollection('slides', seedSlides)
  const media = new MockCollection('media', seedMedia)
  const themes = new MockCollection('themes', seedThemes)

  let librarySettings = seedLibrarySettings
  let machineSettings = seedMachineSettings
  let liveIndex = -1
  const mockDisplays: DisplayInfo[] = [
    { id: 'display-1', name: 'Built-in Display', resolution: '1920x1080', role: 'operator' },
    { id: 'display-2', name: 'Preview (simulated audience)', resolution: '1920x1080', role: 'audience' },
  ]
  const mockRemoteDevices: RemoteDevice[] = []

  return {
    kind: 'mock',
    songs: {
      list: () => songs.list() as Promise<Song[]>,
      get: (id) => songs.get(id) as Promise<Song | undefined>,
      save: (song) => songs.save({ ...song, ...nowStamp() }),
      delete: (id) => songs.delete(id),
      importFromOpenSongXml: async (xml) => {
        const titleMatch = /<title>(.*?)<\/title>/.exec(xml)
        const song: Song = {
          id: newId('song'),
          title: titleMatch?.[1] ?? 'Imported Song',
          collections: [],
          tags: [],
          blocks: [],
          defaultArrangement: { sequence: [] },
          usage: { usesPastYear: 0 },
          ...nowStamp(),
        }
        await songs.save(song)
        return song
      },
    },
    services: {
      list: () => services.list() as Promise<Service[]>,
      get: (id) => services.get(id) as Promise<Service | undefined>,
      save: (service) => services.save({ ...service, ...nowStamp() }),
      delete: (id) => services.delete(id),
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
    },
    media: {
      list: () => media.list(),
      import: async (files) => {
        for (const file of files) {
          await media.save({
            id: newId('media'),
            filename: file.name,
            kind: file.type.startsWith('video') ? ('video' as const) : ('image' as const),
            tags: [],
            location: 'synced' as const,
            usage: { usesPastYear: 0 },
            ...nowStamp(),
          })
        }
        return media.list()
      },
      detectDuplicates: async () => [],
      delete: (id) => media.delete(id),
    },
    themes: {
      list: () => themes.list(),
      save: (theme) => themes.save({ ...theme, ...nowStamp() }),
      delete: (id) => themes.delete(id),
    },
    settings: {
      getLibrarySettings: async () => structuredClone(librarySettings),
      saveLibrarySettings: async (next) => {
        librarySettings = next
      },
      getMachineSettings: async () => structuredClone(machineSettings),
      saveMachineSettings: async (next) => {
        machineSettings = next
      },
    },
    scripture: {
      resolve: async (reference, translation): Promise<ScripturePassage> => ({
        reference,
        translation,
        verses: [{ number: 1, text: `[Demo passage text for ${reference}, ${translation}]` }],
      }),
      getBookList: async () => ['Genesis', 'Exodus', 'Matthew', 'Mark', 'Luke', 'John'],
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
    },
    displays: {
      list: async () => structuredClone(mockDisplays),
      assignRole: async (displayId, role: DisplayRole) => {
        const display = mockDisplays.find((d) => d.id === displayId)
        if (display) display.role = role
      },
      identify: async () => {},
    },
    // externalApps intentionally omitted in the mock adapter — Windows-only, feature-detected off.
    remote: {
      listDevices: async () => structuredClone(mockRemoteDevices),
      provisionDevice: async (name, accessLevel) => {
        mockRemoteDevices.push({ id: newId('device'), name, accessLevel })
        return { qrDataUrl: '' }
      },
      revokeDevice: async (id) => {
        const index = mockRemoteDevices.findIndex((d) => d.id === id)
        if (index !== -1) mockRemoteDevices.splice(index, 1)
      },
    },
    sync: {
      getStatus: async (): Promise<SyncStatus> => ({
        folderReadable: true,
        syncClientRunning: true,
        lastLibraryChangeAt: new Date().toISOString(),
        conflictCount: 0,
      }),
      listConflicts: async () => [],
    },
    email: {
      sendOrderOfWorship: async () => {
        // Demo build never sends real email — see spec section 7 (what has to be faked).
      },
    },
  }
}
