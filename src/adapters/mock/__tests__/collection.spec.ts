import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { MockCollection, MockSingleton } from '@/adapters/mock/collection'

interface Item {
  id: string
  title: string
  blocks: { id: string; text: string }[]
}

describe('MockCollection', () => {
  it('round-trips a plain object through save/list/get', async () => {
    const collection = new MockCollection<Item>(`test-${crypto.randomUUID()}`, [])
    await collection.save({ id: 'a', title: 'A', blocks: [{ id: 'b1', text: 'hi' }] })
    expect(await collection.get('a')).toEqual({
      id: 'a',
      title: 'A',
      blocks: [{ id: 'b1', text: 'hi' }],
    })
    expect(await collection.list()).toHaveLength(1)
  })

  it('accepts a Vue-reactive object without throwing, and stores a plain (non-reactive) copy', async () => {
    // Regression: editors bind directly to a reactive ref (e.g. SongEditorView's `song`) and
    // pass it straight to save(). structuredClone throws on a Proxy-wrapped array in this
    // position ("could not be cloned"); a JSON round-trip doesn't.
    const collection = new MockCollection<Item>(`test-${crypto.randomUUID()}`, [])
    const reactiveItem = reactive<Item>({ id: 'a', title: 'A', blocks: [{ id: 'b1', text: 'hi' }] })

    await expect(collection.save(reactiveItem)).resolves.not.toThrow()
    await expect(collection.list()).resolves.not.toThrow()

    const [stored] = await collection.list()
    expect(stored).toEqual({ id: 'a', title: 'A', blocks: [{ id: 'b1', text: 'hi' }] })
  })

  it('save() stores a copy — later mutating the caller-supplied object does not change stored data', async () => {
    const collection = new MockCollection<Item>(`test-${crypto.randomUUID()}`, [])
    const item = reactive<Item>({ id: 'a', title: 'A', blocks: [] })
    await collection.save(item)

    item.title = 'Mutated after save'

    expect((await collection.get('a'))?.title).toBe('A')
  })
})

describe('MockSingleton', () => {
  it('returns the seed value until saved', async () => {
    const singleton = new MockSingleton<{ name: string }>(`test-${crypto.randomUUID()}`, {
      name: 'seed',
    })
    expect(await singleton.get()).toEqual({ name: 'seed' })
  })

  it('persists a saved value across a fresh instance reading the same storage key (simulates a page reload)', async () => {
    const key = `test-${crypto.randomUUID()}`
    const first = new MockSingleton<{ name: string }>(key, { name: 'seed' })
    await first.save({ name: 'updated' })

    const second = new MockSingleton<{ name: string }>(key, { name: 'seed' })
    expect(await second.get()).toEqual({ name: 'updated' })
  })

  it('save() stores a copy — later mutating the caller-supplied object does not change stored data', async () => {
    const singleton = new MockSingleton<{ name: string }>(`test-${crypto.randomUUID()}`, {
      name: 'seed',
    })
    const value = reactive({ name: 'A' })
    await singleton.save(value)

    value.name = 'Mutated after save'

    expect((await singleton.get()).name).toBe('A')
  })
})
