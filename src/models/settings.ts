import type { ServiceTemplate } from './service'

/** A named category of roles (e.g. "Praise Team" grouping Drums/Guitar/Piano/Vocals) — purely
 *  organizational; a role itself is still just a plain string referenced by
 *  RoleAssignment.role/ServiceTemplateItem.role. */
export interface RoleGroup {
  name: string
  roles: string[]
}

/** "Praise Team - Guitar" — every display of a role name shows its category, so it's
 *  identifiable without needing surrounding visual grouping context. Falls back to the bare
 *  role name if it isn't (or is no longer) in any group. */
export function roleDisplayLabel(role: string, roleGroups: RoleGroup[]): string {
  const group = roleGroups.find((g) => g.roles.includes(role))
  return group ? `${group.name} - ${role}` : role
}

/** library-settings.json — synced, shared across the church's setup. */
export interface LibrarySettings {
  serviceTypes: string[]
  collections: string[]
  roleGroups: RoleGroup[]
  serviceTemplates: ServiceTemplate[]
  branding: {
    churchName: string
    logoMediaId?: string
    primaryColor: string
    secondaryColor: string
  }
  /**
   * Church-chosen api.bible editions (e.g. NIV) — synced so every machine agrees on what
   * "NIV" refers to. The api.bible *key* needed to actually resolve these lives per-machine
   * in MachineSettings.apiBibleKey, since keys must never sync.
   */
  apiBibleTranslations: {
    code: string
    label: string
    bibleId: string
  }[]
  defaultTranslationCode?: string
  mediaMaxSyncedFileSizeMb: number
  /**
   * Scripture slides auto-fit as large as possible within this range (never below the
   * minimum) — a passage that still doesn't fit at the minimum splits across slides at verse
   * boundaries instead of shrinking further.
   */
  scriptureMinFontSizePx: number
  scriptureMaxFontSizePx: number
  /**
   * Song lyric slides auto-fit as large as possible within this range, shrinking to fit the
   * whole part (Verse, Chorus, etc.) on one slide — a part is already the atomic unit a
   * worship leader chose, so unlike scripture it never auto-splits across slides. Unlike
   * scripture, a line that still doesn't fit at the minimum is left as-is rather than wrapped
   * at a word boundary (see utils/textAutoFit.ts's wrapLineAtPunctuation).
   */
  songMinFontSizePx: number
  songMaxFontSizePx: number
  /**
   * Slide header (the reference/title above the text, e.g. "John 3:16-17") and footer (the
   * translation/sub-label below it, e.g. "ESV") — fixed position, fixed size, unlike the
   * auto-fit main text, so they don't move or resize as the main text shrinks/grows.
   */
  slideHeaderFontSizePx: number
  slideFooterFontSizePx: number
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
  /** ESV API key (api.esv.org) — per-machine, never synced. Entered in Settings > Bible Translations. */
  esvApiKey?: string
  /** api.bible key (scripture.api.bible) — per-machine, never synced. Same reasoning as esvApiKey. */
  apiBibleKey?: string
}
