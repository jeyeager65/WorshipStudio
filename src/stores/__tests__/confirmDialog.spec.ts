import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfirmDialogStore } from '@/stores/confirmDialog'

describe('confirmDialog store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('confirm() resolves true on confirm and false on cancel', async () => {
    const store = useConfirmDialogStore()
    const pending = store.confirm('Are you sure?')
    expect(store.isOpen).toBe(true)
    store.respond('confirm')
    expect(await pending).toBe(true)

    const pendingCancel = store.confirm('Are you sure?')
    store.respond('cancel')
    expect(await pendingCancel).toBe(false)
  })

  it('confirmWithPhrase() blocks confirm until the typed phrase matches exactly', async () => {
    const store = useConfirmDialogStore()
    const pending = store.confirmWithPhrase('Delete everything?', 'DELETE', 'Delete')

    // Wrong/partial phrase — respond('confirm') must not resolve the promise.
    store.typedPhrase = 'delete'
    store.respond('confirm')
    expect(store.isOpen).toBe(true)

    store.typedPhrase = 'DELETE'
    store.respond('confirm')
    expect(await pending).toBe(true)
    expect(store.isOpen).toBe(false)
  })

  it('confirmWithPhrase() still resolves false on cancel regardless of the typed value', async () => {
    const store = useConfirmDialogStore()
    const pending = store.confirmWithPhrase('Delete everything?', 'DELETE', 'Delete')
    store.typedPhrase = 'DELETE'
    store.respond('cancel')
    expect(await pending).toBe(false)
  })

  it('a later plain confirm() clears a previous requiredPhrase', async () => {
    const store = useConfirmDialogStore()
    const first = store.confirmWithPhrase('Delete everything?', 'DELETE', 'Delete')
    store.typedPhrase = 'DELETE'
    store.respond('confirm')
    await first

    store.confirm('Plain question?')
    expect(store.requiredPhrase).toBeUndefined()
  })
})
