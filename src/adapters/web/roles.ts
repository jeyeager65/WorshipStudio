/**
 * A peer of settings.ts, not part of it — roles live in their own roles.json (a single small
 * array-shaped file), mirroring roleGroups.ts and src-tauri/src/domain/roles.rs.
 */

import type { RolePort } from '@/adapters/types'
import type { RoleDefinition } from '@/models/settings'
import { readJsonFile, writeJsonFile } from './fsaStorage'

const ROLES_PATH = 'roles.json'

export function createWebRolesPort(root: FileSystemDirectoryHandle): RolePort {
  async function list(): Promise<RoleDefinition[]> {
    return (await readJsonFile<RoleDefinition[]>(root, ROLES_PATH)) ?? []
  }

  return {
    list,
    async save(role) {
      const items = await list()
      const index = items.findIndex((item) => item.id === role.id)
      if (index === -1) items.push(role)
      else items[index] = role
      await writeJsonFile(root, ROLES_PATH, items)
      return role
    },
    async delete(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, ROLES_PATH, items)
    },
  }
}
