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
 * FileSystemFileHandle is structured-cloneable by design specifically to support handing it off
 * to a worker like this one; createSyncAccessHandle()/FileSystemSyncAccessHandle aren't in this
 * project's installed DOM types yet (newer than @types/wicg-file-system-access covers), hence
 * the local interface below rather than an ambient declaration.
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
  fileHandle: FileSystemFileHandle
  data: ArrayBuffer
}

interface WriteResponse {
  id: number
  error?: string
}

addEventListener('message', (event: MessageEvent<WriteRequest>) => {
  const { id, fileHandle, data } = event.data
  void (async () => {
    try {
      const accessHandle = await (fileHandle as SyncAccessCapableFileHandle).createSyncAccessHandle()
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
