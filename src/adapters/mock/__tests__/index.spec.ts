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
})
