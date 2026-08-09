import type { Theme } from '@/models/library'
import type { SettingsPort, ThemePort } from '@/adapters/types'
import { createFsaCollection } from './collection'

export function createWebThemesPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): ThemePort {
  const collection = createFsaCollection<Theme>(root, 'themes', settings)
  return {
    list: () => collection.list(),
    save: async (theme) => {
      await collection.save(theme)
    },
    delete: (id) => collection.delete(id),
  }
}
