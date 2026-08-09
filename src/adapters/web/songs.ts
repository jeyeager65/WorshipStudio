/**
 * SongPort for a File System Access-backed web build — songs/<id>.json, mirroring
 * src-tauri/src/domain/songs.rs and its command wrappers. The second of the two walking-skeleton
 * ports (with Settings) proving the FSA storage pattern end-to-end before repeating it across the
 * remaining collections.
 */

import type { Song } from '@/models/song'
import type { SettingsPort, SongPort } from '@/adapters/types'
import { parseOpenSongXml } from '@/adapters/mock/opensongParser'
import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'
import { createFsaCollection } from './collection'

const SONGS_DIR = 'songs'

function newId(): string {
  return `song-${crypto.randomUUID()}`
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
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
    }
  }

  return {
    list: () => collection.list(),
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
