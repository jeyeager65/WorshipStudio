/**
 * The tablet build's local cache root — a thin wrapper around navigator.storage.getDirectory()
 * (the Origin Private File System). A single seam so tests can stub it and so a browser without
 * OPFS support gets a real error message instead of a raw "getDirectory is not a function".
 *
 * OPFS returns the same FileSystemDirectoryHandle type showDirectoryPicker() does (see
 * adapters/web/fsaStorage.ts's doc comment) — that's what lets every existing web/*.ts port
 * module run unmodified against this root once it's wrapped for dirty-tracking
 * (dirtyTrackingRoot.ts).
 */

/**
 * Asks the browser to keep this origin's storage rather than treating it as a disposable cache.
 *
 * Without it the whole local library is "best-effort" storage, which a browser may evict under
 * storage pressure — costing a full re-download, and losing any edit that had not finished
 * uploading. That is a real risk for a device used heavily with a large library, and the app has
 * no way to notice it happened.
 *
 * Best-effort in itself: a refusal, or a browser without the API, leaves things exactly as they
 * were, so nothing here is worth failing a connection over. Chrome generally grants it without a
 * prompt once a PWA is installed; iOS exempts Home Screen apps from its usual eviction anyway, so
 * this mostly buys protection on Android and desktop browsers.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    // Already granted on a previous run — asking again would be a pointless round trip, and on
    // some browsers a second prompt.
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error(
      "This browser doesn't support the local storage this app needs (Origin Private File System). Try a recent version of Chrome, Edge, or Safari.",
    )
  }
  return navigator.storage.getDirectory()
}
