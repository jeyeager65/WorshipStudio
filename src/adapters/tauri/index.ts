import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  StudioAdapter,
  ScripturePassage,
  ScriptureTranslation,
  ApiBibleCatalogEntry,
  DisplayInfo,
  DisplayRole,
  LiveSlideContent,
  RemoteDevice,
  RemoteCommand,
  SyncStatus,
  CloudSyncClientStatus,
  RecoveryIssue,
  ConflictedItem,
  ImportSetsSummary,
  StagedMediaFile,
  MediaImportCommit,
  ExternalAppProfile,
  ExternalAppImplementation,
  WindowPosition,
  CanvaStatus,
  CanvaDesign,
  CanvaImportResult,
  CanvaExportPreview,
  CanvaVideoExportResult,
  CanvaVideoPreview,
  DiagnosticSummary,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service, ServiceTemplate } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme, Person } from '@/models/library'
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
import { friendlyDisplayName } from '@/utils/displayName'
import { generateQrCodeDataUrl } from '@/utils/qrCode'

/**
 * Real adapter — thin wrapper over Rust commands (src-tauri/src/commands).
 * songs/services/slides/settings are wired to real file-backed commands (M1).
 * Everything else below is still a placeholder command name, to be implemented
 * as its milestone lands (see notes/architecture-plan.md) — every method exists
 * now so the frontend can be built against the full interface today.
 */
export function createTauriAdapter(): StudioAdapter {
  // Presentation-window state — see the `live` port below. Kept in this closure rather than
  // module scope since each Tauri window runs its own copy of the frontend (its own call to
  // createTauriAdapter()), so this is naturally scoped to whichever window is the operator.
  let presentationWindow: WebviewWindow | undefined
  let lastLiveContent: LiveSlideContent | null = null
  let unlistenPresentationReady: UnlistenFn | undefined
  let identifyWindow: WebviewWindow | undefined
  let helpWindow: WebviewWindow | undefined

  // The OS doesn't hand back a stable per-monitor id, so the one thing that actually stays
  // the same across launches (Tauri's reported `name`, e.g. "\\.\DISPLAY1" on Windows) is
  // used as the key into MachineSettings.displayRoles. A monitor unplugged and replaced with
  // an identically-positioned one would be misidentified, but that's an acceptable edge case
  // for a role assignment the operator can just re-pick in Settings.
  function monitorId(
    monitor: Awaited<ReturnType<typeof availableMonitors>>[number],
    index: number,
  ): string {
    return monitor.name ?? `monitor-${index}`
  }

  function isSameMonitor(
    left: Awaited<ReturnType<typeof availableMonitors>>[number],
    right: Awaited<ReturnType<typeof availableMonitors>>[number] | null,
  ): boolean {
    if (!right) return false
    if (left.name && right.name) return left.name === right.name
    return left.position.x === right.position.x && left.position.y === right.position.y
  }

  interface PresentationBounds {
    x: number
    y: number
    width: number
    height: number
  }

  // Shared by computePresentationBounds and the External App Hand-off launch below — both need
  // "which monitor is Audience", just converted to different pixel spaces afterward (see each
  // caller). Presentation only runs on a distinct monitor explicitly assigned as Audience.
  // Guessing from monitor order risks putting private operator content on the projector after
  // Windows renumbers displays, and the old single-monitor split was not useful to a
  // congregation.
  async function findAssignedAudienceMonitor() {
    const monitors = await availableMonitors()
    if (monitors.length <= 1) return undefined
    const [machineSettings, operatorMonitor] = await Promise.all([
      invoke<MachineSettings>('get_machine_settings'),
      currentMonitor(),
    ])
    return monitors.find(
      (m, i) =>
        !isSameMonitor(m, operatorMonitor) &&
        machineSettings.displayRoles[monitorId(m, i)] === 'audience',
    )
  }

  // Shared by openPresentationWindow (the real thing) and getPresentationSize (the operator's
  // Previous/Current/Next preview thumbnails, which need the exact same size to make the same
  // auto-fit sizing/wrapping decisions the real presentation window would) — computed once
  // here so the two can never drift apart into two different answers for "how big is it".
  async function computePresentationBounds(): Promise<PresentationBounds | undefined> {
    const assignedAudience = await findAssignedAudienceMonitor()
    if (!assignedAudience) return undefined
    // Presentation uses the monitor's complete bounds, not its work area. The work area omits
    // reserved desktop UI such as the Windows taskbar, which both made the audience output short
    // and caused the operator previews to model the wrong presentation aspect ratio.
    const monitorPosition = assignedAudience.position.toLogical(assignedAudience.scaleFactor)
    const monitorSize = assignedAudience.size.toLogical(assignedAudience.scaleFactor)
    return {
      x: monitorPosition.x,
      y: monitorPosition.y,
      width: monitorSize.width,
      height: monitorSize.height,
    }
  }

  // External App Hand-off's window positioning goes through raw Win32 SetWindowPos (see
  // src-tauri/src/domain/win32.rs), which works in *physical* pixels — unlike
  // computePresentationBounds above (used only to create Tauri's own WebviewWindow, whose x/y/
  // width/height are logical), this deliberately skips the .toLogical() conversion.
  async function computeAudienceMonitorPhysicalBounds(): Promise<WindowPosition | undefined> {
    const assignedAudience = await findAssignedAudienceMonitor()
    if (!assignedAudience) return undefined
    return {
      monitorId: assignedAudience.name ?? 'audience',
      x: assignedAudience.position.x,
      y: assignedAudience.position.y,
      width: assignedAudience.size.width,
      height: assignedAudience.size.height,
    }
  }

  async function openPresentationWindow() {
    const bounds = await computePresentationBounds()
    if (!bounds) throw new Error('No configured audience display is available.')

    presentationWindow = new WebviewWindow('presentation', {
      url: 'index.html',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      title: 'Worship Studio — Presentation',
      decorations: false,
      fullscreen: true,
      skipTaskbar: true,
      resizable: false,
      focus: false,
      // Ctrl/Cmd +/-/0 as a quick manual scaling knob for the audience output — the same
      // capability the web build's audience window already gets for free from being a real
      // browser window. Windows: WebView2's IsZoomControlEnabled; macOS/Linux: Tauri's own
      // ctrl/cmd +/- polyfill (20% steps, 20%-1000%).
      zoomHotkeysEnabled: true,
    })

    // The presentation window's own app instance signals readiness (see PresentationView.vue)
    // once it's actually listening — Tauri events aren't queued/replayed, so sending content
    // before that would otherwise be silently dropped and leave it blank until the next cue.
    unlistenPresentationReady = await listen('presentation:ready', () => {
      void emit('live:slide-changed', lastLiveContent)
      // Windows appears to force focus onto a window the moment it enters fullscreen, regardless
      // of this window's own `focus: false` creation flag above — confirmed live: without this,
      // the operator has to click back into the main window before Prev/Next keyboard shortcuts
      // work again after Start Presenting. Reasserted here (once the presentation window has
      // actually finished loading and settled into fullscreen), not right after creation, since
      // the OS's own focus-steal can happen slightly after that point too.
      void getCurrentWindow().setFocus()
    })
  }

  async function closePresentationWindow() {
    unlistenPresentationReady?.()
    unlistenPresentationReady = undefined
    lastLiveContent = null
    if (presentationWindow) {
      await presentationWindow.close()
      presentationWindow = undefined
    }
  }

  // Briefly shows a large label centered on the given monitor — the only way to answer
  // "which physical screen is THIS one" when a church's booth has several identical-looking
  // displays. Reuses the same app bundle/router as the presentation window (see App.vue's
  // window-label branch) rather than a bespoke HTML page.
  async function identifyDisplay(displayId: string) {
    const monitors = await availableMonitors()
    const index = monitors.findIndex((m, i) => monitorId(m, i) === displayId)
    const monitor = monitors[index]
    if (!monitor) return

    const workAreaPosition = monitor.workArea.position.toLogical(monitor.scaleFactor)
    const workAreaSize = monitor.workArea.size.toLogical(monitor.scaleFactor)
    const width = 360
    const height = 240
    const x = workAreaPosition.x + workAreaSize.width / 2 - width / 2
    const y = workAreaPosition.y + workAreaSize.height / 2 - height / 2

    if (identifyWindow) {
      await identifyWindow.close()
      identifyWindow = undefined
    }
    const label = friendlyDisplayName(monitor.name, index)
    const thisWindow = new WebviewWindow('identify', {
      // A real query string, not appended after the router's own `#/...` hash fragment, which
      // would just become part of vue-router's route instead of reaching here. Read the same
      // way the presentation window is detected (its Tauri window label), not through
      // vue-router — this window never gets routed at all, same reasoning as PresentationView.
      url: `index.html?identify=${encodeURIComponent(label)}`,
      x,
      y,
      width,
      height,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: false,
    })
    identifyWindow = thisWindow
    setTimeout(() => {
      if (identifyWindow === thisWindow) identifyWindow = undefined
      void thisWindow.close()
    }, 2500)
  }

  // Opens the bundled VitePress help site at the given topic — or, if it's already open,
  // navigates that same window to the new topic instead of closing and recreating it.
  // Window *creation* stays here in the frontend, same as presentation/identify — a Rust-side
  // attempt at creating it too (so the whole thing could go through one code path) turned out
  // unreliable in practice, confirmed live, repeatedly: a window built from a `#[tauri::command]`
  // never finished loading (`about:blank` forever, independent of which URL-scheme variant or
  // thread it ran on), which was also what made it unresponsive to close. Real navigation of an
  // *already-open* window still needs Rust (`commands::help::navigate_help_window`) — there's no
  // `WebviewWindow.navigate` on the JS side — but only ever runs against a window this same
  // frontend code already created and confirmed loads real content.
  //
  // Existence is tracked via this closure variable (same pattern as presentation/identify
  // above), updated only by a `tauri://destroyed` listener on the window this code itself
  // created — not by asking Tauri's backend "does a window labeled 'help' exist right now"
  // (`WebviewWindow.getByLabel`/`get_webview_window` on the Rust side). That backend registry
  // check is provably unreliable here: after closing the window programmatically in an
  // automated test, the backend kept reporting the window as present and successfully
  // navigable — no visible window, no error, just a live reference to nothing — which the
  // event-driven approach below never observed.
  //
  // The site itself is embedded at compile time and served through the `help` URI scheme
  // registered in lib.rs, not the generic Tauri asset protocol — the asset protocol
  // percent-encodes a whole absolute file path as one opaque blob (confirmed live: every one
  // of the site's own relative CSS/JS/font references 404'd against it), which only works for
  // single-file references, not a multi-file site with internal relative links.
  async function openHelp(topic: string) {
    const [slug, anchor] = topic.split('#')
    const url = convertFileSrc(`${slug}.html`, 'help') + (anchor ? `#${anchor}` : '')

    if (helpWindow) {
      const navigated = await invoke<boolean>('navigate_help_window', { url })
      if (navigated) return
      helpWindow = undefined
    }

    const thisWindow = new WebviewWindow('help', {
      url,
      title: 'Worship Studio Help',
      width: 1400,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      focus: true,
      // Unlike main/presentation/identify, this window loads a plain static site with no
      // Tauri-aware drag-region/window-controls of its own — needs real OS chrome to be
      // movable/closable at all.
    })
    helpWindow = thisWindow
    await thisWindow.once('tauri://destroyed', () => {
      if (helpWindow === thisWindow) helpWindow = undefined
    })
    // `focus: true` above isn't enough on its own — verified live that a freshly created
    // window can still land behind the already-focused main window without an explicit
    // setFocus() call once it's actually ready (same two-step handoff App.vue's own
    // splash-to-main handoff uses at startup).
    await thisWindow.once('tauri://created', () => {
      void thisWindow.show()
      void thisWindow.setFocus()
    })
  }

  return {
    kind: 'tauri',
    songs: {
      list: () => invoke<Song[]>('list_songs'),
      get: (id) => invoke<Song | undefined>('get_song', { id }),
      save: (song) => invoke('save_song', { song }),
      delete: (id) => invoke('delete_song', { id }),
      importFromOpenSongXml: (xml) => invoke<Song>('import_song_opensong_xml', { xml }),
      importFromOpenSongFiles: async () => {
        const selection = await open({ multiple: true, title: 'Import OpenSong Songs' })
        if (!selection) return []
        const paths = Array.isArray(selection) ? selection : [selection]
        const created: Song[] = []
        for (const path of paths) {
          const xml = await invoke<string>('read_text_file', { path })
          created.push(await invoke<Song>('import_song_opensong_xml', { xml }))
        }
        return created
      },
    },
    services: {
      list: () => invoke<Service[]>('list_services'),
      get: (id) => invoke<Service | undefined>('get_service', { id }),
      save: (service) => invoke('save_service', { service }),
      delete: (id) => invoke('delete_service', { id }),
      listUpcoming: (fromDate, toDate) =>
        invoke<Service[]>('list_upcoming_services', { fromDate, toDate }),
      importOpenSongSets: async (year, defaultServiceTypeId) => {
        const folder = await open({ directory: true, title: 'Select OpenSong Sets Folder' })
        if (!folder || Array.isArray(folder)) return undefined
        return invoke<ImportSetsSummary>('import_opensong_sets', {
          setsFolder: folder,
          year,
          defaultServiceTypeId,
        })
      },
    },
    slides: {
      list: () => invoke<SlideLibraryItem[]>('list_slides'),
      get: (id) => invoke<SlideLibraryItem | undefined>('get_slide', { id }),
      save: (item) => invoke('save_slide', { item }),
      delete: (id) => invoke('delete_slide', { id }),
      generateQrCode: (content) => generateQrCodeDataUrl(content),
    },
    media: {
      list: () => invoke<MediaItem[]>('list_media'),
      save: (item) => invoke('save_media', { item }),
      pickFilesToImport: async (extensions) => {
        const selection = await open({
          multiple: true,
          title: 'Import Media',
          // `extensions` unset (the plain "Import Media" button): the usual image/video filter.
          // `extensions` a non-empty array (a profile's own allowedExtensions, e.g. ['pptx']):
          // restrict to those instead. `extensions` explicitly `[]` (a profile with no
          // restriction configured, or the Media Library's own "Import File" button): no filter
          // at all — otherwise a .pptx could never be selected here in the first place.
          filters:
            extensions === undefined
              ? [
                  {
                    name: 'Images & Videos',
                    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v'],
                  },
                ]
              : extensions.length > 0
                ? [{ name: 'Allowed Files', extensions }]
                : undefined,
        })
        if (!selection) return []
        const paths = Array.isArray(selection) ? selection : [selection]
        return invoke<StagedMediaFile[]>('stage_media_import', { paths })
      },
      // A staged file's `path` is its real source path on disk (see stage_imports's own
      // doc comment on domain::media::StagedMediaFile) — still there until commit actually
      // copies it into the library, so this needs no Rust round trip, just the same
      // convertFileSrc wrapping getPreviewUrl below does for committed items.
      getStagedPreviewUrl: async (path) => convertFileSrc(path),
      commitImport: (files: MediaImportCommit[]) =>
        invoke<MediaItem[]>('commit_media_import', { files }),
      detectDuplicates: (item) => invoke<MediaItem[]>('detect_media_duplicates', { item }),
      delete: (id) => invoke('delete_media', { id }),
      getFilePath: (id) => invoke<string>('get_media_file_path', { id }),
      getPreviewUrl: async (id) => {
        try {
          return convertFileSrc(await invoke<string>('get_media_file_path', { id }))
        } catch {
          // Missing file, deleted item, etc. — the grid falls back to a placeholder rather
          // than surface an error for what's just a thumbnail.
          return undefined
        }
      },
      importStockBackgrounds: () =>
        invoke<{ mediaAdded: number; themesAdded: number }>('import_stock_backgrounds'),
    },
    canva: {
      status: () => invoke<CanvaStatus>('get_canva_status'),
      connect: () => invoke('connect_canva'),
      disconnect: () => invoke('disconnect_canva'),
      listDesigns: () => invoke<CanvaDesign[]>('list_canva_designs'),
      createDesign: (title) => invoke<CanvaDesign>('create_canva_design', { title }),
      openDesign: (designId) => invoke('open_canva_design', { designId }),
      previewExport: (designId) =>
        invoke<CanvaExportPreview>('preview_canva_design_export', { designId }),
      importPages: (designId, pages) =>
        invoke<CanvaImportResult>('import_canva_pages', { designId, pages }),
      previewVideoExport: (designId) =>
        invoke<CanvaVideoPreview>('preview_canva_video_export', { designId }),
      importVideo: (designId, tempPath, location) =>
        invoke<CanvaVideoExportResult>('import_canva_video', { designId, tempPath, location }),
    },
    themes: {
      list: () => invoke<Theme[]>('list_themes'),
      save: (theme) => invoke('save_theme', { theme }),
      delete: (id) => invoke('delete_theme', { id }),
    },
    songCollections: {
      list: () => invoke<SongCollectionDefinition[]>('list_song_collections'),
      save: (collection) =>
        invoke<SongCollectionDefinition>('save_song_collection', { collection }),
      delete: (id) => invoke('delete_song_collection', { id }),
    },
    serviceTypes: {
      list: () => invoke<ServiceTypeDefinition[]>('list_service_types'),
      save: (serviceType) =>
        invoke<ServiceTypeDefinition>('save_service_type', { serviceType }),
      delete: (id) => invoke('delete_service_type', { id }),
    },
    roleGroups: {
      list: () => invoke<RoleGroupDefinition[]>('list_role_groups'),
      save: (roleGroup) => invoke<RoleGroupDefinition>('save_role_group', { roleGroup }),
      delete: (id) => invoke('delete_role_group', { id }),
    },
    roles: {
      list: () => invoke<RoleDefinition[]>('list_roles'),
      save: (role) => invoke<RoleDefinition>('save_role', { role }),
      delete: (id) => invoke('delete_role', { id }),
    },
    serviceTemplates: {
      list: () => invoke<ServiceTemplate[]>('list_service_templates'),
      save: (serviceTemplate) =>
        invoke<ServiceTemplate>('save_service_template', { serviceTemplate }),
      delete: (id) => invoke('delete_service_template', { id }),
    },
    people: {
      list: () => invoke<Person[]>('list_people'),
      save: (person) => invoke('save_person', { person }),
      delete: (id) => invoke('delete_person', { id }),
    },
    announcements: {
      list: () => invoke<Announcement[]>('list_announcements'),
      save: (announcement) => invoke('save_announcement', { announcement }),
      delete: (id) => invoke('delete_announcement', { id }),
    },
    settings: {
      getLibrarySettings: () => invoke<LibrarySettings>('get_library_settings'),
      saveLibrarySettings: (settings) => invoke('save_library_settings', { settings }),
      getLibraryCredentials: () => invoke<LibraryCredentials>('get_library_credentials'),
      saveLibraryCredentials: (credentials) =>
        invoke('save_library_credentials', { credentials }),
      getMachineSettings: () => invoke<MachineSettings>('get_machine_settings'),
      saveMachineSettings: (settings) => invoke('save_machine_settings', { settings }),
      pickLibraryFolder: async () => {
        const folder = await open({ directory: true, title: 'Select Library Sync Folder' })
        return typeof folder === 'string' ? folder : undefined
      },
      getDataLocation: () => invoke<DataLocation>('get_data_location'),
      saveDataLocation: (localRootPath) => invoke('save_data_location', { localRootPath }),
      pickDataLocationFolder: async () => {
        const folder = await open({ directory: true, title: 'Select Local Data Folder' })
        return typeof folder === 'string' ? folder : undefined
      },
      clearSettingsListBackups: () => invoke('clear_settings_list_backups'),
    },
    scripture: {
      resolve: (reference, translationCode) =>
        invoke<ScripturePassage>('resolve_scripture', { reference, translationCode }),
      getBookList: () => invoke<string[]>('get_scripture_book_list'),
      listTranslations: () => invoke<ScriptureTranslation[]>('list_scripture_translations'),
      listApiBibleCatalog: (apiKey) =>
        invoke<ApiBibleCatalogEntry[]>('list_api_bible_catalog', { apiKey }),
    },
    live: {
      startPresenting: () => openPresentationWindow(),
      stopPresenting: () => closePresentationWindow(),
      goToIndex: (flattenedIndex) => invoke('go_to_index', { flattenedIndex }),
      next: () => invoke('presentation_next'),
      previous: () => invoke('presentation_previous'),
      setLiveContent: async (content) => {
        lastLiveContent = content ?? null
        await emit('live:slide-changed', lastLiveContent)
      },
      getPresentationSize: async () => {
        const bounds = await computePresentationBounds()
        return bounds ? { width: bounds.width, height: bounds.height } : undefined
      },
    },
    // displays/externalApps are Windows-only in practice (live-presentation role
    // assignment, Win32 window hand-off). They're wired up unconditionally here for now;
    // hiding them on the macOS build is a platform check to add once that build exists
    // (notes/architecture-plan.md M7+), not a reason to omit the ports today.
    displays: {
      // Real OS monitor enumeration (no Rust command needed — Tauri's window API already
      // exposes this) combined with the persisted role map in MachineSettings, which is the
      // one piece that actually needs to survive restarts.
      list: async () => {
        const [monitors, machineSettings, operatorMonitor] = await Promise.all([
          availableMonitors(),
          invoke<MachineSettings>('get_machine_settings'),
          currentMonitor(),
        ])
        return monitors.map((monitor, index): DisplayInfo => {
          const id = monitorId(monitor, index)
          const size = monitor.size.toLogical(monitor.scaleFactor)
          const role = isSameMonitor(monitor, operatorMonitor)
            ? 'operator'
            : ((machineSettings.displayRoles[id] as DisplayRole | undefined) ?? 'not-used')
          return {
            id,
            name: friendlyDisplayName(monitor.name, index),
            resolution: `${Math.round(size.width)}x${Math.round(size.height)}`,
            role,
          }
        })
      },
      assignRole: async (displayId, role: DisplayRole) => {
        const machineSettings = await invoke<MachineSettings>('get_machine_settings')
        machineSettings.displayRoles[displayId] = role
        await invoke('save_machine_settings', { settings: machineSettings })
      },
      identify: (displayId) => identifyDisplay(displayId),
    },
    externalApps: {
      listProfiles: () => invoke<ExternalAppProfile[]>('list_external_app_profiles'),
      saveProfile: (profile) => invoke('save_external_app_profile', { profile }),
      deleteProfile: (id) => invoke('delete_external_app_profile', { id }),
      importDefaultProfiles: () => invoke<number>('import_default_external_app_profiles'),
      getImplementation: (profileId) =>
        invoke<ExternalAppImplementation | undefined>('get_external_app_implementation', {
          profileId,
        }),
      saveImplementation: (profileId, executablePath) =>
        invoke('save_external_app_implementation', { profileId, executablePath }),
      pickExecutable: async () => {
        const selection = await open({
          title: 'Select Executable',
          filters: [{ name: 'Executable', extensions: ['exe'] }],
        })
        return typeof selection === 'string' ? selection : undefined
      },
      pickFile: async (extensions) => {
        const selection = await open({
          title: 'Select File',
          filters: extensions?.length ? [{ name: 'Allowed Files', extensions }] : undefined,
        })
        return typeof selection === 'string' ? selection : undefined
      },
      // Always fills the configured Audience display, full screen — computed fresh from the
      // current monitor layout on every launch. There's no per-profile position to fall back
      // to, so a missing Audience display is a hard error here rather than a silent no-op —
      // same reasoning as openPresentationWindow's identical check above.
      launch: async (profileId, source) => {
        const audienceBounds = await computeAudienceMonitorPhysicalBounds()
        if (!audienceBounds) throw new Error('No configured audience display is available.')
        return invoke('launch_external_app', {
          profileId,
          file: source?.file,
          mediaId: source?.mediaId,
          audienceBounds,
        })
      },
      // Deliberately doesn't need an audience-bounds check the way launch does — this never
      // positions or shows the window, just gets it running quietly in the background.
      prelaunch: (profileId, source) =>
        invoke('prelaunch_external_app', {
          profileId,
          file: source?.file,
          mediaId: source?.mediaId,
        }),
      restoreSelf: () => invoke('restore_self'),
      closeCurrent: () => invoke('close_current_external_app'),
      closeAll: () => invoke('close_all_external_apps'),
      verifyItem: (profileId, source) =>
        invoke('verify_external_app_item', {
          profileId,
          file: source?.file,
          mediaId: source?.mediaId,
        }),
      sendKeystroke: (profileId, commandId) =>
        invoke('send_external_app_keystroke', { profileId, commandId }),
    },
    remote: {
      listDevices: () => invoke<RemoteDevice[]>('list_remote_devices'),
      provisionDevice: (personId, name, accessLevel) =>
        invoke<{ qrDataUrl: string; pairingUrl: string }>('provision_remote_device', {
          personId,
          name,
          accessLevel,
        }),
      repairDevice: (id) =>
        invoke<{ qrDataUrl: string; pairingUrl: string }>('repair_remote_device', { id }),
      revokeDevice: (id) => invoke('revoke_remote_device', { id }),
      getServerInfo: () =>
        invoke<{ hostname?: string; lanIp?: string; port: number }>('get_remote_server_info'),
      pushLiveState: (update) =>
        invoke('update_remote_live_state', {
          payload: {
            content: update.content ?? null,
            isPresenting: update.isPresenting,
            externalAppActive: update.externalAppActive,
            externalAppCommands: update.externalAppCommands,
            displayWidth: update.displaySize.width,
            displayHeight: update.displaySize.height,
            isBlankScreen: update.isBlankScreen,
            backgroundOnly: update.backgroundOnly,
          },
        }),
      pushServiceOutline: (slides) => invoke('update_remote_service_outline', { slides }),
      pushServiceOpen: (open) => invoke('update_remote_service_open', { open }),
      onCommand: async (callback) => {
        const unlisten = await listen<RemoteCommand>('remote:command', (event) =>
          callback(event.payload),
        )
        return unlisten
      },
    },
    sync: {
      getStatus: () => invoke<SyncStatus>('get_sync_status'),
      getCloudSyncClientStatus: () =>
        invoke<CloudSyncClientStatus>('get_cloud_sync_client_status'),
      listRecoveryIssues: () => invoke<RecoveryIssue[]>('list_recovery_issues'),
      recoverFile: (filePath) => invoke('recover_library_file', { filePath }),
      quarantineFile: (filePath) => invoke<string>('quarantine_library_file', { filePath }),
      listConflicts: () => invoke<ConflictedItem[]>('list_sync_conflicts'),
      resolveConflict: (conflictFilePath, keep) =>
        invoke('resolve_sync_conflict', { conflictFilePath, keep }),
    },
    diagnostics: {
      getSummary: () => invoke<DiagnosticSummary>('get_diagnostic_summary'),
      createBundle: () => invoke<string>('create_diagnostic_bundle'),
      openLogsFolder: () => invoke('open_logs_folder'),
    },
    exports: {
      saveFile: async ({ suggestedName, extensions, bytes }, options) => {
        const path = await save({
          defaultPath: suggestedName,
          filters: [
            {
              name: extensions.map((extension) => extension.toUpperCase()).join(' / '),
              extensions,
            },
          ],
        })
        if (!path) return 'cancelled'
        await invoke('write_binary_file', { path, contents: Array.from(bytes) })
        if (options?.openAfterSave) {
          try {
            await invoke('open_file', { path })
            return 'opened'
          } catch (error) {
            // The report still exists at the chosen location. Treat an association/launcher
            // problem separately so the UI never claims that generation itself failed.
            console.warn('Report saved, but its desktop application could not be opened', error)
          }
        }
        return 'saved'
      },
    },
    help: {
      open: openHelp,
    },
  }
}
