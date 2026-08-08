import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type {
  SlideLibraryItem,
  MediaItem,
  Theme,
  Person,
  SlideScene,
  TextEffect,
} from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'
import type { Announcement } from '@/models/announcement'

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
  importOpenSongSets(
    year: number,
    defaultServiceType: string,
  ): Promise<ImportSetsSummary | undefined>
  /**
   * One-time backfill (see App.vue's boot sequence) for services saved before the sermon item
   * became the sole source of truth for a service's sermon title/passage/preacher. A cheap
   * no-op on every call after the first real one. Pure filesystem transform in Tauri; the mock
   * adapter's fixtures already model the current shape directly, so this is a no-op there.
   */
  migrateLegacySermonFields(): Promise<void>
}

export interface SlideLibraryPort {
  list(): Promise<SlideLibraryItem[]>
  get(id: string): Promise<SlideLibraryItem | undefined>
  save(item: SlideLibraryItem): Promise<void>
  delete(id: string): Promise<void>
  /** Encodes arbitrary text (a URL, or a `WIFI:T:...;S:...;P:...;;` string) as a QR code PNG
   *  data URL — same rendering the Remote Control pairing flow already uses. */
  generateQrCode(content: string): Promise<string>
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
  title: string
  description?: string
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
  /**
   * The real file path backing a MediaItem, for actually displaying/playing it live (spec
   * sections 1/3) rather than just a placeholder label. Tauri-only — turned into a usable
   * `<img>`/`<video>` src via `convertFileSrc`; absent in the mock/browser demo, which has no
   * local file to point at.
   */
  getFilePath?(id: string): Promise<string>
  /**
   * A ready-to-use `<img>`/`<video>` src for the Media Library's own grid thumbnails — unlike
   * getFilePath above, this is never a raw filesystem path the caller has to know how to turn
   * into a URL itself: Tauri wraps its file path in `convertFileSrc` internally, and the mock
   * adapter returns an in-memory blob: URL for whatever it still has bytes for. Resolves to
   * undefined (not a rejection) when no preview is available — e.g. mock fixture items with no
   * real file behind them — so callers can fall back to a placeholder rather than show an error.
   */
  getPreviewUrl(id: string): Promise<string | undefined>
  /**
   * Copies whichever of the 6 bundled stock background images aren't already in the library
   * into it as ordinary media (tagged Background/Stock), plus whichever of the 2 starter
   * themes aren't already present. Idempotent — fixed ids mean re-running only adds what's
   * still missing. Offered from the Setup Wizard's Library step and Settings → Data tools.
   */
  importStockBackgrounds(): Promise<{ mediaAdded: number; themesAdded: number }>
}

export interface CanvaStatus {
  configured: boolean
  connected: boolean
  connecting: boolean
  error?: string
  /** Exact loopback URL this installation requires in the church's Canva integration. */
  callbackUrl?: string
}

export interface CanvaDesign {
  id: string
  title: string
  editUrl: string
  pageCount: number
  thumbnailUrl?: string
}

export interface CanvaImportResult {
  design: CanvaDesign
  pages: Array<{ pageNumber: number; media: MediaItem }>
}

export interface CanvaPort {
  status(): Promise<CanvaStatus>
  connect(): Promise<void>
  disconnect(): Promise<void>
  listDesigns(): Promise<CanvaDesign[]>
  createDesign(title: string): Promise<CanvaDesign>
  openDesign(designId: string): Promise<void>
  importDesign(
    designId: string,
    existingPages?: Array<{ pageNumber: number; mediaId: string }>,
  ): Promise<CanvaImportResult>
}

export interface ThemePort {
  list(): Promise<Theme[]>
  save(theme: Theme): Promise<void>
  delete(id: string): Promise<void>
}

export interface PersonPort {
  list(): Promise<Person[]>
  save(person: Person): Promise<void>
  delete(id: string): Promise<void>
}

export interface AnnouncementPort {
  list(): Promise<Announcement[]>
  save(announcement: Announcement): Promise<void>
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

/** One edition from api.bible's own catalog (GET /v1/bibles) — surfaced so Settings can offer a
 *  real picker instead of free-text entry of an unvalidated code. */
export interface ApiBibleCatalogEntry {
  id: string
  name: string
  abbreviation: string
  /** Distinguishes entries that otherwise share the same name/abbreviation (different canons/licensors). */
  description: string
}

export interface ScripturePort {
  resolve(reference: string, translationCode: string): Promise<ScripturePassage>
  /** Book/chapter/verse-count reference table — used for validation and reference-only wayfinding, no API call. */
  getBookList(): Promise<string[]>
  /** Translations actually available to resolve against (configured API key or imported file) — spec section 2. */
  listTranslations(): Promise<ScriptureTranslation[]>
  /** api.bible's catalog of English editions. `apiKey` lets Settings browse with an unsaved
   *  draft key before it's persisted to machine-settings.json; omit to use the saved one. */
  listApiBibleCatalog(apiKey?: string): Promise<ApiBibleCatalogEntry[]>
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

export interface LiveMediaRef {
  /** A `convertFileSrc` URL, already resolved by the operator window — usable directly as an `<img>`/`<video>` src. */
  url: string
  /** The raw MediaItem id — what the confidence-monitor mirror uses via its own `/api/media/:id` endpoint, since a `convertFileSrc` URL is meaningless off-device. */
  mediaId: string
  kind: 'image' | 'video'
  fit: 'cover' | 'contain'
}

export interface LivePresentationTheme {
  fontFamily: string
  textColor: string
  textEffect: TextEffect
  backgroundColor: string
  backgroundMedia?: LiveMediaRef
}

export interface LiveSlideContent {
  itemLabel: string
  subLabel: string
  text: string
  /** Resolved reusable style for generated song/scripture/sermon/text slides. */
  presentationTheme?: LivePresentationTheme
  /** Presentation override — preserve the slide's visual background while hiding foreground content. */
  backgroundOnly?: boolean
  /** Advanced library slides — rendered by the same scene component used in the editor. */
  scene?: SlideScene
  /** Advanced library slides only — this service's own date/time (ISO), for a Countdown scene
   *  element in 'service' mode to count down to. */
  serviceDateTime?: string
  /** Reference-only scripture slides only — the surrounding-books wayfinding visual (spec section 1). */
  wayfindingBooks?: { name: string; distance: number }[]
  /** Reference-only scripture slides only — 0-1 fraction of the way through the whole Bible
   *  (by KJV verse count) this reference falls at, for the wayfinding progress bar. */
  bibleProgress?: number
  /** Media/Video items only — the actual image/video to display live (spec sections 1/3). */
  media?: LiveMediaRef
  /** Full-text scripture and song slides only — auto-fit `text` within this range (spec section 1) rather than the static size used for other slide types. */
  fontRange?: { minPx: number; maxPx: number }
  /** Song slides only — treat each `\n`-separated line in `text` as its own unit that shouldn't wrap unless necessary, preferring a comma/semicolon break over an arbitrary word boundary. */
  lineWrap?: boolean
  /** Song slides only — overrides the footer (otherwise subLabel, the block's own label) with
   *  the song's first collection citation, e.g. "Hymns of Grace #123". Empty string when the
   *  song has no collections (hide the footer rather than fall back to the block label). */
  footerText?: string
  /** Song slides only — set when this block is one of a back-to-back run of the same block
   *  (e.g. "2/2" for the second of two consecutive Chorus slides), local to that one run, not
   *  the block's total appearances in the song. Shown bottom-right, distinct from the centered
   *  header/footer bars. */
  repeatLabel?: string
  /** Sermon outline points only — the point's own title, shown large in the main slide area
   *  with `text` (its details, if any) below it in a smaller size, instead of the usual single
   *  auto-fit block. */
  outlineTitle?: string
  /** Song/scripture/text-slide items only — fixed (not auto-fit) size for itemLabel/subLabel, shown as a pinned header/footer rather than above the main text. */
  headerFontSizePx?: number
  footerFontSizePx?: number
  /** Reference-only scripture slides only — configured (Settings > Font Sizes) sizes for the
   *  wayfinding display: the reference itself and the nearest surrounding book approach
   *  wayfindingMaxFontSizePx, the farthest surrounding book shown uses wayfindingMinFontSizePx,
   *  everything in between is linearly interpolated by distance. */
  wayfindingMinFontSizePx?: number
  wayfindingMaxFontSizePx?: number
}

export interface LivePresentationPort {
  /**
   * Opens the audience-facing presentation window on the distinct monitor configured with the
   * Audience role. Rejects when that display is unavailable. No-ops in the mock/browser adapter.
   */
  startPresenting(): Promise<void>
  /** Closes the presentation window and restores the operator window to where it was. */
  stopPresenting(): Promise<void>
  goToIndex(flattenedIndex: number): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  /** Broadcasts the current slide (or `undefined` for blank) to the presentation window. */
  setLiveContent(content: LiveSlideContent | undefined): Promise<void>
  /**
   * The real logical pixel size of the configured audience display's work area. Used to size the
   * operator's Previous/Current/Next preview thumbnails so the same auto-fit sizing/wrapping
   * decisions get made there as on the real thing. Returns undefined when no distinct configured
   * audience display is available; the editor then uses a stable 16:9 planning preview.
   */
  getPresentationSize?(): Promise<{ width: number; height: number } | undefined>
}

/** The configured Audience display's current full bounds — computed fresh from the monitor
 *  layout on every External App Hand-off launch (see the Tauri adapter's
 *  computeAudienceMonitorPhysicalBounds), never stored. An external app's window is always
 *  positioned to exactly fill this rect, full screen. */
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
  /** Opens a native file picker (no extension filter) for the file an Add-to-Service item hands to the app. */
  pickFile(): Promise<string | undefined>
  /** Always fills the configured Audience display, full screen — throws if none is assigned. */
  launch(profileId: string, file?: string): Promise<void>
  /** "Launch Now" — starts this item's app ahead of time, minimized/in the background, so its
   *  cold-start delay happens before its slide goes live instead of during. A no-op if it's
   *  already running and cached from an earlier launch/prelaunch this session. */
  prelaunch(profileId: string, file?: string): Promise<void>
  /** Minimizes whichever app is currently engaged (if any) and restores Worship Studio's own
   *  presentation/operator windows — used when navigating to a different (non-external-app)
   *  slide mid-presentation. Doesn't close anything, so returning to the same item later reuses
   *  the same window instead of relaunching. */
  restoreSelf(): Promise<void>
  /** Operator-triggered: closes just the currently-engaged app and forgets it, so the next time
   *  its item goes live it launches fresh rather than trying to reuse a handle the operator
   *  deliberately closed. */
  closeCurrent(): Promise<void>
  /** Stop Presenting's counterpart to restoreSelf — closes every app launched this session
   *  (there can be more than one, across different items), not just the most recent one. */
  closeAll(): Promise<void>
  /** Add-time robustness check (spec section 12) — executable/file existence, no launch. */
  verifyItem(profileId: string, file?: string): Promise<void>
  /** Basic Remote Controls — forwards Next/Prev as a keystroke instead of advancing the service, while this item is live. */
  sendKeystroke(profileId: string, direction: 'next' | 'previous'): Promise<void>
}

export interface RemoteDevice {
  id: string
  /** Owner in the people library. Missing only for legacy pairings created before ownership was required. */
  personId?: string
  name: string
  accessLevel: 'view-only' | 'full-control'
}

export interface RemoteCommand {
  action:
    | 'next'
    | 'previous'
    | 'goto'
    | 'toggle-presenting'
    | 'select-service'
    | 'toggle-blank-screen'
    | 'toggle-background-only'
    | 'external-app-relaunch'
    | 'external-app-close'
  index?: number
  serviceId?: string
}

export interface RemoteLiveStateUpdate {
  content: LiveSlideContent | undefined
  isPresenting: boolean
  /** Tells the phone's mirror to show its own placeholder instead of `content` — see
   *  remote_server.rs's `external_app_active` doc comment for why this can't just be inferred
   *  from `content` being empty. */
  externalAppActive: boolean
  /** The real audience display's own logical resolution (same value as `PREVIEW_VIRTUAL_SIZE`)
   *  so the phone can letterbox/pillarbox to the *real* display's aspect ratio instead of
   *  stretching to fill its own screen's shape. */
  displaySize: { width: number; height: number }
  isBlankScreen: boolean
  backgroundOnly: boolean
}

/** Tauri-only — needs the bundled local HTTP server; not meaningful in the static demo. */
export interface RemotePort {
  listDevices(): Promise<RemoteDevice[]>
  provisionDevice(
    personId: string,
    name: string,
    accessLevel: RemoteDevice['accessLevel'],
  ): Promise<{ qrDataUrl: string; pairingUrl: string }>
  repairDevice(id: string): Promise<{ qrDataUrl: string; pairingUrl: string }>
  revokeDevice(id: string): Promise<void>
  /** Stable mDNS hostname plus the LAN IP/port fallback the server is actually using. */
  getServerInfo(): Promise<{ hostname?: string; lanIp?: string; port: number }>
  /** Mirrors the live slide/presenting state into the Rust-side server so /api/state has
   *  something to report. */
  pushLiveState(update: RemoteLiveStateUpdate): Promise<void>
  /** Mirrors the current service's flattened slide list (short labels only, never full slide
   *  text) into the Rust-side server for the phone's live slide picker (Full Control only). */
  pushServiceOutline(slides: { index: number; label: string }[]): Promise<void>
  /** Pushed once from ServiceWorkspaceView's own mount/unmount — a remote device shouldn't see
   *  Start Presenting/Prev/Next/the slide picker until a service is actually open, regardless
   *  of whether it's presenting yet. */
  pushServiceOpen(open: boolean): Promise<void>
  /** A paired phone's button press, relayed back from the server — see remote_server.rs. */
  onCommand(callback: (command: RemoteCommand) => void): Promise<() => void>
}

export interface SyncStatus {
  folderReadable: boolean
  syncClientRunning: boolean
  lastLibraryChangeAt?: string
  conflictCount: number
  recoveryCount: number
}

export interface RecoveryIssue {
  relativePath: string
  /** Opaque, validated handle passed back to the recovery commands. */
  filePath: string
  error: string
  backupAvailable: boolean
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
  listRecoveryIssues(): Promise<RecoveryIssue[]>
  recoverFile(filePath: string): Promise<void>
  /** Preserves damaged bytes outside the active `.json` set and returns their new path. */
  quarantineFile(filePath: string): Promise<string>
  listConflicts(): Promise<ConflictedItem[]>
  /**
   * `keep: 'theirs'` overwrites the original with the conflicted copy's content; `'mine'`
   * leaves the original untouched. Either way the conflicted-copy artifact is removed
   * afterward, so the conflict stops appearing — self-clearing, per feature-spec.md's Sync
   * section.
   */
  resolveConflict(conflictFilePath: string, keep: 'mine' | 'theirs'): Promise<void>
}

export interface DiagnosticSummary {
  generatedAt: string
  appVersion: string
  buildProfile: string
  platform: string
  architecture: string
  installationMode: 'installed' | 'portable' | 'browser-demo'
  setupComplete: boolean
  libraryReadable: boolean
  libraryItems: {
    songs: number
    services: number
    slides: number
    media: number
    themes: number
    people: number
  }
  lastLibraryChangeAt?: string
  syncConflictCount: number
  recoveryIssueCount: number
  displayAssignmentCount: number
  remotePortMode: 'automatic' | 'configured' | 'unavailable'
  lastRemotePort?: number
  canvaCallbackPort?: number
  logFileCount: number
  logBytes: number
}

export interface DiagnosticsPort {
  getSummary(): Promise<DiagnosticSummary>
  createBundle(): Promise<string>
  /** Native builds only; browser demos have no local log folder. */
  openLogsFolder?(): Promise<void>
}

export interface HelpPort {
  /** Opens (or re-opens at a new topic) the in-app help window at the given topic slug —
   *  see src/router/index.ts's `meta.helpTopic` for where topic strings come from. Native
   *  builds only; the mock/browser demo has no bundled help site to open yet (see
   *  notes/help-system-plan.md). */
  open?(topic: string): Promise<void>
}

export interface GeneratedFile {
  suggestedName: string
  mimeType: string
  extensions: string[]
  bytes: Uint8Array
}

export type ExportResult = 'cancelled' | 'saved' | 'opened'

/** Keeps report generation independent of its destination: the desktop adapter uses a native
 * save dialog and Rust's binary writer, while the static demo uses a normal browser download. */
export interface ExportPort {
  saveFile(file: GeneratedFile, options?: { openAfterSave?: boolean }): Promise<ExportResult>
}

export interface StudioAdapter {
  readonly kind: 'tauri' | 'mock'
  songs: SongPort
  services: ServicePort
  slides: SlideLibraryPort
  media: MediaPort
  /** Tauri-only local Canva integration; absent from the static browser demo. */
  canva?: CanvaPort
  themes: ThemePort
  people: PersonPort
  announcements: AnnouncementPort
  settings: SettingsPort
  scripture: ScripturePort
  live: LivePresentationPort
  displays?: DisplayPort
  externalApps?: ExternalAppPort
  remote?: RemotePort
  sync: SyncPort
  diagnostics: DiagnosticsPort
  exports: ExportPort
  help: HelpPort
}
