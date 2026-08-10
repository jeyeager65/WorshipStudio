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
 *
 * The wrapped createWritable() below always looks present to fsaStorage.ts's own feature
 * detection, on every browser — a Proxy trap can't make a property genuinely "missing" only
 * some callers see, so hiding it here to reflect WebKit's real lack of createWritable() isn't an
 * option. Instead, this always returns a working writable-shaped object, whose close()
 * internally calls fsaStorage.ts's writeFileHandleData (the same createWritable-vs-worker-
 * fallback detection, but run against the *real* unwrapped `target`, not this Proxy — required
 * either way, since a Proxy can't be handed to opfsWriteFallback.ts's postMessage call: only a
 * genuine native FileSystemFileHandle is structured-cloneable). Every real call site in this
 * codebase (fsaStorage.ts's writeTextFile/writeBytes) only ever makes one write() call before
 * close(), so this doesn't implement arbitrary incremental streaming — just enough to match that.
 */

import { writeFileHandleData } from '@/adapters/web/fsaStorage'

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

/** A minimal writable-shaped stand-in for browsers (WebKit/Safari) with no real createWritable()
 *  at all — buffers the one write() call fsaStorage.ts's callers always make, then performs the
 *  actual write (via writeFileHandleData's own createWritable-or-worker-fallback detection) on
 *  close(), same as the real path does but through fsaStorage.ts's fallback instead of a real
 *  FileSystemWritableFileStream. */
function fallbackWritable(
  target: FileSystemFileHandle,
  path: string,
  onChange: OnDirtyChange,
): FileSystemWritableFileStream {
  let pendingData: string | ArrayBuffer | Blob | undefined
  return {
    write: async (data: string | ArrayBuffer | Blob) => {
      pendingData = data
    },
    close: async () => {
      if (pendingData === undefined) return
      await writeFileHandleData(target, pendingData)
      onChange(path, 'write')
    },
  } as unknown as FileSystemWritableFileStream
}

function wrapFileHandle(
  target: FileSystemFileHandle,
  path: string,
  onChange: OnDirtyChange,
): FileSystemFileHandle {
  return new Proxy(target, {
    get(target, prop, receiver) {
      if (prop === 'createWritable') {
        // See this module's own doc comment for why the real-vs-fallback decision has to happen
        // here, against `target` (the genuine native handle), rather than deferring to
        // fsaStorage.ts's identical feature-detection running against this Proxy itself.
        if (typeof target.createWritable !== 'function') {
          return async () => fallbackWritable(target, path, onChange)
        }
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
