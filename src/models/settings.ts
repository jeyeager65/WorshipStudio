/** library-settings.json — synced, shared across the church's setup. */
export interface LibrarySettings {
  serviceTypes: string[]
  preachers: string[]
  collections: string[]
  volunteerRoles: string[]
  branding: {
    churchName: string
    logoMediaId?: string
    primaryColor: string
    secondaryColor: string
  }
  bibleTranslations: {
    code: string
    source: 'api-esv' | 'api-bible' | 'local-file'
    label: string
  }[]
  defaultTranslationCode?: string
  mediaMaxSyncedFileSizeMb: number
}

/** Per-machine settings — Tauri app-data dir, never synced. */
export interface MachineSettings {
  thisComputerName: string
  darkMode: boolean
}
