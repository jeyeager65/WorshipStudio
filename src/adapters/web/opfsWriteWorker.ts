/**
 * Dedicated Web Worker for writing OPFS files on WebKit (Safari/iOS), which — confirmed directly
 * against WebKit's own engineering blog, not assumed — doesn't implement
 * FileSystemFileHandle.createWritable() at all. WebKit's OPFS implementation only supports
 * writing through FileSystemSyncAccessHandle.write(), and that API is exclusive to Worker
 * contexts; it doesn't exist on the main thread at all. This worker exists purely so
 * opfsWriteFallback.ts (fsaStorage.ts's caller, on the main thread) can hand off one write and
 * await its result, transparently to every port built on writeTextFile/writeBytes — none of them
 * need to know this fallback exists.
 *
 * Takes a root-relative OPFS path, not a FileSystemFileHandle — an earlier version posted the
 * handle itself, on the (Chromium-shaped) assumption that FileSystemFileHandle is generally
 * structured-cloneable across a postMessage boundary. Confirmed wrong on a real iPad: WebKit
 * rejects it with "The object can not be cloned." OPFS is per-origin rather than tied to the
 * handle that reached it, so instead this worker just calls navigator.storage.getDirectory()
 * itself and walks the same relative path fsaStorage.ts already resolved on the main thread —
 * sidesteps the clonability question entirely rather than depending on it.
 *
 * Writes to a private temp file first, then moves it over the real target, rather than
 * truncating and writing the target file in place — confirmed on a real device that writing in
 * place lets a concurrent reader (another page's own store load, mid-sync) observe a truncated or
 * partially-written file and fail to parse it. Chrome/Edge/Firefox's createWritable() doesn't
 * have this problem (fsaStorage.ts's own doc comment: its swap-file write only replaces the real
 * file on close(), confirmed atomic-enough) — this brings the WebKit fallback path to the same
 * guarantee via move(), which OPFS specifies as an atomic rename/replace within the same
 * directory.
 *
 * move() feature-detection and its exact call signature both had to be corrected against a real
 * iPad after first shipping this: WebKit's move() rejects a single-argument same-directory rename
 * with "Not enough arguments" — it needs the (newParent, newName) form even when newParent is the
 * handle's own current parent — so the earlier `tempHandle.move(name)` never actually moved
 * anything, and the *first* attempt to feature-detect move() (calling getFileHandle(name,
 * {create:true}) on the real target path, before ever touching the temp file) left an empty
 * 0-byte file at every target this ran against, since {create:true} creates the file immediately
 * regardless of whether anything is ever written to it — the same failure mode as the
 * createWritable() absence this whole worker exists to route around in the first place. Now the
 * probe runs against the *temp* file (which gets written and moved or removed either way, never
 * left stranded at a real content path), and any failure of the atomic path for any reason —
 * missing move(), a signature this browser doesn't accept, anything — falls back to writing the
 * target directly instead of failing the whole write, so a future WebKit surprise degrades to the
 * previously-shipped, already-working behavior rather than corrupting a sync outright.
 */

interface FileSystemSyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number
  truncate(newSize: number): void
  flush(): void
  close(): void
}

interface SyncAccessCapableFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
  /** Moves/renames this handle's entry to `newName` inside `newParent` — not yet in this
   *  project's installed DOM types, hence the local declaration. WebKit requires both arguments
   *  even for a same-directory rename (see this file's doc comment). */
  move?(newParent: FileSystemDirectoryHandle, newName: string): Promise<void>
}

interface WriteRequest {
  id: number
  path: string
  data: ArrayBuffer
}

interface WriteResponse {
  id: number
  error?: string
}

async function resolveParentAndName(
  path: string,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter((part) => part.length > 0)
  const name = parts.at(-1)
  if (!name) throw new Error(`Empty path: "${path}"`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return { dir, name }
}

async function writeToSyncAccessHandle(
  fileHandle: SyncAccessCapableFileHandle,
  data: ArrayBuffer,
): Promise<void> {
  const accessHandle = await fileHandle.createSyncAccessHandle()
  try {
    // Explicit truncate first: a sync access handle doesn't shrink the file to match shorter new
    // content on its own, so without this a write of a smaller file over a larger previous
    // version would leave stale bytes trailing at the end.
    accessHandle.truncate(data.byteLength)
    accessHandle.write(data, { at: 0 })
    accessHandle.flush()
  } finally {
    accessHandle.close()
  }
}

/** The atomic path: write into a private temp file (never a real content path, so a failure here
 *  never leaves a stray/empty file where a real record is expected), then move() it over the
 *  real target. Throws on any problem — missing move() support, an unexpected signature, a write
 *  failure — leaving cleanup and any fallback to the caller. */
async function writeAtomically(dir: FileSystemDirectoryHandle, name: string, data: ArrayBuffer): Promise<void> {
  // Suffix, not prefix — matches fsaStorage.ts's own .backup/.damaged-<stamp> convention, so a
  // temp file that somehow survives a crash before its move() still reads as "not a real record"
  // to every existing ".json"-suffix listing filter, the same way those already do.
  const tempName = `${name}.tmp-${crypto.randomUUID()}`
  const tempHandle = (await dir.getFileHandle(tempName, {
    create: true,
  })) as SyncAccessCapableFileHandle
  try {
    if (typeof tempHandle.move !== 'function') throw new Error('move() is not supported')
    await writeToSyncAccessHandle(tempHandle, data)
    await tempHandle.move(dir, name)
  } catch (error) {
    await dir.removeEntry(tempName).catch(() => {})
    throw error
  }
}

addEventListener('message', (event: MessageEvent<WriteRequest>) => {
  const { id, path, data } = event.data
  void (async () => {
    try {
      const { dir, name } = await resolveParentAndName(path)
      try {
        await writeAtomically(dir, name, data)
      } catch {
        // Falls back to writing the real target directly — the same behavior (and the same race
        // window this file's doc comment describes) this project already shipped and validated
        // before move() was introduced, so any surprise in the atomic path degrades to a
        // known-working write instead of failing outright.
        const targetHandle = (await dir.getFileHandle(name, {
          create: true,
        })) as SyncAccessCapableFileHandle
        await writeToSyncAccessHandle(targetHandle, data)
      }
      postMessage({ id } satisfies WriteResponse)
    } catch (error) {
      postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WriteResponse)
    }
  })()
})
