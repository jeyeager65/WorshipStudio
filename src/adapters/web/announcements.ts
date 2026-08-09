import type { Announcement } from '@/models/announcement'
import type { AnnouncementPort, SettingsPort } from '@/adapters/types'
import { createFsaCollection } from './collection'

export function createWebAnnouncementsPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): AnnouncementPort {
  const collection = createFsaCollection<Announcement>(root, 'announcements', settings)
  return {
    list: () => collection.list(),
    save: async (announcement) => {
      await collection.save(announcement)
    },
    delete: (id) => collection.delete(id),
  }
}
