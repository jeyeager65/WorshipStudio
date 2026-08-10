/**
 * The tablet build's LocalMediaRootPort (see adapters/web/media.ts's own doc comment for the
 * interface this satisfies) — a second OPFS subdirectory, sibling to the synced library tree,
 * for 'local' (never-synced) media. Deliberately built against the *raw* OPFS root, never the
 * dirty-tracking-wrapped one adapters/tablet/index.ts hands to every other port, so a 'local'
 * item structurally cannot get swept into a push — the same reasoning cloudSync.ts itself
 * operates on the raw root for.
 *
 * Unlike the picker-based web build's pickedLocalMediaRoot.ts, this never prompts: OPFS grants
 * silently, so `granted()` and `ensure()` behave identically here.
 */

import type { LocalMediaRootPort } from '@/adapters/web/media'

const LOCAL_MEDIA_DIR = 'local-media'

export function createTabletLocalMediaRoot(rawRoot: FileSystemDirectoryHandle): LocalMediaRootPort {
  let cached: FileSystemDirectoryHandle | undefined

  async function ensure(): Promise<FileSystemDirectoryHandle> {
    if (!cached) cached = await rawRoot.getDirectoryHandle(LOCAL_MEDIA_DIR, { create: true })
    return cached
  }

  return { granted: ensure, ensure }
}
