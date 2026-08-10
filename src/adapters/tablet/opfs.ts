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
export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error(
      "This browser doesn't support the local storage this app needs (Origin Private File System). Try a recent version of Chrome, Edge, or Safari.",
    )
  }
  return navigator.storage.getDirectory()
}
