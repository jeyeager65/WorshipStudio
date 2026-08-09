/**
 * MediaPort for a File System Access-backed web build — media-items/<id>.json for metadata,
 * media/<filename> for the actual bytes, mirroring src-tauri/src/domain/media.rs.
 *
 * Two deliberate differences from the Rust version:
 * - Content hashing uses Web Crypto's SHA-256 (crypto.subtle.digest) rather than Rust's
 *   DefaultHasher. Rust's own comment on hash_file explains its choice as "avoids adding a
 *   hashing crate dependency for something this low-stakes" — the browser's built-in SHA-256 is
 *   the same reasoning applied to what's actually built into this platform; hashes are only ever
 *   compared within one adapter's own records, so cross-implementation hash equality was never a
 *   requirement.
 * - 'local' media (never-synced, too-large-to-share files, normally in a separate machine-local
 *   folder outside the synced library) has no distinct destination here — it lands in the same
 *   picked folder as 'synced' media. A genuinely separate local-only folder would need a second
 *   showDirectoryPicker() grant, which is real scope beyond this pass; documented here rather
 *   than silently pretending location fidelity that doesn't exist yet.
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

  async function listNormalized(): Promise<MediaItem[]> {
    return (await items.list()).map(normalizeTitle)
  }

  return {
    list: () => listNormalized(),
    save: async (item) => {
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
    commitImport: async (files: MediaImportCommit[]) => {
      const created: MediaItem[] = []
      for (const commit of files) {
        const file = staged.get(commit.path)
        if (!file) {
          throw new Error(
            `Staged file not found for "${commit.filename}" — it may have already been committed, or the page was reloaded since it was picked.`,
          )
        }
        const destFilename = await uniqueFilename(root, MEDIA_FILES_DIR, commit.filename)
        const bytes = await file.arrayBuffer()
        await writeBytes(root, joinPath(MEDIA_FILES_DIR, destFilename), bytes)
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
      if (item) await removeFile(root, joinPath(MEDIA_FILES_DIR, item.filename))
    },
    // No getFilePath — Tauri-only per its own doc comment (turned into a usable src via
    // convertFileSrc, which has no browser equivalent); getPreviewUrl below covers the web build.
    getPreviewUrl: async (id) => {
      const item = await items.get(id)
      if (!item) return undefined
      const bytes = await readBytes(root, joinPath(MEDIA_FILES_DIR, item.filename))
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
