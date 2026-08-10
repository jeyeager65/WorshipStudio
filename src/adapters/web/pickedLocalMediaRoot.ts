/**
 * The ordinary picker-based web build's LocalMediaRootPort implementation (see media.ts) — grants
 * a second, separate FileSystemDirectoryHandle for 'local' (never-synced) media via its own
 * showDirectoryPicker() call, distinct from the picked/synced library folder. A browser has no
 * implicit writable location the way Tauri's local_media_root (an OS-appdata subfolder,
 * paths.rs) does, so the first commit of a 'local' item is what actually prompts — the resulting
 * handle is cached for the rest of the session and persisted (handlePersistence.ts) so it isn't
 * asked for again next launch.
 */

import type { LocalMediaRootPort } from './media'
import { loadStoredLocalMediaHandle, storeLocalMediaHandle } from './handlePersistence'

export function createPickedLocalMediaRoot(): LocalMediaRootPort {
  // Cached for this adapter instance once granted/picked, so a whole session never needs more
  // than one prompt (or, once handlePersistence.ts has it, zero prompts across sessions).
  let localMediaRoot: FileSystemDirectoryHandle | undefined

  async function granted(): Promise<FileSystemDirectoryHandle | undefined> {
    if (localMediaRoot) return localMediaRoot
    const stored = await loadStoredLocalMediaHandle().catch(() => undefined)
    if (!stored) return undefined
    const permission = await stored.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
    if (permission !== 'granted') return undefined
    localMediaRoot = stored
    return stored
  }

  // Only safe to call from commitImport, the one path in media.ts guaranteed to run inside the
  // user gesture a click on an "Import" button provides, which showDirectoryPicker() requires.
  async function ensure(): Promise<FileSystemDirectoryHandle> {
    const alreadyGranted = await granted()
    if (alreadyGranted) return alreadyGranted
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'worship-studio-local-media',
    })
    await storeLocalMediaHandle(handle)
    localMediaRoot = handle
    return handle
  }

  return { granted, ensure }
}
