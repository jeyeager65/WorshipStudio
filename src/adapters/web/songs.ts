/**
 * SongPort for a File System Access-backed web build — songs/<id>.json, mirroring
 * src-tauri/src/domain/songs.rs and its command wrappers. The second of the two walking-skeleton
 * ports (with Settings) proving the FSA storage pattern end-to-end before repeating it across the
 * remaining collections.
 */

import type { Song, SongUsageEntry } from '@/models/song'
import type { SettingsPort, SongPort } from '@/adapters/types'
import { parseOpenSongXml } from '@/adapters/mock/opensongParser'
import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'
import { songIdsInService } from '@/utils/songUsage'
import { createFsaCollection, type FsaCollection } from './collection'
import { readJsonFile, writeJsonFile } from './fsaStorage'
import { listServices } from './services'

const SONGS_DIR = 'songs'
const USAGE_DATES_MIGRATION_MARKER = 'songs.usage-dates-migrated.json'

function newId(): string {
  return `song-${crypto.randomUUID()}`
}

function sortByServiceId(a: SongUsageEntry, b: SongUsageEntry): number {
  return a.serviceId.localeCompare(b.serviceId)
}

/** One-time backfill for a library saved before Song.usageDates existed, mirroring Rust's
 *  songs::migrate_usage_dates_if_needed exactly — same marker filename, so a folder opened by
 *  both this web build and the Tauri app shares one migrated/not-migrated state instead of each
 *  redoing it independently. Every entry is fully re-derivable from currently-saved services
 *  (nothing lost), gated on the marker so this only ever runs once. Triggered from the songs
 *  port's own `list()`, the same place the Rust side triggers it from `list_songs`. */
async function migrateUsageDatesIfNeeded(
  root: FileSystemDirectoryHandle,
  collection: FsaCollection<Song>,
): Promise<void> {
  const marker = await readJsonFile(root, USAGE_DATES_MIGRATION_MARKER)
  if (marker) return

  const entriesBySong = new Map<string, SongUsageEntry[]>()
  for (const service of await listServices(root)) {
    for (const songId of songIdsInService(service)) {
      const entries = entriesBySong.get(songId) ?? []
      entries.push({ serviceId: service.id, date: service.date })
      entriesBySong.set(songId, entries)
    }
  }

  for (const song of await collection.list()) {
    const rebuilt = (entriesBySong.get(song.id) ?? []).slice().sort(sortByServiceId)
    const current = song.usageDates.slice().sort(sortByServiceId)
    if (JSON.stringify(current) === JSON.stringify(rebuilt)) continue
    await collection.save({ ...song, usageDates: rebuilt })
  }

  await writeJsonFile(root, USAGE_DATES_MIGRATION_MARKER, { migratedAt: new Date().toISOString() })
}

export function createWebSongsPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): SongPort {
  const collection = createFsaCollection<Song>(root, SONGS_DIR, settings)

  function fromParsed(parsed: ReturnType<typeof parseOpenSongXml>): Song {
    return {
      id: newId(),
      title: parsed.title,
      author: parsed.author,
      copyright: parsed.copyright,
      ccli: parsed.ccli,
      collections: [],
      tags: [],
      blocks: parsed.blocks,
      defaultArrangement: parsed.arrangement,
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    }
  }

  return {
    list: async () => {
      await migrateUsageDatesIfNeeded(root, collection)
      return collection.list()
    },
    get: (id) => collection.get(id),
    save: async (song) => {
      await collection.save(song)
    },
    delete: (id) => collection.delete(id),
    importFromOpenSongXml: async (xml) => collection.save(fromParsed(parseOpenSongXml(xml))),
    importFromOpenSongFiles: async () => {
      const files = await pickFilesInBrowser()
      const created: Song[] = []
      for (const file of files) {
        const xml = await file.text()
        created.push(await collection.save(fromParsed(parseOpenSongXml(xml))))
      }
      return created
    },
  }
}
