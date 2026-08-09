/**
 * MediaPort for a File System Access-backed web build — media-items/<id>.json for metadata
 * (always in the synced library folder, regardless of location), media/<filename> under that
 * same folder for 'synced' bytes, mirroring src-tauri/src/domain/media.rs.
 *
 * Two deliberate differences from the Rust version:
 * - Content hashing uses Web Crypto's SHA-256 (crypto.subtle.digest) rather than Rust's
 *   DefaultHasher. Rust's own comment on hash_file explains its choice as "avoids adding a
 *   hashing crate dependency for something this low-stakes" — the browser's built-in SHA-256 is
 *   the same reasoning applied to what's actually built into this platform; hashes are only ever
 *   compared within one adapter's own records, so cross-implementation hash equality was never a
 *   requirement.
 * - The local media folder is granted lazily rather than up front like Rust's local_media_root
 *   (which paths.rs resolves automatically, no picker needed, since Tauri can just use an
 *   OS-appdata subfolder). A browser has no such implicit writable location — the first commit
 *   of a 'local' item prompts showDirectoryPicker() (only there, since that's the one call in
 *   this file guaranteed to run inside the user gesture the API requires) and the resulting
 *   handle is cached for the rest of the session and persisted (handlePersistence.ts) so it
 *   isn't asked for again next launch. Other entry points (getPreviewUrl, delete) only use an
 *   already-granted handle and never prompt, since they can be reached from contexts (rendering,
 *   background cleanup) that aren't a fresh user gesture.
 */

import type { MediaItem, Theme } from '@/models/library'
import type {
  MediaImportCommit,
  MediaPort,
  SettingsPort,
  StagedMediaFile,
  ThemePort,
} from '@/adapters/types'
import { stockBackgrounds, stockThemes } from '@/data/stockContent'
import { presentationThemeDefaults } from '@/utils/presentationTheme'
import { pickFilesInBrowser } from '@/adapters/mock/pickFiles'
import { createFsaCollection } from './collection'
import { joinPath, listEntries, readBytes, removeFile, writeBytes } from './fsaStorage'
import { loadStoredLocalMediaHandle, storeLocalMediaHandle } from './handlePersistence'

const MEDIA_ITEMS_DIR = 'media-items'
const MEDIA_FILES_DIR = 'media'

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^./]+$/, '')
}

function guessKind(filename: string): 'image' | 'video' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? 'video' : 'image'
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

function normalizeTitle(item: MediaItem): MediaItem {
  return item.title.trim() ? item : { ...item, title: titleFromFilename(item.filename) }
}

async function uniqueFilename(
  root: FileSystemDirectoryHandle,
  dir: string,
  filename: string,
): Promise<string> {
  const existing = new Set(
    (await listEntries(root, dir)).filter((e) => e.kind === 'file').map((e) => e.name),
  )
  if (!existing.has(filename)) return filename
  const dotIndex = filename.lastIndexOf('.')
  const stem = dotIndex === -1 ? filename : filename.slice(0, dotIndex)
  const ext = dotIndex === -1 ? '' : filename.slice(dotIndex)
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!existing.has(candidate)) return candidate
  }
}

export function createWebMediaPort(
  root: FileSystemDirectoryHandle,
  settings: SettingsPort,
  themes: ThemePort,
): MediaPort {
  const items = createFsaCollection<MediaItem>(root, MEDIA_ITEMS_DIR, settings)
  // Staged-but-not-yet-committed File objects from pickFilesToImport, keyed by a synthetic path —
  // there's no real filesystem path to hand back in a browser, same reasoning as the mock
  // adapter's identical stagedMediaFiles map.
  const staged = new Map<string, File>()
  // Preview blob URLs for the Import Media dialog's own review rows, created lazily per staged
  // path the first time it's asked for — same idea as MediaLibraryView's committed-item preview
  // caching, just keyed by the staged map's synthetic path instead of a MediaItem id.
  const stagedPreviewUrls = new Map<string, string>()
  // Cached for this adapter instance once granted/picked, so a whole session never needs more
  // than one prompt (or, once handlePersistence.ts has it, zero prompts across sessions).
  let localMediaRoot: FileSystemDirectoryHandle | undefined

  /** The local media folder if one has already been granted access — checks the in-memory cache,
   *  then a previously stored handle's still-live permission. Never prompts, so it's safe to call
   *  from contexts (rendering, delete) that aren't a fresh user gesture. */
  async function grantedLocalMediaRoot(): Promise<FileSystemDirectoryHandle | undefined> {
    if (localMediaRoot) return localMediaRoot
    const stored = await loadStoredLocalMediaHandle().catch(() => undefined)
    if (!stored) return undefined
    const permission = await stored.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
    if (permission !== 'granted') return undefined
    localMediaRoot = stored
    return stored
  }

  /** The local media folder, prompting for one if it hasn't been granted yet — only called from
   *  commitImport, the one path in this file that's always reached via a click on an "Import"
   *  button, so it still carries the user gesture showDirectoryPicker() requires. */
  async function ensureLocalMediaRoot(): Promise<FileSystemDirectoryHandle> {
    const granted = await grantedLocalMediaRoot()
    if (granted) return granted
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'worship-studio-local-media',
    })
    await storeLocalMediaHandle(handle)
    localMediaRoot = handle
    return handle
  }

  async function listNormalized(): Promise<MediaItem[]> {
    return (await items.list()).map(normalizeTitle)
  }

  /** The root+relative-dir pair a MediaItem's bytes currently live under, per its `location` —
   *  shared by save's move-on-location-change logic, delete, and getPreviewUrl. `undefined` root
   *  means "can't be reached from here" (a 'local' item whose folder isn't granted this session),
   *  same "location is inherently machine-local" caveat documented on the module itself. */
  async function locateBytes(
    item: MediaItem,
  ): Promise<{ dirRoot: FileSystemDirectoryHandle | undefined; relativeDir: string }> {
    return item.location === 'local'
      ? { dirRoot: await grantedLocalMediaRoot(), relativeDir: '' }
      : { dirRoot: root, relativeDir: MEDIA_FILES_DIR }
  }

  return {
    list: () => listNormalized(),
    save: async (item) => {
      const previous = await items.get(item.id)
      if (previous && previous.location !== item.location) {
        // Rust's save() (src-tauri/src/domain/media.rs) does the same move-on-location-change —
        // otherwise the file would stay in its old folder while getPreviewUrl/delete start
        // looking for it in the new one, silently breaking playback.
        const { dirRoot: srcRoot, relativeDir: srcDir } = await locateBytes(previous)
        const bytes = srcRoot && (await readBytes(srcRoot, joinPath(srcDir, previous.filename)))
        if (srcRoot && bytes) {
          const isMovingToLocal = item.location === 'local'
          const destRoot = isMovingToLocal ? await ensureLocalMediaRoot() : root
          const destDir = isMovingToLocal ? '' : MEDIA_FILES_DIR
          const destFilename = await uniqueFilename(destRoot, destDir, item.filename)
          await writeBytes(destRoot, joinPath(destDir, destFilename), bytes)
          await removeFile(srcRoot, joinPath(srcDir, previous.filename))
          item = { ...item, filename: destFilename }
        }
        // A missing/inaccessible source (already gone, or a 'local' file this machine never
        // had) leaves nothing to move — the metadata update below still proceeds, matching
        // delete()'s "metadata is authoritative, file cleanup is best-effort" precedent.
      }
      await items.save(item)
    },
    pickFilesToImport: async () => {
      const files = await pickFilesInBrowser()
      const existing = await listNormalized()
      const result: StagedMediaFile[] = []
      for (const file of files) {
        const bytes = await file.arrayBuffer()
        const hash = await hashBytes(bytes)
        const duplicate = existing.find((item) => item.contentHash === hash)
        const key = `staged-${crypto.randomUUID()}`
        staged.set(key, file)
        result.push({
          path: key,
          filename: file.name,
          sizeBytes: file.size,
          kind: guessKind(file.name),
          duplicateOfId: duplicate?.id,
          duplicateOfFilename: duplicate?.filename,
        })
      }
      return result
    },
    getStagedPreviewUrl: async (path) => {
      const cached = stagedPreviewUrls.get(path)
      if (cached) return cached
      const file = staged.get(path)
      if (!file) return undefined
      const url = URL.createObjectURL(file)
      stagedPreviewUrls.set(path, url)
      return url
    },
    commitImport: async (files: MediaImportCommit[]) => {
      const created: MediaItem[] = []
      for (const commit of files) {
        const file = staged.get(commit.path)
        if (!file) {
          throw new Error(
            `Staged file not found for "${commit.filename}" — it may have already been committed, or the page was reloaded since it was picked.`,
          )
        }
        // 'local' files live flat in their own granted folder (mirrors Rust's
        // local_media_root.join(filename), no subfolder); 'synced' files stay under this
        // library's media/ subfolder, same as before.
        const isLocal = commit.location === 'local'
        const dirRoot = isLocal ? await ensureLocalMediaRoot() : root
        const relativeDir = isLocal ? '' : MEDIA_FILES_DIR
        const destFilename = await uniqueFilename(dirRoot, relativeDir, commit.filename)
        const bytes = await file.arrayBuffer()
        await writeBytes(dirRoot, joinPath(relativeDir, destFilename), bytes)
        const saved = await items.save({
          id: `media-${crypto.randomUUID()}`,
          filename: destFilename,
          title: commit.title.trim() || titleFromFilename(commit.filename),
          description: commit.description,
          kind: guessKind(commit.filename),
          tags: commit.tags,
          location: commit.location,
          duplicateOfId: commit.duplicateOfId,
          contentHash: await hashBytes(bytes),
          usage: { usesPastYear: 0 },
          updatedAt: '',
          updatedByDevice: '',
        })
        created.push(saved)
        staged.delete(commit.path)
      }
      return created
    },
    detectDuplicates: async (item) => {
      const existing = await listNormalized()
      return existing.filter(
        (other) => other.id !== item.id && other.contentHash === item.contentHash,
      )
    },
    delete: async (id) => {
      const item = await items.get(id)
      await items.delete(id)
      if (!item) return
      // Only removes the backing file if it's actually reachable from here (a 'local' item
      // needs this machine to already have that folder granted) — deleting the metadata record
      // still succeeds either way (see module doc comment).
      const { dirRoot, relativeDir } = await locateBytes(item)
      if (dirRoot) await removeFile(dirRoot, joinPath(relativeDir, item.filename))
    },
    // No getFilePath — Tauri-only per its own doc comment (turned into a usable src via
    // convertFileSrc, which has no browser equivalent); getPreviewUrl below covers the web build.
    getPreviewUrl: async (id) => {
      const item = await items.get(id)
      if (!item) return undefined
      const { dirRoot, relativeDir } = await locateBytes(item)
      if (!dirRoot) return undefined
      const bytes = await readBytes(dirRoot, joinPath(relativeDir, item.filename))
      if (!bytes) return undefined
      const mimeType = item.kind === 'video' ? 'video/mp4' : 'image/*'
      return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    },
    importStockBackgrounds: async () => {
      const existingMedia = await listNormalized()
      let mediaAdded = 0
      for (const background of stockBackgrounds) {
        if (existingMedia.some((item) => item.id === background.id)) continue
        // Bundled as a static asset (public/stock-backgrounds/, see scripts/optimize-stock-
        // backgrounds.mjs) — BASE_URL accounts for the GitHub Pages deploy's non-root base path.
        const response = await fetch(
          `${import.meta.env.BASE_URL}stock-backgrounds/${background.filename}`,
        )
        if (!response.ok) continue // skip rather than fail the whole batch on one missing asset
        const bytes = await response.arrayBuffer()
        const destFilename = await uniqueFilename(root, MEDIA_FILES_DIR, background.filename)
        await writeBytes(root, joinPath(MEDIA_FILES_DIR, destFilename), bytes)
        await items.save({
          id: background.id,
          filename: destFilename,
          title: background.title,
          kind: 'image',
          tags: ['Background', 'Stock'],
          location: 'synced',
          contentHash: await hashBytes(bytes),
          usage: { usesPastYear: 0 },
          updatedAt: '',
          updatedByDevice: '',
        })
        mediaAdded++
      }

      // Snapshotted once before the loop (not updated as stock themes get saved below) — same
      // "only fills gaps present before this run started" behavior as the mock/Rust versions.
      const existingThemes = await themes.list()
      const claimedDefaults = new Set(existingThemes.flatMap(presentationThemeDefaults))
      let themesAdded = 0
      for (const stockTheme of stockThemes) {
        if (existingThemes.some((theme) => theme.id === stockTheme.id)) continue
        const theme: Theme = {
          id: stockTheme.id,
          name: stockTheme.name,
          backgroundId: stockTheme.backgroundMediaId,
          font: stockTheme.font,
          textColor: stockTheme.textColor,
          outline: true,
          appliesTo: [],
          useAsDefaultFor: stockTheme.intendedDefaults.filter(
            (target) => !claimedDefaults.has(target),
          ),
          updatedAt: '',
          updatedByDevice: '',
        }
        await themes.save(theme)
        themesAdded++
      }
      return { mediaAdded, themesAdded }
    },
  }
}
