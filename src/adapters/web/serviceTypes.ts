/**
 * A peer of settings.ts, not part of it — service types live in their own
 * service-types.json (a single small array-shaped file), mirroring songCollections.ts and
 * src-tauri/src/domain/service_types.rs.
 *
 * Unlike the Tauri build, this does not seed the 3 default service types for a genuinely fresh
 * library (see src-tauri/src/commands/service_types.rs's seed_defaults_if_needed) — a web-build
 * library simply starts with an empty service types list here.
 */

import type { ServiceTypePort } from '@/adapters/types'
import type { ServiceTypeDefinition } from '@/models/settings'
import { readJsonFile, writeJsonFile } from './fsaStorage'

const SERVICE_TYPES_PATH = 'service-types.json'

export function createWebServiceTypesPort(root: FileSystemDirectoryHandle): ServiceTypePort {
  async function list(): Promise<ServiceTypeDefinition[]> {
    return (await readJsonFile<ServiceTypeDefinition[]>(root, SERVICE_TYPES_PATH)) ?? []
  }

  return {
    list,
    async save(serviceType) {
      const items = await list()
      const index = items.findIndex((item) => item.id === serviceType.id)
      if (index === -1) items.push(serviceType)
      else items[index] = serviceType
      await writeJsonFile(root, SERVICE_TYPES_PATH, items)
      return serviceType
    },
    async delete(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, SERVICE_TYPES_PATH, items)
    },
  }
}
