import type { Person } from '@/models/library'
import type { PersonPort, SettingsPort } from '@/adapters/types'
import { createFsaCollection } from './collection'

export function createWebPeoplePort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): PersonPort {
  const collection = createFsaCollection<Person>(root, 'people', settings)
  return {
    list: () => collection.list(),
    save: async (person) => {
      await collection.save(person)
    },
    delete: (id) => collection.delete(id),
  }
}
