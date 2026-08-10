import { beforeEach, describe, expect, it, vi } from 'vitest'

// jsdom has no real Worker implementation — this fake captures what gets posted and lets each
// test control when/how the worker "responds", since that's the only real logic in
// opfsWriteFallback.ts worth testing (the actual write happens inside opfsWriteWorker.ts, a real
// Worker context this test environment can't run at all).
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
}

let lastWorker: FakeWorker | undefined
// A plain function, not an arrow function — opfsWriteFallback.ts calls this with `new`, which
// only works with a real constructor-capable function (arrow functions can never be `new`-ed,
// vi.fn() wrapping one doesn't change that).
vi.stubGlobal(
  'Worker',
  vi.fn(function FakeWorkerConstructor() {
    lastWorker = new FakeWorker()
    return lastWorker
  }),
)

// opfsWriteFallback.ts caches its worker instance and request-id counter at module scope —
// resetting modules and re-importing fresh before each test keeps every test's expectations
// (which response id belongs to which call, whether a second write reuses the worker) about
// *that test's own* calls, rather than accumulating state left over from earlier tests in this
// file.
let writeViaSyncAccessHandle: typeof import('../opfsWriteFallback').writeViaSyncAccessHandle

beforeEach(async () => {
  lastWorker = undefined
  vi.mocked(Worker).mockClear()
  vi.resetModules()
  ;({ writeViaSyncAccessHandle } = await import('../opfsWriteFallback'))
})

function respondToCall(callIndex: number, error?: string) {
  const message = lastWorker!.postMessage.mock.calls[callIndex]![0]
  lastWorker!.onmessage?.({ data: { id: message.id, error } } as MessageEvent)
}

describe('writeViaSyncAccessHandle', () => {
  it('posts the relative path and a transferred copy of the data to the worker', async () => {
    const data = new TextEncoder().encode('hello').buffer as ArrayBuffer

    const promise = writeViaSyncAccessHandle('songs/song-1.json', data)
    respondToCall(0)
    await promise

    expect(lastWorker!.postMessage).toHaveBeenCalledTimes(1)
    const [message, transferList] = lastWorker!.postMessage.mock.calls[0]!
    expect(message.path).toBe('songs/song-1.json')
    expect(new TextDecoder().decode(message.data)).toBe('hello')
    // A copy, not the original buffer — the caller's own buffer must never end up detached.
    expect(message.data).not.toBe(data)
    expect(transferList).toEqual([message.data])
  })

  it('resolves once the worker responds with no error', async () => {
    const promise = writeViaSyncAccessHandle('songs/song-1.json', new ArrayBuffer(0))
    respondToCall(0)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects with the worker-reported error message', async () => {
    const promise = writeViaSyncAccessHandle('songs/song-1.json', new ArrayBuffer(0))
    respondToCall(0, 'disk full')
    await expect(promise).rejects.toThrow('disk full')
  })

  it('matches concurrent writes to their own response, not response order', async () => {
    const first = writeViaSyncAccessHandle('songs/song-1.json', new ArrayBuffer(1))
    const second = writeViaSyncAccessHandle('songs/song-2.json', new ArrayBuffer(2))

    // Respond out of order — the second call's response arrives before the first's.
    respondToCall(1)
    respondToCall(0, 'first failed')

    await expect(second).resolves.toBeUndefined()
    await expect(first).rejects.toThrow('first failed')
  })

  it('reuses one worker instance across multiple writes', async () => {
    const first = writeViaSyncAccessHandle('songs/song-1.json', new ArrayBuffer(0))
    respondToCall(0)
    await first

    const second = writeViaSyncAccessHandle('songs/song-1.json', new ArrayBuffer(0))
    respondToCall(1)
    await second

    expect(Worker).toHaveBeenCalledTimes(1)
  })
})
