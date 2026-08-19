/**
 * A peer of settings.ts, not part of it — role groups live in their own role-groups.json (a
 * single small array-shaped file), mirroring serviceTypes.ts and
 * src-tauri/src/domain/role_groups.rs.
 */

import type { RoleGroupPort } from '@/adapters/types'
import type { RoleGroupDefinition } from '@/models/settings'
import { readJsonFile, writeJsonFile } from './fsaStorage'

const ROLE_GROUPS_PATH = 'role-groups.json'

export function createWebRoleGroupsPort(root: FileSystemDirectoryHandle): RoleGroupPort {
  async function list(): Promise<RoleGroupDefinition[]> {
    return (await readJsonFile<RoleGroupDefinition[]>(root, ROLE_GROUPS_PATH)) ?? []
  }

  return {
    list,
    async save(roleGroup) {
      const items = await list()
      const index = items.findIndex((item) => item.id === roleGroup.id)
      if (index === -1) items.push(roleGroup)
      else items[index] = roleGroup
      await writeJsonFile(root, ROLE_GROUPS_PATH, items)
      return roleGroup
    },
    async delete(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, ROLE_GROUPS_PATH, items)
    },
  }
}
