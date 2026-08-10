/**
 * Routes a file write through opfsWriteWorker.ts when the main thread's own
 * FileSystemFileHandle.createWritable() isn't available — WebKit/Safari's situation; see that
 * worker's own doc comment for the confirmed underlying reason. fsaStorage.ts is the only
 * caller, and only on the fallback path (Chrome/Edge/Firefox never need this — they get the
 * fast, direct createWritable() path unchanged).
 *
 * Takes the root-relative OPFS path rather than a FileSystemFileHandle — see opfsWriteWorker.ts's
 * doc comment for why a handle can't cross this boundary on WebKit.
 *
 * One shared worker instance for the page's lifetime, requests matched to responses by an
 * incrementing id rather than one worker per call — multiple writes can legitimately be in
 * flight at once (e.g. cloudSync.ts applying several pulled files back to back).
 */

interface PendingWrite {
  resolve: () => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, PendingWrite>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./opfsWriteWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; error?: string }>) => {
    const { id, error } = event.data
    const waiting = pending.get(id)
    if (!waiting) return
    pending.delete(id)
    if (error) waiting.reject(new Error(error))
    else waiting.resolve()
  }
  return worker
}

export function writeViaSyncAccessHandle(
  relativePath: string,
  data: ArrayBuffer,
): Promise<void> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    // A defensive copy, transferred rather than cloned (zero-copy, matters for large media) —
    // the copy means the caller's own buffer is never detached by the transfer, so every
    // existing (and future) writeBytes/writeTextFile caller can keep treating the buffer they
    // passed in as still theirs afterward, same contract as the direct createWritable() path.
    const transferable = data.slice(0)
    getWorker().postMessage({ id, path: relativePath, data: transferable }, [transferable])
  })
}
