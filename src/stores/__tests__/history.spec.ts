import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHistoryStore } from '@/stores/history'

describe('history store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('undoes, redoes, and tracks the saved revision', () => {
    const store = useHistoryStore()
    let value = 'before'
    let dirty = false
    store.registerScope((next) => (dirty = next))

    value = 'after'
    store.push(
      'Edit title',
      () => (value = 'before'),
      () => (value = 'after'),
    )
    expect(store.canUndo).toBe(true)
    expect(store.undoLabel).toBe('Edit title')
    expect(dirty).toBe(true)

    store.markSaved()
    expect(dirty).toBe(false)
    store.undo()
    expect(value).toBe('before')
    expect(store.canRedo).toBe(true)
    expect(dirty).toBe(true)
    store.redo()
    expect(value).toBe('after')
    expect(dirty).toBe(false)
  })

  it('groups continuous changes from the same field into one step', () => {
    const store = useHistoryStore()
    let value = ''
    store.registerScope(() => undefined)

    value = 'A'
    store.push(
      'Edit title',
      () => (value = ''),
      () => (value = 'A'),
      'title-field',
    )
    value = 'Amazing Grace'
    store.push(
      'Edit title',
      () => (value = 'A'),
      () => (value = 'Amazing Grace'),
      'title-field',
    )

    store.undo()
    expect(value).toBe('')
    expect(store.canUndo).toBe(false)
    store.redo()
    expect(value).toBe('Amazing Grace')
  })

  it('keeps a new unsaved document dirty even at its initial history position', () => {
    const store = useHistoryStore()
    let dirty = false
    store.registerScope((next) => (dirty = next), true)
    expect(dirty).toBe(true)

    store.markSaved()
    expect(dirty).toBe(false)
  })

  it('drops the redo branch when editing after undo', () => {
    const store = useHistoryStore()
    store.registerScope(() => undefined)
    store.push('First', () => undefined, () => undefined)
    store.push('Second', () => undefined, () => undefined)
    store.undo()
    expect(store.canRedo).toBe(true)

    store.push('Replacement', () => undefined, () => undefined)
    expect(store.canRedo).toBe(false)
    expect(store.undoLabel).toBe('Replacement')
  })
})
