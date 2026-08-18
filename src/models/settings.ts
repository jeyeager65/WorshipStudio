/** Lives in its own `role-groups.json`, a peer of `library-settings.json`, not a field on it —
 *  see `src-tauri/src/domain/role_groups.rs` and `src-tauri/src/commands/roles.rs`'s one-time
 *  migration off the old nested-in-settings shape (`RoleGroup { name, roles: string[] }`, where
 *  a role was just a bare string living inside whichever group's `roles` array contained it). A
 *  role group no longer owns its member roles directly — see `RoleDefinition.groupId` for the
 *  many-to-one link, chosen so a role can be reassigned to a different group later without
 *  losing its identity or any of its historical references. */
export interface RoleGroupDefinition {
  id: string
  name: string
}

/** Lives in its own `roles.json`, a peer of `library-settings.json` and `role-groups.json` — see
 *  `src-tauri/src/domain/roles.rs` and `src-tauri/src/commands/roles.rs`'s one-time migration.
 *  Referenced by id from `RoleAssignment.roleId`, `ServiceItem.roleId`,
 *  `ServiceTemplateItem.roleId`, `Person.preferredRoleIds`, and
 *  `BulletinSettings.page2.servingSchedule.roleIds` (models/service.ts, models/library.ts), not
 *  by name. */
export interface RoleDefinition {
  id: string
  name: string
  /** The `RoleGroupDefinition.id` this role belongs to — many-to-one (a role belongs to
   *  exactly one group). */
  groupId: string
}

/** "Praise Team - Guitar" — every display of a role name shows its category, so it's
 *  identifiable without needing surrounding visual grouping context. Falls back to the bare
 *  role name if it isn't (or is no longer) in any group. */
export function roleDisplayLabel(
  roleId: string,
  roles: RoleDefinition[],
  roleGroups: RoleGroupDefinition[],
): string {
  const role = roles.find((r) => r.id === roleId)
  if (!role) return roleId
  const group = roleGroups.find((g) => g.id === role.groupId)
  return group ? `${group.name} - ${role.name}` : role.name
}

/** Lives in its own `song-collections.json`, a peer of `library-settings.json`, not a field on
 *  it — see `src-tauri/src/domain/song_collections.rs` and its one-time migration off the old
 *  nested-in-settings, name-only shape. Referenced by id from `Song.collections[].collectionId`
 *  (models/song.ts), not by name. */
export interface SongCollectionDefinition {
  id: string
  name: string
  /** Optional short label printed before a song's collection number in the bulletin. */
  abbreviation?: string
}

/** Lives in its own `service-types.json`, a peer of `library-settings.json`, not a field on it —
 *  see `src-tauri/src/domain/service_types.rs` and its one-time migration off the old
 *  nested-in-settings, name-only shape. Referenced by id from `Service.serviceTypeId`
 *  (models/service.ts) and `ServiceTemplate.defaultForServiceTypeIds`, not by name. */
export interface ServiceTypeDefinition {
  id: string
  name: string
  /** Optional explanation of what this service type is for (e.g. distinguishing a communion
   *  service from an ordinary one) — shown alongside the name in Settings, nowhere else yet. */
  description?: string
}

/** Lives in its own `credentials.json`, a peer of `library-settings.json` — see
 *  `src-tauri/src/commands/settings.rs`'s `migrate_credentials_into_own_file` for the one-time
 *  migration off the old nested-in-settings shape. Kept separate from the taxonomy/branding/
 *  tuning fields that stay in `LibrarySettings` for two reasons: it shrinks the conflict surface
 *  for the much-more-frequently-edited fields there, and it matches a security boundary the app
 *  already draws elsewhere — the Canva OAuth access/refresh tokens produced *from* these
 *  credentials already live in their own machine-local canva-auth.json, specifically because
 *  they're sensitive; these being church-shared credentials sitting next to bulletin footer text
 *  was the one place that reasoning hadn't been carried through yet. */
export interface LibraryCredentials {
  /**
   * One Canva Connect integration owned by the church. These credentials sync with the
   * library so every Worship Studio computer uses the same integration. The OAuth access and
   * refresh tokens produced when a Canva user connects remain machine-local.
   */
  canvaIntegration: {
    clientId: string
    clientSecret: string
  }
  /**
   * One Dropbox app registration owned by the church, used by the tablet (adapters/tablet/)
   * build to sync directly against the church's Dropbox library over the Dropbox API — synced
   * so every tablet uses the same app registration. Church-scoped rather than a single
   * WorshipStudio-wide key for the same reason canvaIntegration is: Dropbox's review posture for
   * full-account access expects one registration per requesting organization, and a shared key
   * risks one bad actor getting every church rate-limited. Unlike canvaIntegration, there's no
   * secret here at all — the Dropbox app is a PKCE "public client," which by design has none;
   * see adapters/tablet/providers/dropboxAuth.ts. The OAuth access/refresh tokens produced when a tablet
   * connects remain device-local, same reasoning as Canva's.
   */
  dropboxIntegration: {
    appKey: string
  }
  /**
   * One Microsoft Entra app registration owned by the church, used the same way
   * dropboxIntegration is — but for a tablet connecting to the church's OneDrive instead. Same
   * church-scoped reasoning, same "no secret" story (registered as the `spa` platform type,
   * which by design accepts none — see adapters/tablet/providers/onedriveAuth.ts), same
   * device-local token storage.
   */
  oneDriveIntegration: {
    clientId: string
  }
  /** ESV API key (api.esv.org) — church-wide, synced, entered once in Settings > Bible
   *  Translations. Moved here from MachineSettings (pre-0.9) since the key belongs to the
   *  church's own api.esv.org account, not to any one device — see MachineSettings.esvApiKey
   *  for the migration of an already-configured older device's key. */
  esvApiKey?: string
  /** api.bible key (scripture.api.bible) — church-wide, synced, same reasoning as esvApiKey. */
  apiBibleKey?: string
}

/** library-settings.json — synced, shared across the church's setup. */
export interface LibrarySettings {
  branding: {
    churchName: string
    logoMediaId?: string
    primaryColor: string
    secondaryColor: string
  }
  /**
   * Church-chosen api.bible editions (e.g. NIV) — synced, same as the api.bible key needed to
   * actually resolve them (LibraryCredentials.apiBibleKey). Both are church-wide, not per-machine.
   */
  apiBibleTranslations: {
    code: string
    label: string
    bibleId: string
  }[]
  defaultTranslationCode?: string
  mediaMaxSyncedFileSizeMb: number
  /** Every auto-fit/fixed slide typography range in one place — purely a readability grouping
   *  (see `FontSizesPx`'s own doc comment), no behavior or semantics change from when these were
   *  8 flat fields directly on `LibrarySettings`. */
  fontSizesPx: FontSizesPx
  /** Bulletin/Order of Worship export customization — every label here is this church's own
   *  choice, not a fixed English string (see utils/orderOfWorship.ts and utils/bulletinPage2.ts,
   *  which read these rather than hardcoding "Order of Worship"/"Heart Preparation"/etc.). */
  bulletin: BulletinSettings
}

/** A min/max auto-fit range in pixels — `FontSizesPx`'s scripture/song/wayfinding fields all
 *  share this shape (see each field's own doc comment for what "auto-fit" means for that
 *  content type specifically). */
export interface FontSizeRange {
  min: number
  max: number
}

/** Was 8 flat fields directly on `LibrarySettings` (`scriptureMinFontSizePx`,
 *  `scriptureMaxFontSizePx`, `songMinFontSizePx`, ..., `wayfindingMaxFontSizePx`) — grouped here
 *  purely for readability, not a synced-file split like `LibraryCredentials`: this is still part
 *  of `LibrarySettings` itself, just nested. See
 *  `src-tauri/src/commands/settings.rs`'s `migrate_library_settings_shape` for the one-time
 *  reshape of the old flat keys. */
export interface FontSizesPx {
  /** Scripture slides auto-fit as large as possible within this range (never below the
   *  minimum) — a passage that still doesn't fit at the minimum splits across slides at verse
   *  boundaries instead of shrinking further. */
  scripture: FontSizeRange
  /** Song lyric slides auto-fit as large as possible within this range, shrinking to fit the
   *  whole part (Verse, Chorus, etc.) on one slide — a part is already the atomic unit a
   *  worship leader chose, so unlike scripture it never auto-splits across slides. Unlike
   *  scripture, a line that still doesn't fit at the minimum is left as-is rather than wrapped
   *  at a word boundary (see utils/textAutoFit.ts's wrapLineAtPunctuation). */
  song: FontSizeRange
  /** Slide header (the reference/title above the text, e.g. "John 3:16-17") and footer (the
   *  translation/sub-label below it, e.g. "ESV") — fixed position, fixed size, unlike the
   *  auto-fit main text, so they don't move or resize as the main text shrinks/grows. Two
   *  independently-set fixed sizes, not a min/max pair of each other — grouped here only
   *  because they're both fixed-position slide chrome. */
  slide: { header: number; footer: number }
  /** Reference-only scripture display's "wayfinding" visual (surrounding book names fading out
   *  toward the edges, centered on the reference itself) — the reference and nearest book
   *  approach the max size, the farthest book shown uses the min, everything between is linearly
   *  interpolated by distance. Unlike scripture/song, there's no auto-fit shrink-to-fit safety
   *  net for this text. */
  wayfinding: FontSizeRange
}

/** A page's own optional footer quote — shared shape between page1 and page2 (each church picks
 *  its own title, and can turn either footer off independently). */
export interface BulletinPageFooter {
  title: string
  enabled: boolean
}

export interface BulletinSettings {
  page1: {
    title: string
    footer: BulletinPageFooter
  }
  page2: {
    /** Whole back page on/off — a church that only wants the front-page liturgy. */
    enabled: boolean
    title: string
    footer: BulletinPageFooter
    announcements: { enabled: boolean }
    servingSchedule: {
      enabled: boolean
      /** RoleDefinition ids (e.g. "Nursery", "Sound Booth") that become columns in the serving
       *  schedule table — opt-in, since not every role (e.g. Praise Team parts) belongs in it. */
      roleIds: string[]
    }
  }
}

/** Per-machine settings — Tauri app-data dir, never synced. */
export interface MachineSettings {
  thisComputerName: string
  darkMode: boolean
  /** Local filesystem path to the synced library root. Relative paths resolve from the app executable folder. */
  libraryPath: string
  /** Whether the First-Time Setup Wizard has been completed or explicitly skipped. */
  hasCompletedSetup: boolean
  /**
   * Persisted Display Setup role per monitor, keyed by the OS-reported monitor name (see
   * adapters/tauri's `displays` port, which does real monitor enumeration itself rather than
   * through a Rust command). Values are DisplayRole strings; a plain Record here rather than
   * importing that type keeps this model layer independent of the adapters layer.
   */
  displayRoles: Record<string, string>
  /** Legacy ESV/api.bible keys, kept only so an already-configured device can migrate to the
   *  real, synced fields (LibraryCredentials.esvApiKey/apiBibleKey) the first time its
   *  credentials load after upgrading — see adapters/web/settings.ts's getLibraryCredentials().
   *  New saves always clear these; nothing should read them for actual scripture resolution
   *  anymore. */
  esvApiKey?: string
  apiBibleKey?: string
  /** Explicit Remote Control LAN port. Undefined selects and remembers one automatically. */
  remoteControlPort?: number
  /** Explicit mDNS hostname label. Undefined uses a computer-based installed name or the portable default. */
  remoteControlHostname?: string
  /** Internal last successful automatic port, persisted to keep paired-device URLs stable. */
  lastRemoteControlPort?: number
  /**
   * Exact loopback port registered as this installation's Canva OAuth redirect. Unlike Remote
   * Control, this cannot change automatically because Canva requires an exact allow-listed URL.
   */
  canvaCallbackPort?: number
  /**
   * Tablet-only (adapters/tablet/). Files at or above this size are never pulled into this
   * device's local OPFS cache during a Dropbox sync — deliberately a *separate* threshold from
   * LibrarySettings.mediaMaxSyncedFileSizeMb, which governs whether a file syncs to every
   * desktop machine at all. That setting answers "is this worth syncing to the church at large";
   * this one answers "is this worth this specific tablet's local storage," which varies by
   * device (an older 32GB iPad vs. a fresh 256GB Android tablet) — hence per-machine, not synced.
   */
  tabletMediaMaxCachedFileSizeMb?: number
  /**
   * Tablet-only. Which cloud provider this device is connected through — picks which of
   * providers/dropbox.ts / providers/onedrive.ts createTabletAdapter() builds. Per-machine since
   * different devices could plausibly connect through different providers even for the same
   * church (unusual, but nothing prevents it — each provider's library folder path below is its
   * own independent setting).
   */
  tabletCloudProvider?: 'dropbox' | 'onedrive'
  /**
   * Tablet-only. Path within the connected cloud account (relative to its root) where the
   * library lives — full account access (not an isolated app-created folder) is required to
   * reach the church's *existing* synced folder, so this identifies which of potentially many
   * folders in that account is the actual library. Per-machine like libraryPath, even though
   * every device normally points at the same real folder.
   */
  tabletCloudLibraryFolderPath?: string
  /**
   * Tablet-only. A device-local *cache* of the app key/client ID used to connect — not the
   * canonical value (that's LibraryCredentials.dropboxIntegration.appKey or
   * .oneDriveIntegration.clientId, synced church-wide). Needed purely to bootstrap: on a
   * brand-new device, nothing has been pulled from the cloud yet, so there's no synced
   * LibraryCredentials to read the real key from at all — the very first connection on any device
   * has to come from a human typing it in, or scanning a same-church device's "Add Another
   * Device" link/QR code (BootGate.vue's connect screen). This just means a device that's
   * already connected doesn't have to ask again after a reload.
   */
  tabletCloudClientId?: string
}

/** Tauri-only. What Settings' Local data folder panel shows/edits — see SettingsPort's own doc
 *  comment on getDataLocation for why this is a separate, non-synced concern from
 *  MachineSettings rather than a field on it. */
export interface DataLocation {
  /** The configured override, blank if using the default location. */
  localRootPath: string
  /** Where Local actually resolves to right now, override or default — for display only. */
  resolvedPath: string
  /** Portable installs always use a fixed folder beside the executable; the picker is hidden there. */
  isPortable: boolean
}
