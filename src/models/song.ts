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
  usage: {
    lastUsedAt?: string
    usesPastYear: number
  }
  /** Hidden from the library list and the Add-to-Service song picker, but otherwise untouched —
   *  a past service that already references this song still resolves and renders it normally,
   *  and usage/CCLI reporting is unaffected. Reversible (see Unarchive), unlike deleting. */
  archived?: boolean
  updatedAt: string
  updatedByDevice: string
}
