import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window'
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
  RecoveryIssue,
  ConflictedItem,
  ImportSetsSummary,
  StagedMediaFile,
  MediaImportCommit,
  ExternalAppProfile,
  WindowPosition,
  CanvaStatus,
  CanvaDesign,
  CanvaImportResult,
} from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme, Person } from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'
import { friendlyDisplayName } from '@/utils/displayName'

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
  let lastLiveContent: LiveSlideContent | null = null
  let unlistenPresentationReady: UnlistenFn | undefined
  let identifyWindow: WebviewWindow | undefined

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

  // Shared by openPresentationWindow (the real thing) and getPresentationSize (the operator's
  // Previous/Current/Next preview thumbnails, which need the exact same size to make the same
  // auto-fit sizing/wrapping decisions the real presentation window would) — computed once
  // here so the two can never drift apart into two different answers for "how big is it".
  async function computePresentationBounds(): Promise<PresentationBounds | undefined> {
    const monitors = await availableMonitors()

    if (monitors.length <= 1) return undefined

    // Presentation only runs on a distinct monitor explicitly assigned as Audience. Guessing
    // from monitor order risks putting private operator content on the projector after Windows
    // renumbers displays, and the old single-monitor split was not useful to a congregation.
    const [machineSettings, operatorMonitor] = await Promise.all([
      invoke<MachineSettings>('get_machine_settings'),
      currentMonitor(),
    ])
    const assignedAudience = monitors.find(
      (m, i) =>
        !isSameMonitor(m, operatorMonitor) &&
        machineSettings.displayRoles[monitorId(m, i)] === 'audience',
    )
    if (!assignedAudience) return undefined
    const workAreaPosition = assignedAudience.workArea.position.toLogical(
      assignedAudience.scaleFactor,
    )
    const workAreaSize = assignedAudience.workArea.size.toLogical(assignedAudience.scaleFactor)
    return {
      x: workAreaPosition.x,
      y: workAreaPosition.y,
      width: workAreaSize.width,
      height: workAreaSize.height,
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
      listUpcoming: (fromDate, toDate) =>
        invoke<Service[]>('list_upcoming_services', { fromDate, toDate }),
      importOpenSongSets: async (year, defaultServiceType) => {
        const folder = await open({ directory: true, title: 'Select OpenSong Sets Folder' })
        if (!folder || Array.isArray(folder)) return undefined
        return invoke<ImportSetsSummary>('import_opensong_sets', {
          setsFolder: folder,
          year,
          defaultServiceType,
        })
      },
      migrateLegacySermonFields: () => invoke('migrate_legacy_sermon_fields'),
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
          filters: [
            {
              name: 'Images & Videos',
              extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v'],
            },
          ],
        })
        if (!selection) return []
        const paths = Array.isArray(selection) ? selection : [selection]
        return invoke<StagedMediaFile[]>('stage_media_import', { paths })
      },
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
    },
    canva: {
      status: () => invoke<CanvaStatus>('get_canva_status'),
      connect: () => invoke('connect_canva'),
      disconnect: () => invoke('disconnect_canva'),
      listDesigns: () => invoke<CanvaDesign[]>('list_canva_designs'),
      createDesign: (title) => invoke<CanvaDesign>('create_canva_design', { title }),
      openDesign: (designId) => invoke('open_canva_design', { designId }),
      importDesign: (designId, existingPages = []) =>
        invoke<CanvaImportResult>('import_canva_design', { designId, existingPages }),
    },
    themes: {
      list: () => invoke<Theme[]>('list_themes'),
      save: (theme) => invoke('save_theme', { theme }),
      delete: (id) => invoke('delete_theme', { id }),
    },
    people: {
      list: () => invoke<Person[]>('list_people'),
      save: (person) => invoke('save_person', { person }),
      delete: (id) => invoke('delete_person', { id }),
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
    // (docs/architecture-plan.md M7+), not a reason to omit the ports today.
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
      pickExecutable: async () => {
        const selection = await open({
          title: 'Select Executable',
          filters: [{ name: 'Executable', extensions: ['exe'] }],
        })
        return typeof selection === 'string' ? selection : undefined
      },
      pickFile: async () => {
        const selection = await open({ title: 'Select File' })
        return typeof selection === 'string' ? selection : undefined
      },
      launch: (profileId, file) => invoke('launch_external_app', { profileId, file }),
      restoreSelf: () => invoke('restore_self'),
      testLaunch: (profileId) => invoke('test_launch_external_app', { profileId }),
      captureWindowPosition: () => invoke<WindowPosition>('capture_external_app_window_position'),
      verifyItem: (profileId, file) => invoke('verify_external_app_item', { profileId, file }),
      sendKeystroke: (profileId, direction) =>
        invoke('send_external_app_keystroke', { profileId, direction }),
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
      pushLiveState: (content, isPresenting) =>
        invoke('update_remote_live_state', { content: content ?? null, isPresenting }),
      onCommand: async (callback) => {
        const unlisten = await listen<RemoteCommand>('remote:command', (event) =>
          callback(event.payload),
        )
        return unlisten
      },
    },
    sync: {
      getStatus: () => invoke<SyncStatus>('get_sync_status'),
      listRecoveryIssues: () => invoke<RecoveryIssue[]>('list_recovery_issues'),
      recoverFile: (filePath) => invoke('recover_library_file', { filePath }),
      quarantineFile: (filePath) => invoke<string>('quarantine_library_file', { filePath }),
      listConflicts: () => invoke<ConflictedItem[]>('list_sync_conflicts'),
      resolveConflict: (conflictFilePath, keep) =>
        invoke('resolve_sync_conflict', { conflictFilePath, keep }),
    },
    email: {
      // Deliberately not wired to a real mail transport yet (no SMTP/API integration exists
      // anywhere in this codebase) — composing/reviewing the message is real, sending it isn't.
      // (sendOrderOfWorship previously called a `send_order_of_worship_email` Rust command that
      // was never actually implemented/registered — invoking it would have thrown as soon as
      // anything actually called this, which nothing did until now.)
      sendOrderOfWorship: async () => {},
      sendAssignments: async () => {},
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
  }
}
