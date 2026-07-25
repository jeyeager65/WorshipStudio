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
  collectionId: string
  /** Hymnal/collection number — scoped to this collection, not global to the song. */
  number?: string
}

export interface Song {
  id: string
  title: string
  ccli?: string
  author?: string
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
  updatedAt: string
  updatedByDevice: string
}
