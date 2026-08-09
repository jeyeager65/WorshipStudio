/**
 * SlideLibraryPort for a File System Access-backed web build — slides/<id>.json, mirroring
 * src-tauri/src/commands/slides.rs. QR generation is shared across every adapter — see
 * @/utils/qrCode.
 */

import type { SlideLibraryItem } from '@/models/library'
import type { SettingsPort, SlideLibraryPort } from '@/adapters/types'
import { generateQrCodeDataUrl } from '@/utils/qrCode'
import { createFsaCollection } from './collection'

export function createWebSlidesPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
): SlideLibraryPort {
  const collection = createFsaCollection<SlideLibraryItem>(root, 'slides', settings)
  return {
    list: () => collection.list(),
    get: (id) => collection.get(id),
    save: async (item) => {
      await collection.save(item)
    },
    delete: (id) => collection.delete(id),
    generateQrCode: (content) => generateQrCodeDataUrl(content),
  }
}
