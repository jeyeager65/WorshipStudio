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
  const writable = await fileHandle.createWritable()
  await writable.write(text)
  await writable.close()
}

export async function writeJsonFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await writeTextFile(root, relativePath, JSON.stringify(value, null, 2))
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
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()
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
