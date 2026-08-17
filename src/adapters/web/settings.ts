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
import { backupPath, readJsonFile, removeFile, writeJsonFile } from './fsaStorage'
import { storeLibraryHandle } from './handlePersistence'

const LIBRARY_SETTINGS_PATH = 'library-settings.json'
const CREDENTIALS_PATH = 'credentials.json'
const MACHINE_SETTINGS_KEY = 'worship-studio:web:machine-settings'

// Mirrors src-tauri/src/commands/settings.rs's clear_settings_list_backups exactly — same five
// filenames (see each adapters/web/*.ts port's own *_PATH constant), same exclusion of
// library-settings.json.backup/credentials.json.backup (neither file is ever touched by Clear
// Existing Data, so neither backup should be swept away).
const SETTINGS_LIST_FILES = [
  'song-collections.json',
  'service-types.json',
  'role-groups.json',
  'roles.json',
  'service-templates.json',
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

/** One-time reshape of library-settings.json's font-size and bulletin fields from flat to
 *  nested — mirrors src-tauri/src/commands/settings.rs's migrate_library_settings_shape exactly
 *  (same target shape, same reasoning). Unlike the credentials/roles migrations, this one IS
 *  replicated here rather than deferred to Rust as authoritative — it's a pure key reshape with
 *  no ids or cross-machine convergence involved (unlike e.g. adapters/web/roles.ts's deliberately
 *  *not* replicating the id migration there), so there's no reason a web-only library should ever
 *  lose a church's customized font sizes/bulletin wording to this. Operates on a loosely-typed
 *  raw object, not LibrarySettings itself — readJsonFile's `as T` cast means an old flat file
 *  would otherwise silently type-check as the new shape while `fontSizesPx`/`bulletin.page1` are
 *  actually undefined at runtime. */
function migrateLibrarySettingsShape(raw: Record<string, unknown>): {
  settings: Record<string, unknown>
  changed: boolean
} {
  let changed = false
  const settings = { ...raw }

  if (!('fontSizesPx' in settings)) {
    const takeNumber = (key: string, fallback: number): number => {
      const value = settings[key]
      return typeof value === 'number' ? value : fallback
    }
    settings.fontSizesPx = {
      scripture: {
        min: takeNumber('scriptureMinFontSizePx', 72),
        max: takeNumber('scriptureMaxFontSizePx', 120),
      },
      song: {
        min: takeNumber('songMinFontSizePx', 16),
        max: takeNumber('songMaxFontSizePx', 120),
      },
      slide: {
        header: takeNumber('slideHeaderFontSizePx', 48),
        footer: takeNumber('slideFooterFontSizePx', 48),
      },
      wayfinding: {
        min: takeNumber('wayfindingMinFontSizePx', 56),
        max: takeNumber('wayfindingMaxFontSizePx', 150),
      },
    }
    for (const key of [
      'scriptureMinFontSizePx',
      'scriptureMaxFontSizePx',
      'songMinFontSizePx',
      'songMaxFontSizePx',
      'slideHeaderFontSizePx',
      'slideFooterFontSizePx',
      'wayfindingMinFontSizePx',
      'wayfindingMaxFontSizePx',
    ]) {
      delete settings[key]
    }
    changed = true
  }

  const bulletin = settings.bulletin
  if (bulletin && typeof bulletin === 'object' && !('page1' in bulletin)) {
    const b = bulletin as Record<string, unknown>
    const takeString = (key: string, fallback: string): string => {
      const value = b[key]
      return typeof value === 'string' ? value : fallback
    }
    const takeBool = (key: string): boolean => {
      const value = b[key]
      return typeof value === 'boolean' ? value : true
    }
    const roleIds = Array.isArray(b.servingScheduleRoleIds) ? b.servingScheduleRoleIds : []
    settings.bulletin = {
      page1: {
        title: takeString('page1Title', 'Order of Worship'),
        footer: {
          title: takeString('page1FooterTitle', 'Heart Preparation'),
          enabled: takeBool('page1FooterEnabled'),
        },
      },
      page2: {
        enabled: takeBool('page2Enabled'),
        title: takeString('page2Title', 'Announcements'),
        footer: {
          title: takeString('page2FooterTitle', 'Thought to Ponder'),
          enabled: takeBool('page2FooterEnabled'),
        },
        announcements: { enabled: takeBool('showAnnouncements') },
        servingSchedule: { enabled: takeBool('showServingSchedule'), roleIds },
      },
    }
    changed = true
  }

  return { settings, changed }
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

/** Moves pre-0.9 machine-local Bible API keys into the synced church credentials, mirroring
 *  src-tauri/src/commands/settings.rs's migrate_legacy_bible_api_keys exactly — existing shared
 *  values win, and ESV/api.bible migrate independently (unlike Canva's paired id+secret) since a
 *  church may only have configured one of the two. */
function migrateLegacyBibleApiKeys(
  credentials: LibraryCredentials,
  machine: MachineSettings,
): { credentials: LibraryCredentials; changed: boolean } {
  let changed = false
  const migrated = { ...credentials }
  if (!migrated.esvApiKey?.trim() && machine.esvApiKey?.trim()) {
    migrated.esvApiKey = machine.esvApiKey.trim()
    changed = true
  }
  if (!migrated.apiBibleKey?.trim() && machine.apiBibleKey?.trim()) {
    migrated.apiBibleKey = machine.apiBibleKey.trim()
    changed = true
  }
  return { credentials: migrated, changed }
}

export function createWebSettingsPort(root: FileSystemDirectoryHandle): SettingsPort {
  return {
    getLibrarySettings: async () => {
      const raw = await readJsonFile<Record<string, unknown>>(root, LIBRARY_SETTINGS_PATH)
      if (!raw) return defaultLibrarySettings()
      const { settings, changed } = migrateLibrarySettingsShape(raw)
      if (changed) {
        await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
      }
      return settings as unknown as LibrarySettings
    },
    saveLibrarySettings: async (settings) => {
      await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
    },
    // Deliberately does not replicate the Rust side's one-time migration of these fields out of
    // the old nested-in-library-settings.json shape — same precedent as adapters/web/roles.ts:
    // Rust is the authoritative migration layer for that. A web-build library still carrying
    // credentials nested inside library-settings.json simply starts with empty credentials here;
    // opening the library once in the desktop app runs the real migration for every adapter.
    getLibraryCredentials: async () => {
      let credentials =
        (await readJsonFile<LibraryCredentials>(root, CREDENTIALS_PATH)) ?? defaultLibraryCredentials()
      const machine = readMachineSettings()
      // Reconcile once per load rather than only when the two happen to disagree — matches the
      // Rust backend's load_library_credentials, which always clears the legacy machine-local
      // fields once they've been considered, whether or not the church's own value won.
      if (machine.esvApiKey || machine.apiBibleKey) {
        const migrated = migrateLegacyBibleApiKeys(credentials, machine)
        credentials = migrated.credentials
        if (migrated.changed) {
          await writeJsonFile(root, CREDENTIALS_PATH, credentials)
        }
        localStorage.setItem(
          MACHINE_SETTINGS_KEY,
          JSON.stringify({ ...machine, esvApiKey: undefined, apiBibleKey: undefined }),
        )
      }
      return credentials
    },
    saveLibraryCredentials: async (credentials) => {
      await writeJsonFile(root, CREDENTIALS_PATH, credentials)
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
    clearSettingsListBackups: async () => {
      for (const filename of SETTINGS_LIST_FILES) {
        await removeFile(root, backupPath(filename))
      }
    },
  }
}
