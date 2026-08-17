/**
 * SettingsPort for a File System Access-backed web build. LibrarySettings is synced (lives at
 * library-settings.json in the picked folder, same as the Tauri build); MachineSettings is
 * deliberately NOT synced — the Tauri build keeps it in the OS app-data dir, and the browser's
 * equivalent of "this machine/profile, never synced" is localStorage, not the picked folder.
 *
 * Default values below are genuinely-reasonable first-run defaults (matching the Rust backend's
 * numeric defaults for font sizes/bulletin labels), not demo/seed content — unlike
 * adapters/mock/fixtures.ts's seedLibrarySettings, a fresh real library shouldn't start with
 * fake sample service types, collections, or a placeholder church name.
 */

import type { LibrarySettings, MachineSettings } from '@/models/settings'
import type { SettingsPort } from '@/adapters/types'
import { readJsonFile, writeJsonFile } from './fsaStorage'
import { storeLibraryHandle } from './handlePersistence'

const LIBRARY_SETTINGS_PATH = 'library-settings.json'
const MACHINE_SETTINGS_KEY = 'worship-studio:web:machine-settings'

function defaultLibrarySettings(): LibrarySettings {
  return {
    branding: { churchName: '', primaryColor: '#1F3A5F', secondaryColor: '#C9A227' },
    canvaIntegration: { clientId: '', clientSecret: '' },
    dropboxIntegration: { appKey: '' },
    oneDriveIntegration: { clientId: '' },
    apiBibleTranslations: [],
    defaultTranslationCode: 'KJV',
    mediaMaxSyncedFileSizeMb: 50,
    scriptureMinFontSizePx: 72,
    scriptureMaxFontSizePx: 120,
    songMinFontSizePx: 16,
    songMaxFontSizePx: 120,
    slideHeaderFontSizePx: 48,
    slideFooterFontSizePx: 48,
    wayfindingMinFontSizePx: 56,
    wayfindingMaxFontSizePx: 150,
    bulletin: {
      page1Title: 'Order of Worship',
      page2Title: 'Announcements',
      page1FooterTitle: 'Heart Preparation',
      page1FooterEnabled: true,
      page2FooterTitle: 'Thought to Ponder',
      page2FooterEnabled: true,
      page2Enabled: true,
      showAnnouncements: true,
      showServingSchedule: true,
      servingScheduleRoleIds: [],
    },
  }
}

function defaultMachineSettings(): MachineSettings {
  return {
    thisComputerName: '',
    darkMode: true,
    libraryPath: '',
    hasCompletedSetup: false,
    localMediaPath: '',
    displayRoles: {},
  }
}

function readMachineSettings(): MachineSettings {
  const raw = localStorage.getItem(MACHINE_SETTINGS_KEY)
  if (!raw) return defaultMachineSettings()
  try {
    return { ...defaultMachineSettings(), ...(JSON.parse(raw) as Partial<MachineSettings>) }
  } catch {
    // Corrupt localStorage value — fall back rather than throw, same "never let settings
    // corruption brick the app" spirit as the Rust backend's machine-settings recovery.
    return defaultMachineSettings()
  }
}

/** Moves pre-0.9 machine-local Bible API keys into the synced library settings, mirroring
 *  src-tauri/src/commands/settings.rs's migrate_legacy_bible_api_keys exactly — existing shared
 *  values win, and ESV/api.bible migrate independently (unlike Canva's paired id+secret) since a
 *  church may only have configured one of the two. */
function migrateLegacyBibleApiKeys(
  library: LibrarySettings,
  machine: MachineSettings,
): { library: LibrarySettings; changed: boolean } {
  let changed = false
  const migrated = { ...library }
  if (!migrated.esvApiKey?.trim() && machine.esvApiKey?.trim()) {
    migrated.esvApiKey = machine.esvApiKey.trim()
    changed = true
  }
  if (!migrated.apiBibleKey?.trim() && machine.apiBibleKey?.trim()) {
    migrated.apiBibleKey = machine.apiBibleKey.trim()
    changed = true
  }
  return { library: migrated, changed }
}

export function createWebSettingsPort(root: FileSystemDirectoryHandle): SettingsPort {
  return {
    getLibrarySettings: async () => {
      const existing = await readJsonFile<LibrarySettings>(root, LIBRARY_SETTINGS_PATH)
      let settings = existing ?? defaultLibrarySettings()
      const machine = readMachineSettings()
      // Reconcile once per load rather than only when the two happen to disagree — matches the
      // Rust backend's load_library_settings, which always clears the legacy machine-local
      // fields once they've been considered, whether or not the library's own value won.
      if (machine.esvApiKey || machine.apiBibleKey) {
        const migrated = migrateLegacyBibleApiKeys(settings, machine)
        settings = migrated.library
        if (migrated.changed) {
          await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
        }
        localStorage.setItem(
          MACHINE_SETTINGS_KEY,
          JSON.stringify({ ...machine, esvApiKey: undefined, apiBibleKey: undefined }),
        )
      }
      return settings
    },
    saveLibrarySettings: async (settings) => {
      await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
    },
    getMachineSettings: async () => readMachineSettings(),
    saveMachineSettings: async (settings) => {
      // Never restore stale pre-migration keys sent by an already-open frontend — same reasoning
      // as src-tauri/src/commands/settings.rs's save_machine_settings.
      localStorage.setItem(
        MACHINE_SETTINGS_KEY,
        JSON.stringify({ ...settings, esvApiKey: undefined, apiBibleKey: undefined }),
      )
    },
    // The Tauri build returns a path string here and relies on SettingsView.vue's existing
    // "the library folder changed — reload now?" prompt (comparing it against the last-saved
    // value) to actually apply a switch, since Rust re-resolves libraryPath from disk on
    // startup. There's no path string in a browser, but the same reload is exactly what's
    // needed here too — BootGate.vue re-reads whatever handlePersistence.ts has stored on
    // every mount — so this stores the newly picked handle (replacing the one used to
    // construct the *current* adapter instance, which keeps working until reload) and returns
    // the folder's own name as the closest browser equivalent of a path, both for display and
    // so SettingsView.vue's unchanged string-comparison reload prompt still fires correctly.
    pickLibraryFolder: async () => {
      if (!('showDirectoryPicker' in window)) return undefined
      let handle: FileSystemDirectoryHandle
      try {
        handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      } catch (error) {
        // AbortError: the user cancelled the native picker — not a real failure.
        if ((error as DOMException)?.name === 'AbortError') return undefined
        throw error
      }
      await storeLibraryHandle(handle)
      return handle.name
    },
  }
}
