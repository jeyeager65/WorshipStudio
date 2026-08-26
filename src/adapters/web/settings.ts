/**
 * SettingsPort for a File System Access-backed web build. LibrarySettings/LibraryCredentials are
 * both synced (live at library-settings.json/credentials.json in the picked folder, same as the
 * Tauri build); MachineSettings is deliberately NOT synced — the Tauri build keeps it in the OS
 * app-data dir, and the browser's equivalent of "this machine/profile, never synced" is
 * localStorage, not the picked folder.
 *
 * Default values below are genuinely-reasonable first-run defaults (matching the Rust backend's
 * numeric defaults for font sizes/bulletin labels), not demo/seed content — unlike
 * adapters/mock/fixtures.ts's seedLibrarySettings, a fresh real library shouldn't start with
 * fake sample service types, collections, or a placeholder church name.
 */

import type { LibraryCredentials, LibrarySettings, MachineSettings } from '@/models/settings'
import type { SettingsPort } from '@/adapters/types'
import { suggestDeviceNameForThisBrowser } from '@/utils/deviceName'
import { backupPath, readJsonFile, removeFile, writeJsonFile } from './fsaStorage'
import { storeLibraryHandle } from './handlePersistence'

const LIBRARY_SETTINGS_PATH = 'library-settings.json'
const CREDENTIALS_PATH = 'credentials.json'
const MACHINE_SETTINGS_KEY = 'worship-studio:web:machine-settings'

// Mirrors src-tauri/src/commands/settings.rs's clear_settings_list_backups exactly — same six
// filenames (see each adapters/web/*.ts port's own *_PATH constant), same exclusion of
// library-settings.json.backup/credentials.json.backup (neither file is ever touched by Clear
// Existing Data, so neither backup should be swept away).
const SETTINGS_LIST_FILES = [
  'song-collections.json',
  'service-types.json',
  'role-groups.json',
  'roles.json',
  'service-templates.json',
  'external-app-profiles.json',
]

function defaultLibrarySettings(): LibrarySettings {
  return {
    branding: { churchName: '', primaryColor: '#1F3A5F', secondaryColor: '#C9A227' },
    apiBibleTranslations: [],
    defaultTranslationCode: 'KJV',
    mediaMaxSyncedFileSizeMb: 50,
    fontSizesPx: {
      scripture: { min: 72, max: 120 },
      song: { min: 16, max: 120 },
      slide: { header: 48, footer: 48 },
      wayfinding: { min: 56, max: 150 },
    },
    bulletin: {
      page1: {
        title: 'Order of Worship',
        footer: { title: 'Heart Preparation', enabled: true },
      },
      page2: {
        enabled: true,
        title: 'Announcements',
        footer: { title: 'Thought to Ponder', enabled: true },
        announcements: { enabled: true },
        servingSchedule: { enabled: true, roleIds: [] },
      },
    },
  }
}

function defaultLibraryCredentials(): LibraryCredentials {
  return {
    canvaIntegration: { clientId: '', clientSecret: '' },
    dropboxIntegration: { appKey: '' },
    oneDriveIntegration: { clientId: '' },
  }
}

function defaultMachineSettings(): MachineSettings {
  return {
    // Not blank: this is the `updatedByDevice` stamp on every record saved here, and an empty one
    // makes two devices indistinguishable in SyncConflictsView. The Tauri build borrows the OS
    // hostname (paths.rs); a browser has no equivalent, so this is the closest honest guess.
    // BootGate and the Setup Wizard both put it in front of a human to replace.
    thisComputerName: suggestDeviceNameForThisBrowser(),
    darkMode: true,
    libraryPath: '',
    hasCompletedSetup: false,
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

export function createWebSettingsPort(root: FileSystemDirectoryHandle): SettingsPort {
  return {
    getLibrarySettings: async () => {
      const raw = await readJsonFile<Record<string, unknown>>(root, LIBRARY_SETTINGS_PATH)
      if (!raw) return defaultLibrarySettings()
      return raw as unknown as LibrarySettings
    },
    saveLibrarySettings: async (settings) => {
      await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
    },
    // Deliberately does not replicate the Rust side's (now-removed) one-time migration of these
    // fields out of the old nested-in-library-settings.json shape — same precedent as
    // adapters/web/roles.ts. A web-build library still carrying credentials nested inside
    // library-settings.json simply starts with empty credentials here.
    getLibraryCredentials: async () => {
      return (
        (await readJsonFile<LibraryCredentials>(root, CREDENTIALS_PATH)) ??
        defaultLibraryCredentials()
      )
    },
    saveLibraryCredentials: async (credentials) => {
      await writeJsonFile(root, CREDENTIALS_PATH, credentials)
    },
    getMachineSettings: async () => readMachineSettings(),
    saveMachineSettings: async (settings) => {
      localStorage.setItem(MACHINE_SETTINGS_KEY, JSON.stringify(settings))
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
    clearSettingsListBackups: async () => {
      for (const filename of SETTINGS_LIST_FILES) {
        await removeFile(root, backupPath(filename))
      }
    },
  }
}
