/**
 * Generic File System Access API helpers shared by every web-build storage port. Deliberately
 * mirrors the shape of src-tauri/src/domain/mod.rs's read_json_file/write_json_file/
 * read_json_dir — same "missing vs malformed" distinction, same relative-path addressing — so
 * porting Rust domain logic to TypeScript stays close to a straight translation.
 *
 * Paths here are always root-relative POSIX-style strings (e.g. "songs/song-1.json"), never
 * absolute — the File System Access API has no path concept, only handles reached by walking
 * from a root FileSystemDirectoryHandle. ".." and empty segments are rejected so a caller can't
 * walk outside the picked folder via a crafted relative path.
 */

import { writeViaSyncAccessHandle } from './opfsWriteFallback'

function segments(relativePath: string): string[] {
  const parts = relativePath.split('/').filter((part) => part.length > 0)
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Refusing to resolve an unsafe path: "${relativePath}"`)
  }
  return parts
}

/** Walks to the directory containing the final segment, optionally creating folders along the way. */
async function resolveParentDir(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  const parts = segments(relativePath)
  if (parts.length === 0) throw new Error('Empty path')
  const name = parts[parts.length - 1]!
  let dir = root
  for (const part of parts.slice(0, -1)) {
    try {
      dir = await dir.getDirectoryHandle(part, { create })
    } catch (error) {
      if (!create && (error as DOMException)?.name === 'NotFoundError') return null
      throw error
    }
  }
  return { dir, name }
}

/** Returns null if the file doesn't exist. Throws if it exists but isn't valid JSON — callers
 *  that need to distinguish "missing" from "malformed" (recovery scanning) rely on this. */
export async function readJsonFile<T>(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<T | null> {
  const located = await resolveParentDir(root, relativePath, false)
  if (!located) return null
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await located.dir.getFileHandle(located.name)
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null
    throw error
  }
  const file = await fileHandle.getFile()
  const text = await file.text()
  return JSON.parse(text) as T
}

/** Reads the raw text without parsing — used by recovery scanning, which needs to report the
 *  parse error itself rather than throw past the caller. */
export async function readFileText(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<string | null> {
  const located = await resolveParentDir(root, relativePath, false)
  if (!located) return null
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await located.dir.getFileHandle(located.name)
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null
    throw error
  }
  return (await fileHandle.getFile()).text()
}

/** WebKit (Safari/iOS) doesn't implement FileSystemFileHandle.createWritable() at all — confirmed
 *  directly against WebKit's own engineering blog, not assumed. Its OPFS implementation only
 *  supports writing through FileSystemSyncAccessHandle.write(), which is exclusive to Worker
 *  contexts, so that path is routed through opfsWriteFallback.ts's dedicated worker instead.
 *  Chrome/Edge/Firefox all support createWritable() directly and take the fast, direct path
 *  below unchanged. Centralized here so every caller (writeTextFile, writeBytes) — and by
 *  extension every port built on them — gets this transparently, with nothing to change on
 *  their end.
 *
 *  Takes the root-relative path alongside the handle, used only on the fallback branch — an
 *  earlier version handed the handle itself to opfsWriteFallback.ts for a postMessage transfer to
 *  its worker, on the assumption FileSystemFileHandle is generally structured-cloneable. Confirmed
 *  wrong on a real iPad (WebKit throws "The object can not be cloned."); see opfsWriteWorker.ts's
 *  doc comment for why resolving the path inside the worker instead sidesteps that entirely.
 *
 *  Exported (not just used internally) because adapters/tablet/dirtyTrackingRoot.ts needs this
 *  exact same feature-detection, run against the *real* underlying handle it wraps — its own
 *  Proxy has to always expose a `createWritable` property so callers never see it as "missing"
 *  (a Proxy trap can't un-expose a method some callers need while looking normal to others), so
 *  the actual createWritable-vs-fallback decision has to happen at this lower level instead,
 *  against a genuine native handle in both cases. See that file's own doc comment for the full
 *  reasoning. */
export async function writeFileHandleData(
  fileHandle: FileSystemFileHandle,
  relativePath: string,
  data: ArrayBuffer | Blob | string,
): Promise<void> {
  if (typeof fileHandle.createWritable === 'function') {
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
    return
  }
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data).buffer
      : data instanceof Blob
        ? await data.arrayBuffer()
        : data
  await writeViaSyncAccessHandle(relativePath, bytes)
}

/** createWritable()'s swap-file write only replaces the real file on close() — confirmed
 *  atomic-enough in the August 2026 File System Access spike. Creates parent folders as needed. */
export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  text: string,
): Promise<void> {
  const located = await resolveParentDir(root, relativePath, true)
  if (!located) throw new Error(`Could not resolve path: ${relativePath}`)
  const fileHandle = await located.dir.getFileHandle(located.name, { create: true })
  await writeFileHandleData(fileHandle, relativePath, text)
}

export function backupPath(relativePath: string): string {
  return `${relativePath}.backup`
}

/** Mirrors src-tauri/src/domain/mod.rs's write_json_file exactly: serialize the new value first
 *  (so a serialization failure touches nothing on disk), then — only if a previous version
 *  exists AND parses as valid JSON — write that previous version to `<path>.backup` before
 *  overwriting `path` with the new content. An already-corrupt existing file is left as-is
 *  rather than overwriting a known-good backup with garbage, so a prior successful save stays
 *  recoverable even after an external sync corruption. This is what gives the web build's own
 *  writes the same corruption protection recoverFromBackup/quarantineDamagedFile (sync.ts) rely
 *  on for the desktop build's writes. */
export async function writeJsonFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const bytes = JSON.stringify(value, null, 2)
  const previous = await readFileText(root, relativePath)
  if (previous !== null) {
    try {
      JSON.parse(previous)
      await writeTextFile(root, backupPath(relativePath), previous)
    } catch {
      // Previous version doesn't parse — never replace a known-good backup with corrupt bytes.
    }
  }
  await writeTextFile(root, relativePath, bytes)
}

/** Raw binary read/write for media files — everything else in this module is JSON/text. Returns
 *  null for a missing file, same "missing vs error" contract as readJsonFile. */
export async function readBytes(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<ArrayBuffer | null> {
  const located = await resolveParentDir(root, relativePath, false)
  if (!located) return null
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await located.dir.getFileHandle(located.name)
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null
    throw error
  }
  return (await fileHandle.getFile()).arrayBuffer()
}

export async function writeBytes(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  bytes: ArrayBuffer | Blob,
): Promise<void> {
  const located = await resolveParentDir(root, relativePath, true)
  if (!located) throw new Error(`Could not resolve path: ${relativePath}`)
  const fileHandle = await located.dir.getFileHandle(located.name, { create: true })
  await writeFileHandleData(fileHandle, relativePath, bytes)
}

export async function removeFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<void> {
  const located = await resolveParentDir(root, relativePath, false)
  if (!located) return
  try {
    await located.dir.removeEntry(located.name)
  } catch (error) {
    if ((error as DOMException)?.name !== 'NotFoundError') throw error
  }
}

/** No native rename in the File System Access API — read then write-elsewhere then remove the
 *  original. Not atomic across the three steps, unlike a real filesystem rename, which is an
 *  accepted gap for the low-frequency quarantine use case (see sync.ts). */
export async function renameFile(
  root: FileSystemDirectoryHandle,
  fromRelativePath: string,
  toRelativePath: string,
): Promise<void> {
  const text = await readFileText(root, fromRelativePath)
  if (text === null) throw new Error(`Cannot rename missing file: ${fromRelativePath}`)
  await writeTextFile(root, toRelativePath, text)
  await removeFile(root, fromRelativePath)
}

export interface DirEntry {
  name: string
  kind: 'file' | 'directory'
}

/** Non-recursive listing of one directory's immediate children. Returns [] for a directory that
 *  doesn't exist, matching Rust's read_json_dir treating a missing folder as "nothing here yet"
 *  rather than an error. */
export async function listEntries(
  root: FileSystemDirectoryHandle,
  relativeDir: string,
): Promise<DirEntry[]> {
  let dir = root
  for (const part of segments(relativeDir)) {
    try {
      dir = await dir.getDirectoryHandle(part)
    } catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError') return []
      throw error
    }
  }
  const out: DirEntry[] = []
  for await (const [name, handle] of dir.entries()) {
    out.push({ name, kind: handle.kind })
  }
  return out
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter((part) => part.length > 0)
    .join('/')
}

/** Recursively lists every file's root-relative path under the whole tree — unlike listEntries
 *  (one directory, non-recursive), this walks every subdirectory. Used by cloudSync.ts's
 *  resetAndResync() reconciliation to find locally-cached files no longer present in a fresh
 *  full listing from the provider; expensive enough (a full tree walk) that it's deliberately
 *  not used anywhere routine. */
export async function listAllFiles(
  root: FileSystemDirectoryHandle,
  relativeDir = '',
): Promise<string[]> {
  const out: string[] = []
  for (const entry of await listEntries(root, relativeDir)) {
    const path = joinPath(relativeDir, entry.name)
    if (entry.kind === 'directory') {
      out.push(...(await listAllFiles(root, path)))
    } else {
      out.push(path)
    }
  }
  return out
}
