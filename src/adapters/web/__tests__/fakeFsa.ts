/**
 * A minimal in-memory stand-in for the File System Access API, since Node/vitest has no real
 * implementation. Only implements the handful of methods fsaStorage.ts actually calls
 * (entries/getDirectoryHandle/getFileHandle/removeEntry, plus getFile/createWritable on file
 * handles) — cast to the real DOM types at the boundary rather than implementing every member
 * of FileSystemDirectoryHandle/FileSystemFileHandle, which would be pure boilerplate here.
 */

interface FakeFileNode {
  kind: 'file'
  // Stored as bytes, same as a real File underneath — text()/arrayBuffer() are both just views
  // over this, matching how writeTextFile/writeJsonFile and writeBytes (fsaStorage.ts) both
  // funnel through the same createWritable() path in real FSA.
  content: ArrayBuffer
}

interface FakeDirNode {
  kind: 'directory'
  children: Map<string, FakeFileNode | FakeDirNode>
}

function makeDirNode(): FakeDirNode {
  return { kind: 'directory', children: new Map() }
}

function notFound(): DOMException {
  return new DOMException('A requested file or directory could not be found', 'NotFoundError')
}

function typeMismatch(): DOMException {
  return new DOMException(
    'The path supplied exists, but was not the expected type',
    'TypeMismatchError',
  )
}

async function toArrayBuffer(data: string | ArrayBuffer | Blob): Promise<ArrayBuffer> {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer
  if (data instanceof Blob) return data.arrayBuffer()
  return data
}

class FakeFileHandle {
  readonly kind = 'file' as const
  constructor(private readonly node: FakeFileNode) {}

  async getFile(): Promise<File> {
    const content = this.node.content
    return {
      text: async () => new TextDecoder().decode(content),
      arrayBuffer: async () => content,
    } as unknown as File
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: ArrayBuffer[] = []
    const node = this.node
    return {
      write: async (data: string | ArrayBuffer | Blob) => {
        chunks.push(await toArrayBuffer(data))
      },
      close: async () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        node.content = merged.buffer
      },
    } as unknown as FileSystemWritableFileStream
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  constructor(private readonly node: FakeDirNode) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.node.children.get(name)
    if (existing) {
      if (existing.kind !== 'directory') throw typeMismatch()
      return new FakeDirectoryHandle(existing) as unknown as FileSystemDirectoryHandle
    }
    if (!options?.create) throw notFound()
    const created = makeDirNode()
    this.node.children.set(name, created)
    return new FakeDirectoryHandle(created) as unknown as FileSystemDirectoryHandle
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    const existing = this.node.children.get(name)
    if (existing) {
      if (existing.kind !== 'file') throw typeMismatch()
      return new FakeFileHandle(existing) as unknown as FileSystemFileHandle
    }
    if (!options?.create) throw notFound()
    const created: FakeFileNode = { kind: 'file', content: new ArrayBuffer(0) }
    this.node.children.set(name, created)
    return new FakeFileHandle(created) as unknown as FileSystemFileHandle
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.node.children.has(name)) throw notFound()
    this.node.children.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, node] of this.node.children) {
      const handle =
        node.kind === 'directory' ? new FakeDirectoryHandle(node) : new FakeFileHandle(node)
      yield [name, handle as unknown as FileSystemHandle]
    }
  }
}

export function createFakeRoot(): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle(makeDirNode()) as unknown as FileSystemDirectoryHandle
}
