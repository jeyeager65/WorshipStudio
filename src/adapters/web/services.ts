/**
 * ServicePort for a File System Access-backed web build — services/<year>/<id>.json, mirroring
 * src-tauri/src/domain/services.rs. Doesn't fit the shared createFsaCollection helper (see
 * collection.ts) because services live under a year subfolder keyed by date, and saving a
 * service whose date moved to a different year needs to relocate the file, not just overwrite it
 * in place.
 */

import type { Service } from '@/models/service'
import type { ImportSetsSummary, ServicePort, SettingsPort, SongPort } from '@/adapters/types'
import { joinPath, listEntries, readJsonFile, removeFile, writeJsonFile } from './fsaStorage'

const SERVICES_DIR = 'services'

function yearOf(date: string): string {
  return date.length >= 4 ? date.slice(0, 4) : 'unknown'
}

function servicePath(year: string, id: string): string {
  return joinPath(SERVICES_DIR, year, `${id}.json`)
}

async function deviceName(settings: SettingsPort): Promise<string> {
  return (await settings.getMachineSettings()).thisComputerName
}

async function listYearDirs(root: FileSystemDirectoryHandle): Promise<string[]> {
  const entries = await listEntries(root, SERVICES_DIR)
  return entries.filter((e) => e.kind === 'directory').map((e) => e.name)
}

async function listServices(root: FileSystemDirectoryHandle): Promise<Service[]> {
  const services: Service[] = []
  for (const year of await listYearDirs(root)) {
    const dir = joinPath(SERVICES_DIR, year)
    for (const entry of await listEntries(root, dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name.endsWith('.backup'))
        continue
      const service = await readJsonFile<Service>(root, joinPath(dir, entry.name))
      if (service) services.push(service)
    }
  }
  return services
}

async function getService(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<Service | undefined> {
  for (const year of await listYearDirs(root)) {
    const service = await readJsonFile<Service>(root, servicePath(year, id))
    if (service) return service
  }
  return undefined
}

/** Removes every other year folder's copy of this service id — handles a save moving a service
 *  to a new year (date edited) leaving a stale copy behind, mirroring Rust's
 *  remove_existing_except. */
async function removeExistingExcept(
  root: FileSystemDirectoryHandle,
  id: string,
  keepPath: string | undefined,
): Promise<void> {
  for (const year of await listYearDirs(root)) {
    const candidate = servicePath(year, id)
    if (candidate !== keepPath) await removeFile(root, candidate)
  }
}

/** Mirrors adapters/mock/index.ts's recomputeSongUsage, itself mirroring the Rust backend's
 *  songs::recompute_usage — recomputed from every saved service rather than incremented on each
 *  save, so "last used" stays correct if a service's songs or date are edited later, or the most
 *  recent service referencing a song is deleted. Only future-or-today services never count as a
 *  use yet; only songs whose stats actually changed are re-saved. */
async function recomputeSongUsage(root: FileSystemDirectoryHandle, songs: SongPort): Promise<void> {
  const allServices = await listServices(root)
  const today = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date()
  oneYearAgo.setDate(oneYearAgo.getDate() - 365)
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10)

  const lastUsedAt = new Map<string, string>()
  const usesPastYear = new Map<string, number>()
  for (const service of allServices) {
    if (service.date > today) continue
    const songIdsInService = new Set(
      service.items.filter((item) => item.type === 'song').map((item) => item.songId),
    )
    for (const songId of songIdsInService) {
      const current = lastUsedAt.get(songId)
      if (!current || service.date > current) lastUsedAt.set(songId, service.date)
      if (service.date >= oneYearAgoStr)
        usesPastYear.set(songId, (usesPastYear.get(songId) ?? 0) + 1)
    }
  }

  const allSongs = await songs.list()
  for (const song of allSongs) {
    const newLastUsedAt = lastUsedAt.get(song.id)
    const newUsesPastYear = usesPastYear.get(song.id) ?? 0
    if (song.usage.lastUsedAt === newLastUsedAt && song.usage.usesPastYear === newUsesPastYear)
      continue
    await songs.save({
      ...song,
      usage: { lastUsedAt: newLastUsedAt, usesPastYear: newUsesPastYear },
    })
  }
}

export function createWebServicesPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
  songs: SongPort,
): ServicePort {
  return {
    list: () => listServices(root),
    get: (id) => getService(root, id),
    save: async (service) => {
      const stamped: Service = {
        ...service,
        updatedAt: new Date().toISOString(),
        updatedByDevice: await deviceName(settings),
      }
      const destination = servicePath(yearOf(stamped.date), stamped.id)
      // Commit the new version before removing a copy from an old year folder — if the write
      // fails, the previous service remains intact and visible, same ordering as the Rust side.
      await writeJsonFile(root, destination, stamped)
      await removeExistingExcept(root, stamped.id, destination)
      await recomputeSongUsage(root, songs)
    },
    delete: async (id) => {
      await removeExistingExcept(root, id, undefined)
      await recomputeSongUsage(root, songs)
    },
    listUpcoming: async (fromDate, toDate) => {
      const all = await listServices(root)
      return all.filter((s) => s.date >= fromDate && s.date <= toDate)
    },
    // No folder picker equivalent in a browser — same documented "no browser equivalent, always
    // undefined" contract the mock adapter already uses for this method.
    importOpenSongSets: async (): Promise<ImportSetsSummary | undefined> => undefined,
  }
}
