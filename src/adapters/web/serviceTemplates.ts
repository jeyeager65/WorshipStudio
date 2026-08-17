/**
 * A peer of settings.ts, not part of it — service templates live in their own
 * service-templates.json (a single small array-shaped file), mirroring roles.ts and
 * src-tauri/src/domain/service_templates.rs.
 *
 * Deliberately does not replicate the Rust side's one-time migration off the old
 * nested-in-settings shape — same precedent as roles.ts: Rust is the authoritative migration
 * layer. A web-build library still carrying the old shape simply starts with an empty templates
 * list here.
 */

import type { ServiceTemplatePort } from '@/adapters/types'
import type { ServiceTemplate } from '@/models/service'
import { readJsonFile, writeJsonFile } from './fsaStorage'

const SERVICE_TEMPLATES_PATH = 'service-templates.json'

export function createWebServiceTemplatesPort(
  root: FileSystemDirectoryHandle,
): ServiceTemplatePort {
  async function list(): Promise<ServiceTemplate[]> {
    return (await readJsonFile<ServiceTemplate[]>(root, SERVICE_TEMPLATES_PATH)) ?? []
  }

  return {
    list,
    async save(template) {
      const items = await list()
      const index = items.findIndex((item) => item.id === template.id)
      if (index === -1) items.push(template)
      else items[index] = template
      await writeJsonFile(root, SERVICE_TEMPLATES_PATH, items)
      return template
    },
    async delete(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, SERVICE_TEMPLATES_PATH, items)
    },
  }
}
