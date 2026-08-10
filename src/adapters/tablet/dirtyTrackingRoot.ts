/**
 * Wraps a real FileSystemDirectoryHandle (in practice, always the OPFS root — see opfs.ts) so
 * every successful write (a createWritable().close()) or delete (removeEntry) anywhere under it
 * fires a callback with the path relative to `root` and what happened. This is the mechanism
 * that lets every existing web/*.ts port module (songs.ts, media.ts, settings.ts, etc.) run
 * completely unmodified against this root while the tablet's Dropbox sync engine
 * (cloudSync.ts) still finds out what changed locally since the last push — those port modules
 * only ever depend on the generic FileSystemDirectoryHandle interface already, and never need to
 * know sync exists at all.
 *
 * Implemented as Proxy wrappers around the *real* handles rather than a hand-written class
 * reimplementing FileSystemDirectoryHandle/FileSystemFileHandle from scratch (the shape
 * web/__tests__/fakeFsa.ts uses for an in-memory test double) — a Proxy guarantees every method
 * this file didn't think to special-case (queryPermission, resolve, keys/values, etc.) still
 * behaves exactly like the real handle, which matters here since this wraps a genuine browser
 * API object used in production, not a test double standing in for one.
 *
 * Only three operations are actually intercepted — getDirectoryHandle (to keep wrapping
 * recursively as the path gets walked), getFileHandle (to wrap the returned file's
 * createWritable), and removeEntry (fires onChange directly). Nothing else needs wrapping:
 * fsaStorage.ts's own helpers always re-resolve a path from `root` fresh via getDirectoryHandle
 * (see resolveParentDir), never by reusing a handle obtained from entries() to write through —
 * so entries()'s yielded children can safely pass through unwrapped.
 */

export type DirtyChangeKind = 'write' | 'remove'
export type OnDirtyChange = (relativePath: string, kind: DirtyChangeKind) => void

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

// Native Web API methods generally require `this` to be the real underlying object — calling
// them through a Proxy without rebinding throws "Illegal invocation" in every browser that
// implements OPFS. Every property access re-binds any function value to the real target for
// exactly this reason, not just the few properties this file actually cares about.
function bindThrough<T extends object>(target: T, prop: PropertyKey, receiver: unknown): unknown {
  const value = Reflect.get(target, prop, receiver)
  return typeof value === 'function' ? value.bind(target) : value
}

function wrapWritable(
  target: FileSystemWritableFileStream,
  path: string,
  onChange: OnDirtyChange,
): FileSystemWritableFileStream {
  return new Proxy(target, {
    get(target, prop, receiver) {
      if (prop === 'close') {
        return async () => {
          await target.close()
          onChange(path, 'write')
        }
      }
      return bindThrough(target, prop, receiver)
    },
  })
}

function wrapFileHandle(
  target: FileSystemFileHandle,
  path: string,
  onChange: OnDirtyChange,
): FileSystemFileHandle {
  return new Proxy(target, {
    get(target, prop, receiver) {
      if (prop === 'createWritable') {
        return async (options?: FileSystemCreateWritableOptions) =>
          wrapWritable(await target.createWritable(options), path, onChange)
      }
      return bindThrough(target, prop, receiver)
    },
  })
}

function wrapDirHandle(
  target: FileSystemDirectoryHandle,
  path: string,
  onChange: OnDirtyChange,
): FileSystemDirectoryHandle {
  return new Proxy(target, {
    get(target, prop, receiver) {
      if (prop === 'getDirectoryHandle') {
        return async (name: string, options?: FileSystemGetDirectoryOptions) =>
          wrapDirHandle(await target.getDirectoryHandle(name, options), joinPath(path, name), onChange)
      }
      if (prop === 'getFileHandle') {
        return async (name: string, options?: FileSystemGetFileOptions) =>
          wrapFileHandle(await target.getFileHandle(name, options), joinPath(path, name), onChange)
      }
      if (prop === 'removeEntry') {
        return async (name: string, options?: FileSystemRemoveOptions) => {
          await target.removeEntry(name, options)
          onChange(joinPath(path, name), 'remove')
        }
      }
      return bindThrough(target, prop, receiver)
    },
  })
}

export function wrapWithDirtyTracking(
  root: FileSystemDirectoryHandle,
  onChange: OnDirtyChange,
): FileSystemDirectoryHandle {
  return wrapDirHandle(root, '', onChange)
}
