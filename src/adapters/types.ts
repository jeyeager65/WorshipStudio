import type { Song } from '@/models/song'
import type { Service, ServiceTemplate } from '@/models/service'
import type {
  SlideLibraryItem,
  MediaItem,
  Theme,
  Person,
  SlideScene,
  TextEffect,
} from '@/models/library'
import type {
  LibrarySettings,
  LibraryCredentials,
  MachineSettings,
  DataLocation,
  SongCollectionDefinition,
  ServiceTypeDefinition,
  RoleGroupDefinition,
  RoleDefinition,
} from '@/models/settings'
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
  /** Encodes arbitrary text (a URL, or a `WIFI:T:...;S:...;P:...;;` string) as a QR code PNG
   *  data URL — same rendering the Remote Control pairing flow already uses. */
  generateQrCode(content: string): Promise<string>
}

export interface StagedMediaFile {
  /** Opaque handle the adapter needs back at commit time — a filesystem path in Tauri, a synthetic id in the mock. */
  path: string
  filename: string
  sizeBytes: number
  /** 'document' is the fallback for anything that isn't a recognized image/video extension —
   *  e.g. a PowerPoint deck imported for use with External App Hand-off. */
  kind: 'image' | 'video' | 'document'
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
  /**
   * Opens a native/browser file picker and stages each selection (size, kind, duplicate check)
   * for the Import Media review dialog — nothing is copied into the library yet. Defaults to an
   * image/video-only filter; pass `extensions` (e.g. an External App profile's own
   * `allowedExtensions`) to widen or replace that filter for importing a document instead — an
   * empty/undefined list means no filter at all.
   */
  pickFilesToImport(extensions?: string[]): Promise<StagedMediaFile[]>
  /**
   * A ready-to-use `<img>`/`<video>` src for a *staged, not-yet-committed* file's own review row
   * (Import Media dialog) — same "never a raw path the caller has to interpret" contract as
   * getPreviewUrl below, just for a StagedMediaFile.path instead of a committed MediaItem.id.
   * Resolves to undefined if the given path isn't currently staged (already committed, already
   * removed, or a stale reference), so callers fall back to a plain kind icon.
   */
  getStagedPreviewUrl(path: string): Promise<string | undefined>
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

export interface CanvaExportedPage {
  pageNumber: number
  exportUrl: string
}

export interface CanvaExportPreview {
  design: CanvaDesign
  pages: CanvaExportedPage[]
}

export interface CanvaVideoExportResult {
  design: CanvaDesign
  media: MediaItem
}

export interface CanvaVideoPreview {
  design: CanvaDesign
  /** Opaque handle for `importVideo` — a real filesystem path in Tauri, already downloaded (not
   *  just an export URL), since the operator needs the real byte size to choose synced vs.
   *  local before anything commits. */
  tempPath: string
  sizeBytes: number
}

export interface CanvaPort {
  status(): Promise<CanvaStatus>
  connect(): Promise<void>
  disconnect(): Promise<void>
  listDesigns(): Promise<CanvaDesign[]>
  createDesign(title: string): Promise<CanvaDesign>
  openDesign(designId: string): Promise<void>
  /** Starts a Canva export and waits for it to finish, returning each page's image URL without
   *  downloading/importing anything yet — lets the caller show a page picker before committing. */
  previewExport(designId: string): Promise<CanvaExportPreview>
  /** Downloads and imports only the given pages. Dedup against a page already imported through
   *  any prior Canva import (this design/page, any presentation, any entry point) happens on
   *  the backend — callers don't need to track or pass which pages already exist. */
  importPages(
    designId: string,
    pages: Array<{ pageNumber: number; exportUrl: string }>,
  ): Promise<CanvaImportResult>
  /** Exports the whole design as one MP4 (fixed 1080p/horizontal quality, no page subset — see
   *  CanvaImportDialog.vue) and downloads it, without importing it yet — a video can be large
   *  enough that synced-vs-local genuinely matters, so the caller shows the real size and lets
   *  the operator choose before `importVideo` actually commits it. */
  previewVideoExport(designId: string): Promise<CanvaVideoPreview>
  /** Commits an already-downloaded video from `previewVideoExport` at the chosen location,
   *  updating a prior video export of the same design in place rather than duplicating it. */
  importVideo(
    designId: string,
    tempPath: string,
    location: 'synced' | 'local',
  ): Promise<CanvaVideoExportResult>
}

export interface ThemePort {
  list(): Promise<Theme[]>
  save(theme: Theme): Promise<void>
  delete(id: string): Promise<void>
}

/** A peer of `SettingsPort`, not part of it — song collections moved out of
 *  `LibrarySettings.collections` into their own synced file so editing them doesn't share a
 *  save/conflict surface with unrelated settings (branding, credentials, font sizing, ...). */
export interface SongCollectionPort {
  list(): Promise<SongCollectionDefinition[]>
  save(collection: SongCollectionDefinition): Promise<SongCollectionDefinition>
  delete(id: string): Promise<void>
}

/** A peer of `SettingsPort`, not part of it — same reasoning as `SongCollectionPort`. */
export interface ServiceTypePort {
  list(): Promise<ServiceTypeDefinition[]>
  save(serviceType: ServiceTypeDefinition): Promise<ServiceTypeDefinition>
  delete(id: string): Promise<void>
}

/** A peer of `SettingsPort`, not part of it — same reasoning as `SongCollectionPort`. */
export interface RoleGroupPort {
  list(): Promise<RoleGroupDefinition[]>
  save(roleGroup: RoleGroupDefinition): Promise<RoleGroupDefinition>
  delete(id: string): Promise<void>
}

/** A peer of `SettingsPort`, not part of it — same reasoning as `SongCollectionPort`. */
export interface RolePort {
  list(): Promise<RoleDefinition[]>
  save(role: RoleDefinition): Promise<RoleDefinition>
  delete(id: string): Promise<void>
}

/** A peer of `SettingsPort`, not part of it — same reasoning as `SongCollectionPort`. */
export interface ServiceTemplatePort {
  list(): Promise<ServiceTemplate[]>
  save(template: ServiceTemplate): Promise<ServiceTemplate>
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
  /** See `LibraryCredentials`'s own doc comment for why these live in their own file, separate
   *  from `LibrarySettings`. */
  getLibraryCredentials(): Promise<LibraryCredentials>
  saveLibraryCredentials(credentials: LibraryCredentials): Promise<void>
  getMachineSettings(): Promise<MachineSettings>
  saveMachineSettings(settings: MachineSettings): Promise<void>
  /** Opens a native folder picker for the synced library root (e.g. a Dropbox folder). Returns
   *  undefined if cancelled — no equivalent in the browser demo, which always returns undefined. */
  pickLibraryFolder(): Promise<string | undefined>
  /** The Local root — machine-settings.json, paired devices, Canva tokens, and local-only
   *  media's actual bytes all live under it (see src-tauri/src/paths.rs's local_root). Tauri-only
   *  and deliberately not part of MachineSettings/getMachineSettings: machine-settings.json lives
   *  inside the folder this points to, so the pointer can't live inside machine-settings.json
   *  itself without becoming circular — it's stored in its own small fixed-location file instead
   *  (data-location.json, always directly in app-data). The web/tablet builds have an entirely
   *  separate, browser-native mechanism for local-only media (see
   *  adapters/web/pickedLocalMediaRoot.ts) with no equivalent "where do settings live" question
   *  at all, so none of these three methods apply there. */
  getDataLocation?(): Promise<DataLocation>
  /** Empty localRootPath resets to the default location. No-op (not an error) if this install is
   *  portable, where Local is always fixed beside the executable. */
  saveDataLocation?(localRootPath: string): Promise<void>
  /** Opens a native folder picker for the Local root above. */
  pickDataLocationFolder?(): Promise<string | undefined>
  /** Deletes the `.backup` sibling each of the five normalized settings-list files
   *  (service-types.json, song-collections.json, role-groups.json, roles.json,
   *  service-templates.json) keeps — ordinary deletes only ever shrink these lists, never
   *  remove the file itself, so the backup keeps holding real, church-specific content
   *  indefinitely otherwise. Every adapter's own write path maintains this backup (Rust's
   *  write_json_file, the web build's own writeJsonFile in fsaStorage.ts) — every adapter kind
   *  implements it. Offered only from Clear Existing Data. */
  clearSettingsListBackups(): Promise<void>
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
  /** Full-text scripture slides only — the same content as `text`, split so each verse's number
   *  can render as a distinct chip (see SlideContentRenderer.vue) instead of plain inline text.
   *  Undefined for a reference-only scripture slide and every other slide type, which just use
   *  `text` directly. */
  verseSegments?: ScriptureTextSegment[]
}

/** One piece of a full-text scripture slide, in reading order — a verse's number, then its own
 *  text, verse after verse. Kept as real structured data (rather than re-deriving verse
 *  boundaries from `text` by pattern-matching) since verse *text* itself often contains a bare
 *  number ("forty days and forty nights") that would be indistinguishable from a real verse
 *  number by pattern alone. */
export interface ScriptureTextSegment {
  type: 'number' | 'text'
  value: string
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
  /**
   * Subscribes to navigation requests made from *inside* the audience-facing window itself
   * (tap zones — see WebAudienceView.vue) rather than the operator's own Next/Previous controls.
   * Covers presenting from a tablet with no separate operator screen to switch back to. Only the
   * web/tablet BroadcastChannel port (liveAudienceWindow.ts) implements this — the Tauri native
   * presentation window has no on-screen controls of its own to send a request from. Returns an
   * unsubscribe function.
   */
  onNavigateRequest?(callback: (direction: 'next' | 'previous') => void): Promise<() => void>
  /**
   * Subscribes to the audience-facing window closing itself — by any means (its own Close
   * button, the browser's own tab close, the OS closing it) — so the operator side can stop
   * presenting instead of being left believing it's still live with nothing actually on screen.
   * Only the web/tablet BroadcastChannel port implements this; the Tauri native presentation
   * window's close is already synchronous from the operator's own stopPresenting() call, so
   * there's no separate "it closed on its own" case to catch. Returns an unsubscribe function.
   */
  onAudienceClosed?(callback: () => void): Promise<() => void>
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

/** One named, freely-rebindable Basic Remote Controls command (feature-spec.md section 12) —
 *  no fixed/reserved ids; "Next"/"Previous" are just what a starter profile happens to come with
 *  (see the Tauri adapter's importDefaultProfiles), fully editable/deletable like any other
 *  entry. Always available as a manual button (ServiceWorkspaceView's live-item panel and the
 *  phone Remote Control both render one per command, regardless of `triggerKey`). */
export interface ExternalAppKeyCommand {
  id: string
  label: string
  /** Sent to the *external app's* window when this command fires (either via its button or
   *  `triggerKey` below) — parsed/sent by the Rust side's win32.rs. */
  keyCombo: string
  /** Optional shortcut on the *operator's own* keyboard that fires this command while this
   *  profile's item is live and presenting — independent of `keyCombo` above (e.g. trigger on
   *  "1", send "F5"). Undefined means button-only. Same canonical string format as `keyCombo`
   *  (see src/utils/keyCombo.ts), but interpreted client-side against real keydown events —
   *  never reaches the Rust side. */
  triggerKey?: string
}

/**
 * Identity + behavior of an external app "profile" — shared/synced (feature-spec.md section 12),
 * so a service item referencing one by `id` means the same thing on every computer: everything
 * here is a fact about the *software* ("PowerPoint takes a `/S` switch and a file"), never about
 * a specific machine. What genuinely differs machine-to-machine — where the executable actually
 * lives on disk — lives separately in `ExternalAppImplementation` below, never here.
 */
export interface ExternalAppProfile {
  id: string
  name: string
  /** Drives the icon shown for this profile everywhere it's referenced (including on a device
   *  that can never launch it, e.g. web/tablet authoring a service item). */
  kind: 'presentation' | 'video' | 'custom'
  launchMode: 'already-running' | 'launch-automatically'
  parameterFormat?: string
  remoteControlsEnabled: boolean
  keyCommands: ExternalAppKeyCommand[]
  /** Restricts which files can be handed to this app — e.g. `['pptx']` for PowerPoint. Filters
   *  both the native file-picker dialog and the "pick a stored file" media picker. Undefined (the
   *  default) means no restriction, matching every profile's behavior before this field existed. */
  allowedExtensions?: string[]
  updatedAt: string
  updatedByDevice: string
}

/** The one thing about a profile that's genuinely specific to *this* computer: where its
 *  executable actually lives on disk. Never synced — kept in the same never-synced local file
 *  that used to hold the whole flat profile (see Tauri adapter's storage), now holding just this
 *  slim per-machine mapping. A profile with no implementation record on a given computer simply
 *  hasn't been "set up" there yet (see ExternalAppPort.getImplementation). */
export interface ExternalAppImplementation {
  profileId: string
  executablePath: string
}

/**
 * Profile CRUD (listProfiles/saveProfile/deleteProfile/importDefaultProfiles) operates on the
 * shared, synced profile list above and is available on every adapter — authoring "this service
 * item hands off to PowerPoint" doesn't require Windows or Tauri. Everything else here — the
 * per-machine implementation mapping, actual launching, and native file pickers — only makes
 * sense on the Windows/Tauri build and stays optional, same as before.
 */
export interface ExternalAppPort {
  listProfiles(): Promise<ExternalAppProfile[]>
  saveProfile(profile: ExternalAppProfile): Promise<void>
  deleteProfile(id: string): Promise<void>
  /** Adds a starter profile for each common app (PowerPoint, VLC, ...) not already present,
   *  matched by a stable id — safe to call repeatedly, never duplicates or overwrites an
   *  existing/edited profile. Returns how many were newly added. */
  importDefaultProfiles(): Promise<number>
  /** This computer's per-machine executable path for a given profile, if it's been set up here. */
  getImplementation?(profileId: string): Promise<ExternalAppImplementation | undefined>
  saveImplementation?(profileId: string, executablePath: string): Promise<void>
  /** Opens a native file picker for the profile editor's Executable field. */
  pickExecutable?(): Promise<string | undefined>
  /** Opens a native file picker for the file an Add-to-Service item hands to the app — filtered
   *  to `extensions` when given (e.g. a profile's own `allowedExtensions`), otherwise unfiltered. */
  pickFile?(extensions?: string[]): Promise<string | undefined>
  /** Always fills the configured Audience display, full screen — throws if none is assigned.
   *  Exactly one of `file`/`mediaId` identifies what to hand off: a raw path already on this
   *  computer, or a stored Media Library item (resolved to a real path at launch time). */
  launch?(profileId: string, source?: { file?: string; mediaId?: string }): Promise<void>
  /** "Launch Now" — starts this item's app ahead of time, minimized/in the background, so its
   *  cold-start delay happens before its slide goes live instead of during. A no-op if it's
   *  already running and cached from an earlier launch/prelaunch this session. */
  prelaunch?(profileId: string, source?: { file?: string; mediaId?: string }): Promise<void>
  /** Minimizes whichever app is currently engaged (if any) and restores Worship Studio's own
   *  presentation/operator windows — used when navigating to a different (non-external-app)
   *  slide mid-presentation. Doesn't close anything, so returning to the same item later reuses
   *  the same window instead of relaunching. */
  restoreSelf?(): Promise<void>
  /** Operator-triggered: closes just the currently-engaged app and forgets it, so the next time
   *  its item goes live it launches fresh rather than trying to reuse a handle the operator
   *  deliberately closed. */
  closeCurrent?(): Promise<void>
  /** Stop Presenting's counterpart to restoreSelf — closes every app launched this session
   *  (there can be more than one, across different items), not just the most recent one. */
  closeAll?(): Promise<void>
  /** Add-time robustness check (spec section 12) — executable/file existence, no launch. */
  verifyItem?(profileId: string, source?: { file?: string; mediaId?: string }): Promise<void>
  /** Basic Remote Controls — sends the given command's keyCombo to the external app's window,
   *  whether triggered by its own button or a matching keyboard shortcut while this item is
   *  live (see useExternalAppHandoff.ts's tryForwardKeydown/sendManualCommand). */
  sendKeystroke?(profileId: string, commandId: string): Promise<void>
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
    | 'external-app-command'
  index?: number
  serviceId?: string
  /** `external-app-command` only — which of the live item's ExternalAppKeyCommand entries to
   *  fire (see RemoteLiveStateUpdate.externalAppCommands, which is what the phone's buttons are
   *  built from). */
  commandId?: string
}

export interface RemoteLiveStateUpdate {
  content: LiveSlideContent | undefined
  isPresenting: boolean
  /** Tells the phone's mirror to show its own placeholder instead of `content` — see
   *  remote_server.rs's `external_app_active` doc comment for why this can't just be inferred
   *  from `content` being empty. */
  externalAppActive: boolean
  /** Every command on the live item's external-app profile (id+label only — never the key
   *  combos themselves, which are meaningless off the operator's own machine) — the phone's
   *  mirror renders one button per entry, same as ServiceWorkspaceView's live-item panel. `[]`
   *  when the live item isn't an external-app item or has no commands configured. */
  externalAppCommands: { id: string; label: string }[]
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
  lastLibraryChangeAt?: string
  conflictCount: number
  recoveryCount: number
  /** Tablet-only (adapters/tablet/cloudSync.ts) — when the last Dropbox pull/push cycle
   *  completed. Left undefined by every other adapter kind. */
  lastSyncedAt?: string
  /** Tablet-only — local edits not yet pushed to Dropbox. Left undefined by every other
   *  adapter kind. */
  pendingPushCount?: number
  /** Tablet-only — this device's cloud provider connection can't be silently renewed (e.g.
   *  OneDrive's 24h refresh-token cap once a silent reauth attempt itself fails) and needs a
   *  visible reconnect. Left undefined/false by every other adapter kind and by Dropbox, whose
   *  refresh tokens don't expire on their own. */
  needsReconnect?: boolean
  /** Tablet-only — one auth failure has been seen but it hasn't reached the consecutive-failure
   *  threshold that flips needsReconnect above, so this isn't shown as a reconnect prompt yet.
   *  useTabletSync.ts uses this to schedule a quick confirming retry rather than waiting on its
   *  normal multi-minute cadence, so a genuine reconnect need surfaces quickly. */
  reauthFailurePending?: boolean
}

/** Whether a cloud sync client (OneDrive/Dropbox's own desktop app) appears to be running,
 *  and which one — display-only, for the Library & Sync settings page (LibrarySyncSection.vue),
 *  the only place this is shown. Kept separate from SyncStatus/getStatus() above, which loads
 *  eagerly on every app launch (App.vue's startup sequence) for the app-bar badge/reconnect
 *  banner: the Tauri adapter's real detection spawns a `tasklist` subprocess, which can be
 *  genuinely slow (multi-second) the first time it's spawned, so this is only fetched lazily
 *  when that settings page is actually opened. */
export interface CloudSyncClientStatus {
  running: boolean
  /** Which known cloud sync provider ("OneDrive" / "Dropbox") the library folder appears to
   *  live inside, inferred from the folder path — see the Rust `detect_sync_provider` doc
   *  comment for how and its limits. Undefined when unrecognized; UI falls back to generic
   *  wording rather than assuming Dropbox. Tauri-only — every other adapter kind leaves it
   *  undefined along with `running`'s own always-true placeholder value. */
  name?: string
}

/** Tablet-only — live progress for a pull/push cycle currently in flight
 *  (adapters/tablet/cloudSync.ts). Polled by stores/sync.ts while a sync is running so the UI can
 *  show real numbers instead of just a spinner; undefined once nothing is in flight. */
export interface SyncProgress {
  phase: 'pull' | 'push'
  /** Items fully applied/uploaded so far this phase. */
  completed: number
  /** Total items in this phase's batch — known upfront, since a concrete provider's listChanges()
   *  and the locally-tracked dirty set are both already-resolved, complete batches. */
  total: number
  /** Root-relative path of the item currently being applied/uploaded, e.g. "songs/song-1.json" —
   *  absent for the brief moment right when a phase starts or finishes. */
  currentPath?: string
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
  /** Only ever called lazily from LibrarySyncSection.vue's own mount — see
   *  CloudSyncClientStatus's own doc comment for why this is split out of getStatus() above. */
  getCloudSyncClientStatus(): Promise<CloudSyncClientStatus>
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
  /** Tablet-only (adapters/tablet/cloudSync.ts) — triggers an immediate pull+push cycle
   *  against Dropbox. Absent on every other adapter kind, which have nothing to trigger (the
   *  desktop/web builds' "sync" is just Dropbox's own desktop client, running outside this app
   *  entirely). */
  runSync?(): Promise<void>
  /** Tablet-only — a snapshot of the currently in-flight pull/push cycle, or undefined when none
   *  is running. Absent on every other adapter kind. */
  getProgress?(): Promise<SyncProgress | undefined>
  /** Tablet-only — wipes this device's entire local cache and sync bookkeeping, then re-pulls
   *  the whole library from scratch. Discards any not-yet-pushed local edit on this device rather
   *  than pushing it first — a deliberate "trust the cloud" recovery lever, not an ordinary sync.
   *  Absent on every other adapter kind. */
  resetAndResync?(): Promise<void>
  /** Tablet-only — a lighter recovery lever than resetAndResync above: re-derives current state
   *  from the cloud (including cleaning up anything deleted upstream that an incremental sync
   *  missed) without discarding this device's own bookkeeping — an unpushed local edit stays
   *  protected, and an already-current file is never needlessly re-downloaded. See
   *  cloudSync.ts's own reconcile() doc comment for why clearing just the cursor is enough.
   *  Absent on every other adapter kind. */
  reconcile?(): Promise<void>
}

export interface DiagnosticSummary {
  generatedAt: string
  appVersion: string
  buildProfile: string
  platform: string
  architecture: string
  installationMode: 'installed' | 'portable' | 'browser-demo' | 'web' | 'tablet'
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
  /** 'tablet' is the OPFS + Dropbox-API-backed PWA build (see adapters/tablet/) — a distinct
   *  storage substrate and sync transport from 'web' (a real picked folder via
   *  showDirectoryPicker), for platforms where that picker doesn't exist (no tablet browser
   *  supports it) but still reaching the same on-disk file format the desktop app uses. */
  readonly kind: 'tauri' | 'mock' | 'web' | 'tablet'
  songs: SongPort
  services: ServicePort
  slides: SlideLibraryPort
  media: MediaPort
  /** Tauri-only local Canva integration; absent from the static browser demo. */
  canva?: CanvaPort
  themes: ThemePort
  songCollections: SongCollectionPort
  serviceTypes: ServiceTypePort
  roleGroups: RoleGroupPort
  roles: RolePort
  serviceTemplates: ServiceTemplatePort
  people: PersonPort
  announcements: AnnouncementPort
  settings: SettingsPort
  scripture: ScripturePort
  live: LivePresentationPort
  displays?: DisplayPort
  /** Profile CRUD works everywhere (shared/synced data); launch-related methods on the port
   *  itself stay optional for adapters that can't actually run a native app — see
   *  ExternalAppPort's own doc comment. */
  externalApps: ExternalAppPort
  remote?: RemotePort
  sync: SyncPort
  diagnostics: DiagnosticsPort
  exports: ExportPort
  help: HelpPort
}
