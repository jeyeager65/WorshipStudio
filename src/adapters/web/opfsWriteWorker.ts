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
 */

interface FileSystemSyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number
  truncate(newSize: number): void
  flush(): void
  close(): void
}

interface SyncAccessCapableFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
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

async function resolveFileHandle(path: string): Promise<SyncAccessCapableFileHandle> {
  const parts = path.split('/').filter((part) => part.length > 0)
  const name = parts.at(-1)
  if (!name) throw new Error(`Empty path: "${path}"`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return (await dir.getFileHandle(name, { create: true })) as SyncAccessCapableFileHandle
}

addEventListener('message', (event: MessageEvent<WriteRequest>) => {
  const { id, path, data } = event.data
  void (async () => {
    try {
      const fileHandle = await resolveFileHandle(path)
      const accessHandle = await fileHandle.createSyncAccessHandle()
      try {
        // Explicit truncate first: a sync access handle doesn't shrink the file to match shorter
        // new content on its own, so without this a write of a smaller file over a larger
        // previous version would leave stale bytes trailing at the end.
        accessHandle.truncate(data.byteLength)
        accessHandle.write(data, { at: 0 })
        accessHandle.flush()
      } finally {
        accessHandle.close()
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
