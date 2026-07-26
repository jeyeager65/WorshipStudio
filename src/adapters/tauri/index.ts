import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow, availableMonitors, primaryMonitor, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  StudioAdapter,
  ScripturePassage,
  ScriptureTranslation,
  DisplayInfo,
  DisplayRole,
  LiveSlideContent,
  RemoteDevice,
  RemoteCommand,
  SyncStatus,
  ConflictedItem,
  ImportSetsSummary,
  StagedMediaFile,
  MediaImportCommit,
  ExternalAppProfile,
  WindowPosition,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme, Volunteer } from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

/**
 * Real adapter — thin wrapper over Rust commands (src-tauri/src/commands).
 * songs/services/slides/settings are wired to real file-backed commands (M1).
 * Everything else below is still a placeholder command name, to be implemented
 * as its milestone lands (see docs/architecture-plan.md) — every method exists
 * now so the frontend can be built against the full interface today.
 */
export function createTauriAdapter(): StudioAdapter {
  // Presentation-window state — see the `live` port below. Kept in this closure rather than
  // module scope since each Tauri window runs its own copy of the frontend (its own call to
  // createTauriAdapter()), so this is naturally scoped to whichever window is the operator.
  let presentationWindow: WebviewWindow | undefined
  let restoreOperatorBounds: { position: LogicalPosition; size: LogicalSize } | undefined
  let lastLiveContent: LiveSlideContent | null = null
  let unlistenPresentationReady: UnlistenFn | undefined
  let identifyWindow: WebviewWindow | undefined

  // The OS doesn't hand back a stable per-monitor id, so the one thing that actually stays
  // the same across launches (Tauri's reported `name`, e.g. "\\.\DISPLAY1" on Windows) is
  // used as the key into MachineSettings.displayRoles. A monitor unplugged and replaced with
  // an identically-positioned one would be misidentified, but that's an acceptable edge case
  // for a role assignment the operator can just re-pick in Settings.
  function monitorId(monitor: Awaited<ReturnType<typeof availableMonitors>>[number], index: number): string {
    return monitor.name ?? `monitor-${index}`
  }

  async function openPresentationWindow() {
    const operatorWindow = getCurrentWindow()
    const [outerPosition, innerSize, scaleFactor] = await Promise.all([
      operatorWindow.outerPosition(),
      operatorWindow.innerSize(),
      operatorWindow.scaleFactor(),
    ])
    restoreOperatorBounds = {
      position: outerPosition.toLogical(scaleFactor),
      size: innerSize.toLogical(scaleFactor),
    }

    const monitors = await availableMonitors()
    let x: number, y: number, width: number, height: number

    if (monitors.length <= 1) {
      // Single monitor (or none reported): split its work area — excluding the
      // taskbar/dock, not the full physical resolution, or windows would get clipped by it —
      // left (operator) / right (presentation) rather than overlapping windows, since
      // there's nowhere else to put the second one.
      const monitor = monitors[0]
      if (!monitor) return
      const workAreaPosition = monitor.workArea.position.toLogical(monitor.scaleFactor)
      const workAreaSize = monitor.workArea.size.toLogical(monitor.scaleFactor)
      const halfWidth = Math.floor(workAreaSize.width / 2)

      await operatorWindow.setPosition(new LogicalPosition(workAreaPosition.x, workAreaPosition.y))
      await operatorWindow.setSize(new LogicalSize(halfWidth, workAreaSize.height))

      x = workAreaPosition.x + halfWidth
      y = workAreaPosition.y
      width = workAreaSize.width - halfWidth
      height = workAreaSize.height
    } else {
      // 2+ monitors: presentation goes fullscreen (within its work area — see above) on
      // whichever monitor Display Setup (Settings) has assigned the "audience" role to, if
      // any. Falls back to "the first monitor that isn't the primary/operator one" when
      // nothing's been assigned yet, so this still works before a first-time setup.
      const machineSettings = await invoke<MachineSettings>('get_machine_settings')
      const assignedAudience = monitors.find((m, i) => machineSettings.displayRoles[monitorId(m, i)] === 'audience')
      const primary = await primaryMonitor()
      const secondary =
        assignedAudience ??
        monitors.find((m) => m.position.x !== primary?.position.x || m.position.y !== primary?.position.y) ??
        monitors[1] ??
        monitors[0]
      const workAreaPosition = secondary.workArea.position.toLogical(secondary.scaleFactor)
      const workAreaSize = secondary.workArea.size.toLogical(secondary.scaleFactor)
      x = workAreaPosition.x
      y = workAreaPosition.y
      width = workAreaSize.width
      height = workAreaSize.height
    }

    presentationWindow = new WebviewWindow('presentation', {
      url: 'index.html',
      x,
      y,
      width,
      height,
      title: 'Worship Studio — Presentation',
      resizable: false,
      focus: false,
    })

    // The presentation window's own app instance signals readiness (see PresentationView.vue)
    // once it's actually listening — Tauri events aren't queued/replayed, so sending content
    // before that would otherwise be silently dropped and leave it blank until the next cue.
    unlistenPresentationReady = await listen('presentation:ready', () => {
      void emit('live:slide-changed', lastLiveContent)
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
    if (restoreOperatorBounds) {
      const operatorWindow = getCurrentWindow()
      await operatorWindow.setPosition(restoreOperatorBounds.position)
      await operatorWindow.setSize(restoreOperatorBounds.size)
      restoreOperatorBounds = undefined
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
    const label = monitor.name ?? `Display ${index + 1}`
    const thisWindow = new WebviewWindow('identify', {
      // A real query string, not a `#/...` hash fragment — the app uses createWebHistory
      // (path-based) routing, so a hash here would be inert. Read the same way the
      // presentation window is detected (its Tauri window label), not through vue-router —
      // this window never gets routed at all, same reasoning as PresentationView.
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
      listUpcoming: (fromDate, toDate) => invoke<Service[]>('list_upcoming_services', { fromDate, toDate }),
      importOpenSongSets: async (year, defaultServiceType) => {
        const folder = await open({ directory: true, title: 'Select OpenSong Sets Folder' })
        if (!folder || Array.isArray(folder)) return undefined
        return invoke<ImportSetsSummary>('import_opensong_sets', { setsFolder: folder, year, defaultServiceType })
      },
    },
    slides: {
      list: () => invoke<SlideLibraryItem[]>('list_slides'),
      get: (id) => invoke<SlideLibraryItem | undefined>('get_slide', { id }),
      save: (item) => invoke('save_slide', { item }),
      delete: (id) => invoke('delete_slide', { id }),
    },
    media: {
      list: () => invoke<MediaItem[]>('list_media'),
      save: (item) => invoke('save_media', { item }),
      pickFilesToImport: async () => {
        const selection = await open({
          multiple: true,
          title: 'Import Media',
          filters: [{ name: 'Images & Video Loops', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v'] }],
        })
        if (!selection) return []
        const paths = Array.isArray(selection) ? selection : [selection]
        return invoke<StagedMediaFile[]>('stage_media_import', { paths })
      },
      commitImport: (files: MediaImportCommit[]) => invoke<MediaItem[]>('commit_media_import', { files }),
      detectDuplicates: (item) => invoke<MediaItem[]>('detect_media_duplicates', { item }),
      delete: (id) => invoke('delete_media', { id }),
      getFilePath: (id) => invoke<string>('get_media_file_path', { id }),
    },
    themes: {
      list: () => invoke<Theme[]>('list_themes'),
      save: (theme) => invoke('save_theme', { theme }),
      delete: (id) => invoke('delete_theme', { id }),
    },
    volunteers: {
      list: () => invoke<Volunteer[]>('list_volunteers'),
      save: (volunteer) => invoke('save_volunteer', { volunteer }),
      delete: (id) => invoke('delete_volunteer', { id }),
    },
    settings: {
      getLibrarySettings: () => invoke<LibrarySettings>('get_library_settings'),
      saveLibrarySettings: (settings) => invoke('save_library_settings', { settings }),
      getMachineSettings: () => invoke<MachineSettings>('get_machine_settings'),
      saveMachineSettings: (settings) => invoke('save_machine_settings', { settings }),
      pickLibraryFolder: async () => {
        const folder = await open({ directory: true, title: 'Select Library Sync Folder' })
        return typeof folder === 'string' ? folder : undefined
      },
    },
    scripture: {
      resolve: (reference, translationCode) =>
        invoke<ScripturePassage>('resolve_scripture', { reference, translationCode }),
      getBookList: () => invoke<string[]>('get_scripture_book_list'),
      listTranslations: () => invoke<ScriptureTranslation[]>('list_scripture_translations'),
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
    },
    // displays/externalApps are Windows-only in practice (live-presentation role
    // assignment, Win32 window hand-off). They're wired up unconditionally here for now;
    // hiding them on the macOS build is a platform check to add once that build exists
    // (docs/architecture-plan.md M7+), not a reason to omit the ports today.
    displays: {
      // Real OS monitor enumeration (no Rust command needed — Tauri's window API already
      // exposes this) combined with the persisted role map in MachineSettings, which is the
      // one piece that actually needs to survive restarts.
      list: async () => {
        const [monitors, machineSettings] = await Promise.all([
          availableMonitors(),
          invoke<MachineSettings>('get_machine_settings'),
        ])
        return monitors.map((monitor, index): DisplayInfo => {
          const id = monitorId(monitor, index)
          const size = monitor.size.toLogical(monitor.scaleFactor)
          const role = (machineSettings.displayRoles[id] as DisplayRole | undefined) ?? 'not-used'
          return {
            id,
            name: monitor.name ?? `Display ${index + 1}`,
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
      pickExecutable: async () => {
        const selection = await open({ title: 'Select Executable', filters: [{ name: 'Executable', extensions: ['exe'] }] })
        return typeof selection === 'string' ? selection : undefined
      },
      launch: (profileId, file) => invoke('launch_external_app', { profileId, file }),
      restoreSelf: () => invoke('restore_self'),
      testLaunch: (profileId) => invoke('test_launch_external_app', { profileId }),
      captureWindowPosition: () => invoke<WindowPosition>('capture_external_app_window_position'),
    },
    remote: {
      listDevices: () => invoke<RemoteDevice[]>('list_remote_devices'),
      provisionDevice: (name, accessLevel) =>
        invoke<{ qrDataUrl: string; pairingUrl: string }>('provision_remote_device', { name, accessLevel }),
      revokeDevice: (id) => invoke('revoke_remote_device', { id }),
      getServerInfo: () => invoke<{ lanIp?: string; port: number }>('get_remote_server_info'),
      pushLiveState: (content, isPresenting) => invoke('update_remote_live_state', { content: content ?? null, isPresenting }),
      onCommand: async (callback) => {
        const unlisten = await listen<RemoteCommand>('remote:command', (event) => callback(event.payload))
        return unlisten
      },
    },
    sync: {
      getStatus: () => invoke<SyncStatus>('get_sync_status'),
      listConflicts: () => invoke<ConflictedItem[]>('list_sync_conflicts'),
      resolveConflict: (conflictFilePath, keep) =>
        invoke('resolve_sync_conflict', { conflictFilePath, keep }),
    },
    email: {
      sendOrderOfWorship: (serviceId, toAddresses, body) =>
        invoke('send_order_of_worship_email', { serviceId, toAddresses, body }),
      // Deliberately not wired to a real mail transport yet (no SMTP/API integration exists
      // anywhere in this codebase) — composing/reviewing the message is real, sending it isn't.
      sendVolunteerAssignments: async () => {},
    },
  }
}
