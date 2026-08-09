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

const LIBRARY_SETTINGS_PATH = 'library-settings.json'
const MACHINE_SETTINGS_KEY = 'worship-studio:web:machine-settings'

function defaultLibrarySettings(): LibrarySettings {
  return {
    serviceTypes: [],
    collections: [],
    roleGroups: [],
    serviceTemplates: [],
    branding: { churchName: '', primaryColor: '#1F3A5F', secondaryColor: '#C9A227' },
    canvaIntegration: { clientId: '', clientSecret: '' },
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
      servingScheduleRoles: [],
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

export function createWebSettingsPort(root: FileSystemDirectoryHandle): SettingsPort {
  return {
    getLibrarySettings: async () => {
      const existing = await readJsonFile<LibrarySettings>(root, LIBRARY_SETTINGS_PATH)
      return existing ?? defaultLibrarySettings()
    },
    saveLibrarySettings: async (settings) => {
      await writeJsonFile(root, LIBRARY_SETTINGS_PATH, settings)
    },
    getMachineSettings: async () => readMachineSettings(),
    saveMachineSettings: async (settings) => {
      localStorage.setItem(MACHINE_SETTINGS_KEY, JSON.stringify(settings))
    },
    // The folder is already picked once, up front, to construct this adapter at all (see
    // adapters/web/index.ts) — there's no in-app "switch library folder" flow yet for the web
    // build, unlike the Tauri build's Settings page. Matches the mock adapter's same undefined
    // return for the same reason: no picker to open here yet.
    pickLibraryFolder: async () => undefined,
  }
}
