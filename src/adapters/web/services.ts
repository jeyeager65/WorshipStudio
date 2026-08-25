/**
 * ServicePort for a File System Access-backed web build — services/<year>/<id>.json, mirroring
 * src-tauri/src/domain/services.rs. Doesn't fit the shared createFsaCollection helper (see
 * collection.ts) because services live under a year subfolder keyed by date, and saving a
 * service whose date moved to a different year needs to relocate the file, not just overwrite it
 * in place.
 */

import type { Service } from '@/models/service'
import type { ServicePort, SettingsPort, SongPort } from '@/adapters/types'
import { affectedSongIds, applyServiceUsageChange, songIdsInService } from '@/utils/songUsage'
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

// Exported for songs.ts's own migrateUsageDatesIfNeeded — a raw-storage-level read, not through
// the ServicePort, avoiding a circular port dependency (createWebServicesPort itself takes an
// already-constructed SongPort, so songs.ts can't depend on a ServicePort back).
export async function listServices(root: FileSystemDirectoryHandle): Promise<Service[]> {
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

/** Incrementally updates every affected song's `usageDates` for one service being saved or
 *  deleted, mirroring songs::update_usage_dates_for_service (Rust) instead of the full-library
 *  recompute this replaced — see that function's own doc comment. `oldService` is the previously
 *  saved version (undefined for a brand new service), `newService` the version now being saved
 *  (undefined when the service is being deleted). */
async function updateUsageDatesForService(
  songs: SongPort,
  serviceId: string,
  oldService: Service | undefined,
  newService: Service | undefined,
): Promise<void> {
  const ids = affectedSongIds(oldService, newService)
  const newSongIds = newService ? songIdsInService(newService) : new Set<string>()
  for (const id of ids) {
    const song = await songs.get(id)
    if (!song) continue
    const desiredDate = newService && newSongIds.has(id) ? newService.date : undefined
    const updated = applyServiceUsageChange(song, serviceId, desiredDate)
    if (updated) await songs.save(updated)
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
      // Read the old version before it's overwritten so the songs it referenced can be diffed
      // against what the new version references — see updateUsageDatesForService's own doc
      // comment for why this replaced a full-library recompute on every save.
      const oldService = await getService(root, service.id)
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
      await updateUsageDatesForService(songs, stamped.id, oldService, stamped)
    },
    delete: async (id) => {
      const oldService = await getService(root, id)
      await removeExistingExcept(root, id, undefined)
      if (oldService) await updateUsageDatesForService(songs, id, oldService, undefined)
    },
    listUpcoming: async (fromDate, toDate) => {
      const all = await listServices(root)
      return all.filter((s) => s.date >= fromDate && s.date <= toDate)
    },
  }
}
