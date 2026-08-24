import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useTabletSync } from '../useTabletSync'

const { getAdapter } = vi.hoisted(() => ({ getAdapter: vi.fn() }))
vi.mock('@/adapters', () => ({ getAdapter }))

function makeAdapter(kind: string, runSync = vi.fn(), getStatus?: ReturnType<typeof vi.fn>) {
  return {
    kind,
    sync: {
      runSync,
      getStatus:
        getStatus ??
        vi.fn().mockResolvedValue({
          folderReadable: true,
          conflictCount: 0,
          recoveryCount: 0,
        }),
      listConflicts: vi.fn().mockResolvedValue([]),
      listRecoveryIssues: vi.fn().mockResolvedValue([]),
    },
  }
}

let mountedWrappers: ReturnType<typeof mount>[] = []

function mountHost() {
  const Host = defineComponent({
    setup() {
      useTabletSync()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  mountedWrappers.push(wrapper)
  return wrapper
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

// useSyncStore's runSync() guards against overlapping calls itself (syncing.value), on top of
// cloudSync.ts's own internal guard — so tests need to let one trigger's promise chain (adapter
// call -> finally -> load()) fully settle before dispatching the next one, or the second would
// be silently skipped as "already syncing" rather than genuinely testing that trigger path.
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  setActivePinia(createPinia())
  getAdapter.mockReset()
  vi.useFakeTimers()
  setVisibility('visible')
})

afterEach(() => {
  // useTabletSync attaches document/window listeners for the lifetime of its host component —
  // without this, an un-unmounted wrapper from one test keeps reacting to events dispatched by
  // the next test, since jsdom's document/window are shared across the whole file.
  for (const wrapper of mountedWrappers) wrapper.unmount()
  mountedWrappers = []
  vi.useRealTimers()
})

describe('useTabletSync', () => {
  it('does nothing for a non-tablet adapter', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('web', runSync))

    mountHost()
    await flush()

    expect(runSync).not.toHaveBeenCalled()
  })

  it('runs a sync once on mount for the tablet adapter', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))

    mountHost()
    await flush()

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('runs a sync again when the tab becomes visible', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    await flush()
    runSync.mockClear()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('runs a sync on window focus', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    await flush()
    runSync.mockClear()

    window.dispatchEvent(new Event('focus'))
    await flush()

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('polls on an interval while visible, and stops polling once hidden', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    await flush()
    runSync.mockClear()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(runSync).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    runSync.mockClear()

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(runSync).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', async () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    const wrapper = mountHost()
    await flush()
    runSync.mockClear()

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(runSync).not.toHaveBeenCalled()
  })

  it('sets the shared syncing flag for the duration of an automatic sync', async () => {
    let resolveRunSync!: () => void
    const runSync = vi.fn(() => new Promise<void>((resolve) => (resolveRunSync = resolve)))
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    const { useSyncStore } = await import('@/stores/sync')
    const syncStore = useSyncStore()

    mountHost()
    await flush()

    expect(syncStore.syncing).toBe(true)
    resolveRunSync()
    await flush()
    expect(syncStore.syncing).toBe(false)
  })

  it('schedules a quick follow-up sync when reauthFailurePending, ahead of the normal interval', async () => {
    const runSync = vi.fn()
    const getStatus = vi
      .fn()
      .mockResolvedValue({ folderReadable: true, conflictCount: 0, recoveryCount: 0, reauthFailurePending: true })
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync, getStatus))

    mountHost()
    await flush()
    expect(runSync).toHaveBeenCalledTimes(1)
    runSync.mockClear()

    await vi.advanceTimersByTimeAsync(20 * 1000)
    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('stops retrying quickly once reauthFailurePending clears', async () => {
    const runSync = vi.fn()
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ folderReadable: true, conflictCount: 0, recoveryCount: 0, reauthFailurePending: true })
      .mockResolvedValue({ folderReadable: true, conflictCount: 0, recoveryCount: 0, reauthFailurePending: false })
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync, getStatus))

    mountHost()
    await flush()
    runSync.mockClear()

    await vi.advanceTimersByTimeAsync(20 * 1000)
    expect(runSync).toHaveBeenCalledTimes(1)
    runSync.mockClear()

    await vi.advanceTimersByTimeAsync(20 * 1000)
    expect(runSync).not.toHaveBeenCalled()
  })
})
