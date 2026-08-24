/**
 * External App profile CRUD for the File System Access-backed web build — a peer of
 * songCollections.ts (one small whole-list file, not one-file-per-item), but unlike
 * SongCollectionDefinition, ExternalAppProfile does carry updatedAt/updatedByDevice, so this
 * stamps them the same way collection.ts's createFsaCollection does for per-item records.
 * Mirrors src-tauri/src/domain/external_apps.rs's shared-profile half exactly; the per-machine
 * executable path and actual launching have no equivalent here at all — genuinely Tauri/Win32-only
 * (see ExternalAppPort's own doc comment), so this only ever implements the profile CRUD methods.
 */

import type { ExternalAppPort, ExternalAppProfile, SettingsPort } from '@/adapters/types'
import { readJsonFile, writeJsonFile } from './fsaStorage'
import { buildDefaultExternalAppProfiles } from '@/utils/externalAppDefaults'

const EXTERNAL_APP_PROFILES_PATH = 'external-app-profiles.json'

async function deviceName(settings: SettingsPort): Promise<string> {
  return (await settings.getMachineSettings()).thisComputerName
}

export function createWebExternalAppsPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): ExternalAppPort {
  async function list(): Promise<ExternalAppProfile[]> {
    return (await readJsonFile<ExternalAppProfile[]>(root, EXTERNAL_APP_PROFILES_PATH)) ?? []
  }

  return {
    listProfiles: list,
    async saveProfile(profile) {
      const items = await list()
      const stamped: ExternalAppProfile = {
        ...profile,
        updatedAt: new Date().toISOString(),
        updatedByDevice: await deviceName(settings),
      }
      const index = items.findIndex((item) => item.id === stamped.id)
      if (index === -1) items.push(stamped)
      else items[index] = stamped
      await writeJsonFile(root, EXTERNAL_APP_PROFILES_PATH, items)
    },
    async deleteProfile(id) {
      const items = (await list()).filter((item) => item.id !== id)
      await writeJsonFile(root, EXTERNAL_APP_PROFILES_PATH, items)
    },
    async importDefaultProfiles() {
      const items = await list()
      const additions = buildDefaultExternalAppProfiles(
        items,
        new Date().toISOString(),
        await deviceName(settings),
      )
      if (additions.length > 0) {
        await writeJsonFile(root, EXTERNAL_APP_PROFILES_PATH, [...items, ...additions])
      }
      return additions.length
    },
  } satisfies ExternalAppPort
}
