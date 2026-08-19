import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTauriUpdateStore } from '@/stores/tauriUpdate'

const { check, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))

function fakeUpdate() {
  return { downloadAndInstall: vi.fn().mockResolvedValue(undefined) }
}

describe('tauriUpdate store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    check.mockReset()
    relaunch.mockReset()
  })

  it('reports an available update and marks hasChecked once check() resolves one', async () => {
    const store = useTauriUpdateStore()
    check.mockResolvedValueOnce(fakeUpdate())

    await store.checkForUpdate()

    expect(store.updateAvailable).toBe(true)
    expect(store.hasChecked).toBe(true)
    expect(store.checkError).toBe('')
  })

  it('reports no update and still marks hasChecked when check() resolves null', async () => {
    const store = useTauriUpdateStore()
    check.mockResolvedValueOnce(null)

    await store.checkForUpdate()

    expect(store.updateAvailable).toBe(false)
    expect(store.hasChecked).toBe(true)
  })

  it('surfaces an error and leaves hasChecked false when check() rejects', async () => {
    const store = useTauriUpdateStore()
    check.mockRejectedValueOnce(new Error('offline'))

    await store.checkForUpdate()

    expect(store.checkError).toBe('offline')
    expect(store.hasChecked).toBe(false)
    expect(store.updateAvailable).toBe(false)
  })

  it('does not start a second check while one is already in flight', async () => {
    const store = useTauriUpdateStore()
    let resolveCheck: (value: null) => void = () => {}
    check.mockReturnValueOnce(new Promise((resolve) => (resolveCheck = resolve)))

    const first = store.checkForUpdate()
    expect(store.checking).toBe(true)
    await store.checkForUpdate() // should return immediately, not call check() again
    expect(check).toHaveBeenCalledTimes(1)

    resolveCheck(null)
    await first
  })

  it('downloads, installs, and relaunches when an update is pending', async () => {
    const store = useTauriUpdateStore()
    const update = fakeUpdate()
    check.mockResolvedValueOnce(update)
    await store.checkForUpdate()

    await store.applyUpdate()

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('does nothing when applyUpdate is called with no pending update', async () => {
    const store = useTauriUpdateStore()

    await store.applyUpdate()

    expect(relaunch).not.toHaveBeenCalled()
    expect(store.applying).toBe(false)
  })

  it('surfaces an error and resets applying when downloadAndInstall fails', async () => {
    const store = useTauriUpdateStore()
    const update = { downloadAndInstall: vi.fn().mockRejectedValue(new Error('disk full')) }
    check.mockResolvedValueOnce(update)
    await store.checkForUpdate()

    await store.applyUpdate()

    expect(store.checkError).toBe('disk full')
    expect(store.applying).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
  })
})
