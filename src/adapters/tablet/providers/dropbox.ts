/**
 * Dropbox's implementation of ../types.ts's CloudSyncProvider — the only place in this codebase
 * that knows Dropbox uses list_folder/list_folder_continue cursors, lower-case vs. display-case
 * paths, or that a 409 with `.tag: 'reset'` means "start over," not "conflict." cloudSync.ts
 * never sees any of that; it only ever sees this module's already-resolved ProviderEntry/
 * ProviderApiError shapes.
 */

import type { CloudSyncProvider, ProviderEntry } from './types'
import { ProviderApiError, ProviderReauthRequiredError } from './types'
import * as auth from './dropboxAuth'
import {
  DropboxApiError,
  deleteFile as dropboxDeleteFile,
  download as dropboxDownload,
  listFolder,
  listFolderContinue,
  uploadFile,
  type DropboxEntry,
  type ListFolderResult,
} from './dropboxClient'

export interface DropboxProviderConfig {
  appKey: string
  /** Dropbox path (relative to the connected account's own root) where the library lives — "" for
   *  the account root itself. */
  libraryFolderPath: string
}

function normalizeDropboxFolderPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function isCursorResetError(error: unknown): boolean {
  if (!(error instanceof DropboxApiError) || error.status !== 409) return false
  const body = error.body as { error?: { '.tag'?: string } } | undefined
  return body?.error?.['.tag'] === 'reset'
}

function toProviderError(error: unknown): never {
  if (error instanceof DropboxApiError) {
    if (error.status === 429) throw new ProviderApiError(error.message, 'rate-limit', error.retryAfterSeconds)
    if (error.status === 409) throw new ProviderApiError(error.message, 'conflict')
    throw new ProviderApiError(error.message, 'other')
  }
  throw error instanceof Error ? error : new Error(String(error))
}

export function createDropboxProvider(config: DropboxProviderConfig): CloudSyncProvider {
  const libraryFolderPath = normalizeDropboxFolderPath(config.libraryFolderPath)
  const libraryFolderPathLower = libraryFolderPath.toLowerCase()

  // Segment-count-based rather than character-length-based, so this stays correct even if
  // Dropbox's lowercasing ever changes a path's character length for some script — pathLower and
  // pathDisplay always have the same number of `/` segments regardless of case, only pathDisplay
  // preserves the real casing OPFS needs.
  function relativePathFromEntry(entry: DropboxEntry): string {
    const prefixSegments = libraryFolderPathLower.split('/').filter(Boolean)
    const displaySegments = entry.pathDisplay.split('/').filter(Boolean)
    return displaySegments.slice(prefixSegments.length).join('/')
  }

  function dropboxPathFor(relativePath: string): string {
    return libraryFolderPath ? `${libraryFolderPath}/${relativePath}` : `/${relativePath}`
  }

  function toProviderEntries(entries: DropboxEntry[]): ProviderEntry[] {
    const out: ProviderEntry[] = []
    for (const entry of entries) {
      if (entry.tag === 'folder') continue
      const path = relativePathFromEntry(entry)
      if (!path) continue // the library folder itself, not a real file inside it
      out.push(
        entry.tag === 'deleted'
          ? { tag: 'deleted', path }
          : {
              tag: 'file',
              path,
              rev: entry.rev,
              contentHash: entry.contentHash,
              sizeBytes: entry.sizeBytes,
            },
      )
    }
    return out
  }

  async function fetchAllPages(
    first: () => Promise<ListFolderResult>,
    token: string,
  ): Promise<{ entries: DropboxEntry[]; cursor: string }> {
    let result = await first()
    // Accumulated before anything is applied, so a mid-pagination failure never leaves some
    // entries from one logical batch applied and others not.
    const entries = [...result.entries]
    while (result.hasMore) {
      result = await listFolderContinue(token, result.cursor)
      entries.push(...result.entries)
    }
    return { entries, cursor: result.cursor }
  }

  return {
    id: 'dropbox',

    async getValidAccessToken() {
      const token = await auth.getValidAccessToken(config.appKey)
      if (!token) throw new ProviderReauthRequiredError('Not connected to Dropbox on this device.')
      return token
    },
    isConnected: () => auth.isConnected(),
    disconnect: () => auth.disconnect(),

    async listChanges(token, cursor) {
      try {
        if (!cursor) {
          const page = await fetchAllPages(
            () => listFolder(token, libraryFolderPath, { recursive: true }),
            token,
          )
          return { entries: toProviderEntries(page.entries), cursor: page.cursor, isFromScratchListing: true }
        }
        try {
          const page = await fetchAllPages(() => listFolderContinue(token, cursor), token)
          return { entries: toProviderEntries(page.entries), cursor: page.cursor, isFromScratchListing: false }
        } catch (error) {
          if (!isCursorResetError(error)) throw error
          // The cursor is stale beyond recovery — local content is untouched either way, only
          // the delta baseline resets, so this just costs one full re-listing. Reported as
          // from-scratch too (see this interface's own doc comment) so cloudSync.ts's orphan
          // reconciliation still runs even though the *caller's* cursor argument wasn't undefined.
          const page = await fetchAllPages(
            () => listFolder(token, libraryFolderPath, { recursive: true }),
            token,
          )
          return { entries: toProviderEntries(page.entries), cursor: page.cursor, isFromScratchListing: true }
        }
      } catch (error) {
        toProviderError(error)
      }
    },

    async download(token, path) {
      try {
        const { bytes, entry } = await dropboxDownload(token, dropboxPathFor(path))
        return { bytes, rev: entry.rev, contentHash: entry.contentHash, sizeBytes: entry.sizeBytes }
      } catch (error) {
        toProviderError(error)
      }
    },

    async upload(token, path, bytes, mode) {
      try {
        const entry = await uploadFile(token, dropboxPathFor(path), bytes, mode)
        return { rev: entry.rev, contentHash: entry.contentHash, sizeBytes: entry.sizeBytes }
      } catch (error) {
        toProviderError(error)
      }
    },

    async deleteFile(token, path) {
      try {
        await dropboxDeleteFile(token, dropboxPathFor(path))
      } catch (error) {
        toProviderError(error)
      }
    },
  }
}
