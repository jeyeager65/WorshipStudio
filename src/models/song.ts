export interface SongBlock {
  id: string
  label: string
  text: string
}

export interface Arrangement {
  /** Block IDs in play order; a block ID may repeat (e.g. Chorus twice). */
  sequence: string[]
}

export interface SongCollectionEntry {
  /** A `SongCollectionDefinition.id` (models/settings.ts) — despite the field name, this held
   *  the collection's plain *name* in old, pre-id library data. */
  collectionId: string
  /** Hymnal/collection number — scoped to this collection, not global to the song. */
  number?: string
}

/** One service that currently references a song, as of that song's own `usageDates` array —
 *  see `Song.usageDates`'s own doc comment for why this replaced a cached usage-count snapshot.
 *  `date` is the service's own date ("YYYY-MM-DD"), not when the reference was recorded, and is
 *  stored regardless of whether that date is in the past, present, or future: the write path is
 *  deliberately date-agnostic (see utils/songUsage.ts for the display-time filtering). */
export interface SongUsageEntry {
  serviceId: string
  date: string
}

export interface Song {
  id: string
  title: string
  ccli?: string
  author?: string
  /** Who this is known for/performed by, when that differs from Author (e.g. a hymn's original
   *  writer vs. the band whose arrangement is actually familiar) — shown in place of Author
   *  wherever a song is being picked/browsed, but Author stays what CCLI reporting uses. */
  artist?: string
  copyright?: string
  collections: SongCollectionEntry[]
  tags: string[]
  /** Library-level notes (arrangement tips, key changes) — distinct from per-service presenter notes. */
  notes?: string
  blocks: SongBlock[]
  defaultArrangement: Arrangement
  /** Every service that currently references this song — the live source for "last used"/"uses
   *  in the past year" (derived by filtering this against the current date at display time via
   *  utils/songUsage.ts, so those figures can never go stale) and for the Song Usage report. Kept
   *  incrementally in sync on service save/delete rather than recomputed by a full rescan. */
  usageDates: SongUsageEntry[]
  /** Hidden from the library list and the Add-to-Service song picker, but otherwise untouched —
   *  a past service that already references this song still resolves and renders it normally,
   *  and the Song Usage report is unaffected. Reversible (see Unarchive), unlike deleting. */
  archived?: boolean
  updatedAt: string
  updatedByDevice: string
}
