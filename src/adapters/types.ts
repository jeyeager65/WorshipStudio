import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme } from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

/**
 * Every screen must be able to run against either the real Tauri backend or a
 * fixture-backed mock (spec section 7: static web demo build). Components depend
 * on this interface only — never on `@tauri-apps/api` or the filesystem directly.
 */
export interface SongPort {
  list(): Promise<Song[]>
  get(id: string): Promise<Song | undefined>
  save(song: Song): Promise<void>
  delete(id: string): Promise<void>
  importFromOpenSongXml(xml: string): Promise<Song>
  /** Opens a native/browser file picker, imports each selected OpenSong file, and returns the created songs. */
  importFromOpenSongFiles(): Promise<Song[]>
}

export interface ServicePort {
  list(): Promise<Service[]>
  get(id: string): Promise<Service | undefined>
  save(service: Service): Promise<void>
  delete(id: string): Promise<void>
  listUpcoming(fromDate: string, toDate: string): Promise<Service[]>
}

export interface SlideLibraryPort {
  list(): Promise<SlideLibraryItem[]>
  get(id: string): Promise<SlideLibraryItem | undefined>
  save(item: SlideLibraryItem): Promise<void>
  delete(id: string): Promise<void>
}

export interface MediaPort {
  list(): Promise<MediaItem[]>
  import(files: File[]): Promise<MediaItem[]>
  detectDuplicates(item: MediaItem): Promise<MediaItem[]>
  delete(id: string): Promise<void>
}

export interface ThemePort {
  list(): Promise<Theme[]>
  save(theme: Theme): Promise<void>
  delete(id: string): Promise<void>
}

export interface SettingsPort {
  getLibrarySettings(): Promise<LibrarySettings>
  saveLibrarySettings(settings: LibrarySettings): Promise<void>
  getMachineSettings(): Promise<MachineSettings>
  saveMachineSettings(settings: MachineSettings): Promise<void>
}

export interface ScripturePassageVerse {
  number: number
  text: string
}

export interface ScripturePassage {
  reference: string
  translation: string
  verses: ScripturePassageVerse[]
}

export interface ScripturePort {
  resolve(reference: string, translationCode: string): Promise<ScripturePassage>
  /** Book/chapter/verse-count reference table — used for validation and reference-only wayfinding, no API call. */
  getBookList(): Promise<string[]>
}

export type DisplayRole = 'operator' | 'audience' | 'not-used'

export interface DisplayInfo {
  id: string
  name: string
  resolution: string
  role: DisplayRole
}

/** Windows-only in practice (live-presentation role assignment) — absent port on the macOS/demo build. */
export interface DisplayPort {
  list(): Promise<DisplayInfo[]>
  assignRole(displayId: string, role: DisplayRole): Promise<void>
  identify(displayId: string): Promise<void>
}

export interface LivePresentationPort {
  startPresenting(): Promise<void>
  stopPresenting(): Promise<void>
  goToIndex(flattenedIndex: number): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
}

/** Windows-only (Win32 window hand-off) — absent port on the macOS/demo build. */
export interface ExternalAppPort {
  launch(profileId: string, file?: string): Promise<void>
  restoreSelf(): Promise<void>
  testLaunch(profileId: string): Promise<{ ok: boolean; message: string }>
}

export interface RemoteDevice {
  id: string
  name: string
  accessLevel: 'view-only' | 'advance-only' | 'full-control'
}

/** Tauri-only — needs the bundled local HTTP server; not meaningful in the static demo. */
export interface RemotePort {
  listDevices(): Promise<RemoteDevice[]>
  provisionDevice(name: string, accessLevel: RemoteDevice['accessLevel']): Promise<{ qrDataUrl: string }>
  revokeDevice(id: string): Promise<void>
}

export interface SyncStatus {
  folderReadable: boolean
  syncClientRunning: boolean
  lastLibraryChangeAt?: string
  conflictCount: number
}

export interface SyncPort {
  getStatus(): Promise<SyncStatus>
  listConflicts(): Promise<unknown[]>
}

export interface EmailPort {
  sendOrderOfWorship(serviceId: string, toAddresses: string[], body: string): Promise<void>
}

export interface StudioAdapter {
  readonly kind: 'tauri' | 'mock'
  songs: SongPort
  services: ServicePort
  slides: SlideLibraryPort
  media: MediaPort
  themes: ThemePort
  settings: SettingsPort
  scripture: ScripturePort
  live: LivePresentationPort
  displays?: DisplayPort
  externalApps?: ExternalAppPort
  remote?: RemotePort
  sync: SyncPort
  email: EmailPort
}
