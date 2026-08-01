import { describe, expect, it } from 'vitest'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'

describe('useAsyncStoreState', () => {
  it('distinguishes initial loading from a background refresh', async () => {
    const state = useAsyncStoreState()
    let finishLoad!: () => void
    const firstLoad = state.runLoad(
      () => new Promise<void>((resolve) => (finishLoad = resolve)),
    )

    expect(state.loading.value).toBe(true)
    expect(state.refreshing.value).toBe(false)
    finishLoad()
    await firstLoad
    expect(state.loaded.value).toBe(true)

    let finishRefresh!: () => void
    const refresh = state.runLoad(
      () => new Promise<void>((resolve) => (finishRefresh = resolve)),
    )
    expect(state.loading.value).toBe(false)
    expect(state.refreshing.value).toBe(true)
    expect(state.loaded.value).toBe(true)
    finishRefresh()
    await refresh
  })

  it('retains a load error for retry and clears it after success', async () => {
    const state = useAsyncStoreState()

    expect(await state.runLoad(() => Promise.reject(new Error('Library unavailable')))).toBe(
      false,
    )
    expect(state.loaded.value).toBe(false)
    expect(state.loadError.value).toBe('Library unavailable')

    expect(await state.runLoad(() => Promise.resolve())).toBe(true)
    expect(state.loaded.value).toBe(true)
    expect(state.loadError.value).toBe('')
  })

  it('records mutation failures while preserving rejection semantics', async () => {
    const state = useAsyncStoreState()

    await expect(state.runMutation(() => Promise.reject(new Error('Disk is full')))).rejects.toThrow(
      'Disk is full',
    )
    expect(state.mutationError.value).toBe('Disk is full')

    state.clearMutationError()
    expect(state.mutationError.value).toBe('')
  })
})
