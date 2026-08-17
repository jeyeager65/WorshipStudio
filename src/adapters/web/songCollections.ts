/**
 * A peer of settings.ts, not part of it — song collections live in their own
 * song-collections.json (a single small array-shaped file), not one-JSON-file-per-item like
 * createFsaCollection's SimpleRecord shape (collection.ts), and not nested inside
 * library-settings.json either. Mirrors src-tauri/src/domain/song_collections.rs.
 *
 * Unlike the Tauri build, this deliberately does not replicate the Rust side's one-time
 * migration off the old nested-in-settings, name-only shape — matching this project's existing
 * precedent (the web adapter never mirrored the earlier ServiceType/SongCollectionDefinition
 * flexible-deserializer migrations either; Rust is the authoritative migration layer, real web
 * users are newer libraries less likely to carry pre-id data, and a genuinely dual-implemented
 * migration is real duplication risk for something correctness-critical). A web-build library
 * still carrying the old shape simply starts with an empty collections list here.
 */

import type { SongCollectionPort } from '@/adapters/types'
import type { SongCollectionDefinition } from '@/models/settings'
import { readJsonFile, writeJsonFile } from './fsaStorage'

const SONG_COLLECTIONS_PATH = 'song-collections.json'

export function createWebSongCollectionsPort(root: FileSystemDirectoryHandle): SongCollectionPort {
  async function list(): Promise<SongCollectionDefinition[]> {
    return (await readJsonFile<SongCollectionDefinition[]>(root, SONG_COLLECTIONS_PATH)) ?? []
  }

  return {
    list,
    async save(collection) {
      const items = await list()
      const index = items.findIndex((item) => item.id === collection.id)
      if (index === -1) items.push(collection)
      else items[index] = collection
      await writeJsonFile(root, SONG_COLLECTIONS_PATH, items)
      return collection
    },
    async delete(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, SONG_COLLECTIONS_PATH, items)
    },
  }
}
