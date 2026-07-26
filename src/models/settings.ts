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
  /** Local filesystem path to the synced library root on this machine. */
  libraryPath: string
  /** Whether the First-Time Setup Wizard has been completed or explicitly skipped. */
  hasCompletedSetup: boolean
  /** Local-only media folder (never synced) — for files too large to sync to every machine. */
  localMediaPath: string
  /**
   * Persisted Display Setup role per monitor, keyed by the OS-reported monitor name (see
   * adapters/tauri's `displays` port, which does real monitor enumeration itself rather than
   * through a Rust command). Values are DisplayRole strings; a plain Record here rather than
   * importing that type keeps this model layer independent of the adapters layer.
   */
  displayRoles: Record<string, string>
}
