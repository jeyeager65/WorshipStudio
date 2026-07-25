import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { StudioAdapter, ScripturePassage, DisplayInfo, DisplayRole, RemoteDevice, SyncStatus } from '@/adapters/types'
import type { Song } from '@/models/song'
import type { Service } from '@/models/service'
import type { SlideLibraryItem, MediaItem, Theme } from '@/models/library'
import type { LibrarySettings, MachineSettings } from '@/models/settings'

/**
 * Real adapter — thin wrapper over Rust commands (src-tauri/src/commands).
 * songs/services/slides/settings are wired to real file-backed commands (M1).
 * Everything else below is still a placeholder command name, to be implemented
 * as its milestone lands (see docs/architecture-plan.md) — every method exists
 * now so the frontend can be built against the full interface today.
 */
export function createTauriAdapter(): StudioAdapter {
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
    },
    slides: {
      list: () => invoke<SlideLibraryItem[]>('list_slides'),
      get: (id) => invoke<SlideLibraryItem | undefined>('get_slide', { id }),
      save: (item) => invoke('save_slide', { item }),
      delete: (id) => invoke('delete_slide', { id }),
    },
    media: {
      list: () => invoke<MediaItem[]>('list_media'),
      import: (files) => invoke<MediaItem[]>('import_media', { files }),
      detectDuplicates: (item) => invoke<MediaItem[]>('detect_media_duplicates', { item }),
      delete: (id) => invoke('delete_media', { id }),
    },
    themes: {
      list: () => invoke<Theme[]>('list_themes'),
      save: (theme) => invoke('save_theme', { theme }),
      delete: (id) => invoke('delete_theme', { id }),
    },
    settings: {
      getLibrarySettings: () => invoke<LibrarySettings>('get_library_settings'),
      saveLibrarySettings: (settings) => invoke('save_library_settings', { settings }),
      getMachineSettings: () => invoke<MachineSettings>('get_machine_settings'),
      saveMachineSettings: (settings) => invoke('save_machine_settings', { settings }),
    },
    scripture: {
      resolve: (reference, translationCode) =>
        invoke<ScripturePassage>('resolve_scripture', { reference, translationCode }),
      getBookList: () => invoke<string[]>('get_scripture_book_list'),
    },
    live: {
      startPresenting: () => invoke('start_presenting'),
      stopPresenting: () => invoke('stop_presenting'),
      goToIndex: (flattenedIndex) => invoke('go_to_index', { flattenedIndex }),
      next: () => invoke('presentation_next'),
      previous: () => invoke('presentation_previous'),
    },
    // displays/externalApps are Windows-only in practice (live-presentation role
    // assignment, Win32 window hand-off). They're wired up unconditionally here for now;
    // hiding them on the macOS build is a platform check to add once that build exists
    // (docs/architecture-plan.md M7+), not a reason to omit the ports today.
    displays: {
      list: () => invoke<DisplayInfo[]>('list_displays'),
      assignRole: (displayId, role: DisplayRole) => invoke('assign_display_role', { displayId, role }),
      identify: (displayId) => invoke('identify_display', { displayId }),
    },
    externalApps: {
      launch: (profileId, file) => invoke('launch_external_app', { profileId, file }),
      restoreSelf: () => invoke('restore_self'),
      testLaunch: (profileId) => invoke('test_launch_external_app', { profileId }),
    },
    remote: {
      listDevices: () => invoke<RemoteDevice[]>('list_remote_devices'),
      provisionDevice: (name, accessLevel) =>
        invoke<{ qrDataUrl: string }>('provision_remote_device', { name, accessLevel }),
      revokeDevice: (id) => invoke('revoke_remote_device', { id }),
    },
    sync: {
      getStatus: () => invoke<SyncStatus>('get_sync_status'),
      listConflicts: () => invoke<unknown[]>('list_sync_conflicts'),
    },
    email: {
      sendOrderOfWorship: (serviceId, toAddresses, body) =>
        invoke('send_order_of_worship_email', { serviceId, toAddresses, body }),
    },
  }
}
