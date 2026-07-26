import { beforeEach, describe, expect, it } from 'vitest'
import { createMockAdapter } from '@/adapters/mock'

beforeEach(() => {
  localStorage.clear()
})

describe('mock adapter', () => {
  it('lists seeded songs', async () => {
    const adapter = createMockAdapter()
    const songs = await adapter.songs.list()
    expect(songs.length).toBeGreaterThan(0)
    expect(songs[0].title).toBe('Amazing Grace')
  })

  it('saves and retrieves a new song', async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-test',
      title: 'Test Song',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
    })
    const found = await adapter.songs.get('song-test')
    expect(found?.title).toBe('Test Song')
  })

  it('resolves a scripture reference without a network call', async () => {
    const adapter = createMockAdapter()
    const passage = await adapter.scripture.resolve('John 3:16', 'ESV')
    expect(passage.reference).toBe('John 3:16')
    expect(passage.verses.length).toBeGreaterThan(0)
  })

  it('resolves a multi-verse range with verses in order', async () => {
    const adapter = createMockAdapter()
    const passage = await adapter.scripture.resolve('John 3:16-17', 'KJV')
    expect(passage.verses.map((v) => v.number)).toEqual([16, 17])
  })

  it('rejects a structurally invalid reference', async () => {
    const adapter = createMockAdapter()
    await expect(adapter.scripture.resolve('Not A Book 1:1', 'KJV')).rejects.toThrow()
  })

  it('resolves any valid reference across the whole Bible, not just a handful of samples', async () => {
    const adapter = createMockAdapter()
    await expect(adapter.scripture.resolve('Genesis 1:1', 'KJV')).resolves.not.toThrow()
    await expect(adapter.scripture.resolve('Revelation 22:21', 'KJV')).resolves.not.toThrow()
  })
})
