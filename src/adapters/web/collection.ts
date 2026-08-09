/**
 * Shared list/get/save/delete pattern for the FSA-backed collections that are just
 * one-JSON-file-per-id with an id/updatedAt/updatedByDevice shape — Songs, Themes, People,
 * Announcements, and (once built) Slides/Media/Services all fit this same shape, mirroring how
 * the Rust domain modules (songs.rs, themes.rs, etc.) are each a thin wrapper over the same
 * read_json_dir/write_json_file/delete_file_if_exists primitives.
 */

import type { SettingsPort } from '@/adapters/types'
import { joinPath, listEntries, readJsonFile, removeFile, writeJsonFile } from './fsaStorage'

export interface SimpleRecord {
  id: string
  updatedAt: string
  updatedByDevice: string
}

/** Mirrors this_device_name() (src-tauri/src/paths.rs) — every save's device identity comes
 *  from the same machine-settings field either way. */
async function deviceName(settings: SettingsPort): Promise<string> {
  return (await settings.getMachineSettings()).thisComputerName
}

export interface FsaCollection<T extends SimpleRecord> {
  list(): Promise<T[]>
  get(id: string): Promise<T | undefined>
  /** Stamps updatedAt/updatedByDevice, writes the file, and returns the stamped record — the
   *  public SongPort/ThemePort/etc. `save` methods return void, but callers that build a record
   *  themselves (e.g. importFromOpenSongXml) need the real stamped values back. */
  save(record: T): Promise<T>
  delete(id: string): Promise<void>
}

export function createFsaCollection<T extends SimpleRecord>(
  root: FileSystemDirectoryHandle,
  dir: string,
  settings: SettingsPort,
): FsaCollection<T> {
  function path(id: string): string {
    return joinPath(dir, `${id}.json`)
  }

  return {
    async list() {
      const entries = await listEntries(root, dir)
      const records: T[] = []
      for (const entry of entries) {
        if (
          entry.kind !== 'file' ||
          !entry.name.endsWith('.json') ||
          entry.name.endsWith('.backup')
        )
          continue
        const record = await readJsonFile<T>(root, joinPath(dir, entry.name))
        if (record) records.push(record)
      }
      return records
    },
    async get(id) {
      return (await readJsonFile<T>(root, path(id))) ?? undefined
    },
    async save(record) {
      const stamped: T = {
        ...record,
        updatedAt: new Date().toISOString(),
        updatedByDevice: await deviceName(settings),
      }
      await writeJsonFile(root, path(stamped.id), stamped)
      return stamped
    },
    async delete(id) {
      await removeFile(root, path(id))
    },
  }
}
