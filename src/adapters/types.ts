import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme, Volunteer } from '@/models/library'
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

export interface ImportSetsSummary {
  servicesCreated: number
  songReferencesMatched: number
  unmatchedSongTitles: string[]
  skippedFiles: string[]
}

export interface ServicePort {
  list(): Promise<Service[]>
  get(id: string): Promise<Service | undefined>
  save(service: Service): Promise<void>
  delete(id: string): Promise<void>
  listUpcoming(fromDate: string, toDate: string): Promise<Service[]>
  /**
   * Opens a native folder picker for an OpenSong `Sets` directory, imports every Set file
   * whose filename date falls in `year` as a draft Service (songs matched by title against
   * the already-imported library, seeding their usage stats), and returns a summary. Returns
   * undefined if the picker was cancelled — there's no equivalent in the browser demo build,
   * which always returns undefined.
   */
  importOpenSongSets(year: number, defaultServiceType: string): Promise<ImportSetsSummary | undefined>
}

export interface SlideLibraryPort {
  list(): Promise<SlideLibraryItem[]>
  get(id: string): Promise<SlideLibraryItem | undefined>
  save(item: SlideLibraryItem): Promise<void>
  delete(id: string): Promise<void>
}

export interface StagedMediaFile {
  /** Opaque handle the adapter needs back at commit time — a filesystem path in Tauri, a synthetic id in the mock. */
  path: string
  filename: string
  sizeBytes: number
  kind: 'image' | 'video'
  duplicateOfId?: string
  duplicateOfFilename?: string
}

export interface MediaImportCommit {
  path: string
  filename: string
  tags: string[]
  location: 'synced' | 'local'
  duplicateOfId?: string
}

export interface MediaPort {
  list(): Promise<MediaItem[]>
  save(item: MediaItem): Promise<void>
  /** Opens a native/browser file picker and stages each selection (size, kind, duplicate check) for the Import Media review dialog — nothing is copied into the library yet. */
  pickFilesToImport(): Promise<StagedMediaFile[]>
  /** Copies each accepted staged file into the library (synced or local, per its chosen location) and creates its record. */
  commitImport(files: MediaImportCommit[]): Promise<MediaItem[]>
  /** Passive re-check for an already-imported item — the "DUPLICATE" badge's backstop for files that entered the library some other way. */
  detectDuplicates(item: MediaItem): Promise<MediaItem[]>
  delete(id: string): Promise<void>
}

export interface ThemePort {
  list(): Promise<Theme[]>
  save(theme: Theme): Promise<void>
  delete(id: string): Promise<void>
}

export interface VolunteerPort {
  list(): Promise<Volunteer[]>
  save(volunteer: Volunteer): Promise<void>
  delete(id: string): Promise<void>
}

export interface SettingsPort {
  getLibrarySettings(): Promise<LibrarySettings>
  saveLibrarySettings(settings: LibrarySettings): Promise<void>
  getMachineSettings(): Promise<MachineSettings>
  saveMachineSettings(settings: MachineSettings): Promise<void>
  /** Opens a native folder picker for the synced library root (e.g. a Dropbox folder). Returns
   *  undefined if cancelled — no equivalent in the browser demo, which always returns undefined. */
  pickLibraryFolder(): Promise<string | undefined>
}

export interface ScripturePassageVerse {
  number: number
  text: string
}

export interface ScripturePassage {
  reference: string
  translation: string
  verses: ScripturePassageVerse[]
  /** Short attribution (e.g. "(ESV)") — present when the source translation requires it be displayed alongside the text. */
  copyright?: string
}

export interface ScriptureTranslation {
  code: string
  name: string
}

export interface ScripturePort {
  resolve(reference: string, translationCode: string): Promise<ScripturePassage>
  /** Book/chapter/verse-count reference table — used for validation and reference-only wayfinding, no API call. */
  getBookList(): Promise<string[]>
  /** Translations actually available to resolve against (configured API key or imported file) — spec section 2. */
  listTranslations(): Promise<ScriptureTranslation[]>
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

export interface LiveSlideContent {
  itemLabel: string
  subLabel: string
  text: string
}

export interface LivePresentationPort {
  /**
   * Opens the audience-facing presentation window and positions it relative to the operator
   * window: split left/right on a single monitor, or fullscreen on a second monitor when one
   * is available. No-ops in the mock/browser adapter — there's no second window to open there.
   */
  startPresenting(): Promise<void>
  /** Closes the presentation window and restores the operator window to where it was. */
  stopPresenting(): Promise<void>
  goToIndex(flattenedIndex: number): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  /** Broadcasts the current slide (or `undefined` for blank) to the presentation window. */
  setLiveContent(content: LiveSlideContent | undefined): Promise<void>
}

export interface WindowPosition {
  monitorId: string
  x: number
  y: number
  width: number
  height: number
}

export interface ExternalAppProfile {
  id: string
  name: string
  launchMode: 'already-running' | 'launch-automatically'
  executablePath?: string
  parameterFormat?: string
  remoteControlsEnabled: boolean
  nextKey?: string
  prevKey?: string
  windowPosition?: WindowPosition
  updatedAt: string
  updatedByDevice: string
}

/** Windows-only (Win32 window hand-off) — absent port on the macOS/demo build. */
export interface ExternalAppPort {
  listProfiles(): Promise<ExternalAppProfile[]>
  saveProfile(profile: ExternalAppProfile): Promise<void>
  deleteProfile(id: string): Promise<void>
  /** Opens a native file picker for the profile editor's Executable field. */
  pickExecutable(): Promise<string | undefined>
  launch(profileId: string, file?: string): Promise<void>
  restoreSelf(): Promise<void>
  testLaunch(profileId: string): Promise<{ ok: boolean; message: string }>
  /** Captures the currently-foreground window's bounds, for the profile editor's "Recapture Position" button. */
  captureWindowPosition(): Promise<WindowPosition>
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

export interface ConflictedItem {
  kind: string
  id: string
  label: string
  /** Raw JSON of each side — deliberately untyped (varies by `kind`) so this stays generic across every content type. */
  thisVersion: Record<string, unknown>
  otherVersion: Record<string, unknown>
  otherDevice: string
  otherUpdatedAt: string
  /** Opaque handle for resolveConflict — the conflicted-copy file's own path. */
  conflictFilePath: string
}

export interface SyncPort {
  getStatus(): Promise<SyncStatus>
  listConflicts(): Promise<ConflictedItem[]>
  /**
   * `keep: 'theirs'` overwrites the original with the conflicted copy's content; `'mine'`
   * leaves the original untouched. Either way the conflicted-copy artifact is removed
   * afterward, so the conflict stops appearing — self-clearing, per feature-spec.md's Sync
   * section.
   */
  resolveConflict(conflictFilePath: string, keep: 'mine' | 'theirs'): Promise<void>
}

export interface EmailPort {
  sendOrderOfWorship(serviceId: string, toAddresses: string[], body: string): Promise<void>
  /**
   * Composing/reviewing the message is fully real; actually dispatching it is deliberately
   * not wired up to any mail transport yet on either adapter — this always resolves without
   * sending anything, so the Volunteer Roster's "Send Assignments by Email" is safe to wire
   * up and click today.
   */
  sendVolunteerAssignments(serviceId: string, toAddresses: string[], body: string): Promise<void>
}

export interface StudioAdapter {
  readonly kind: 'tauri' | 'mock'
  songs: SongPort
  services: ServicePort
  slides: SlideLibraryPort
  media: MediaPort
  themes: ThemePort
  volunteers: VolunteerPort
  settings: SettingsPort
  scripture: ScripturePort
  live: LivePresentationPort
  displays?: DisplayPort
  externalApps?: ExternalAppPort
  remote?: RemotePort
  sync: SyncPort
  email: EmailPort
}
