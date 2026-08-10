import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useTabletSync } from '../useTabletSync'

const { getAdapter } = vi.hoisted(() => ({ getAdapter: vi.fn() }))
vi.mock('@/adapters', () => ({ getAdapter }))

function makeAdapter(kind: string, runSync = vi.fn()) {
  return { kind, sync: { runSync } }
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

beforeEach(() => {
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
  it('does nothing for a non-tablet adapter', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('web', runSync))

    mountHost()

    expect(runSync).not.toHaveBeenCalled()
  })

  it('runs a sync once on mount for the tablet adapter', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))

    mountHost()

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('runs a sync again when the tab becomes visible', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    runSync.mockClear()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('runs a sync on window focus', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    runSync.mockClear()

    window.dispatchEvent(new Event('focus'))

    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('polls on an interval while visible, and stops polling once hidden', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    mountHost()
    runSync.mockClear()

    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(runSync).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    runSync.mockClear()

    vi.advanceTimersByTime(20 * 60 * 1000)
    expect(runSync).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', () => {
    const runSync = vi.fn()
    getAdapter.mockReturnValue(makeAdapter('tablet', runSync))
    const wrapper = mountHost()
    runSync.mockClear()

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(runSync).not.toHaveBeenCalled()
  })
})
