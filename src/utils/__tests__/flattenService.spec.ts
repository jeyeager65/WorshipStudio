import { describe, expect, it } from 'vitest'
import { flattenService } from '@/utils/flattenService'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    title: 'Amazing Grace',
    collections: [],
    tags: [],
    blocks: [
      { id: 'v1', label: 'Verse 1', text: 'Amazing grace' },
      { id: 'c', label: 'Chorus', text: 'How sweet the sound' },
    ],
    defaultArrangement: { sequence: ['v1', 'c'] },
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-07-19',
    type: 'Sunday Morning Worship',
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('flattenService', () => {
  it('expands a song item into one flat slide per arrangement entry, including repeats', () => {
    const song = makeSong()
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1', 'c', 'c'] } }],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat).toHaveLength(3)
    expect(flat.map((s) => s.subLabel)).toEqual(['Verse 1', 'Chorus', 'Chorus'])
    expect(flat[0].text).toBe('Amazing grace')
    expect(flat.every((s) => s.itemLabel === 'Amazing Grace')).toBe(true)
    expect(flat.every((s) => s.itemId === 'item-1')).toBe(true)
    // Repeats of the same block get distinct keys — they're different flat positions.
    expect(new Set(flat.map((s) => s.key)).size).toBe(3)
  })

  it('produces a placeholder for a song item with an empty arrangement', () => {
    const song = makeSong()
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat).toHaveLength(1)
    expect(flat[0].subLabel).toBe('(empty arrangement)')
  })

  it('falls back gracefully when the referenced song cannot be resolved', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'missing-song', arrangement: { sequence: ['v1'] } }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0].itemLabel).toBe('Unknown Song')
    expect(flat[0].subLabel).toBe('v1') // falls back to the raw block id as the label
    expect(flat[0].text).toBe('')
  })

  it('expands a text-slide item into one flat slide per slide', () => {
    const service = makeService({
      items: [
        {
          id: 'item-1',
          type: 'text-slide',
          slides: [
            { id: 'a', label: 'Sermon Point 1', text: 'Point one text' },
            { id: 'b', label: 'Sermon Point 2', text: 'Point two text' },
          ],
        },
      ],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(2)
    expect(flat[0]).toMatchObject({ itemLabel: 'Text Slide', subLabel: 'Sermon Point 1', text: 'Point one text' })
  })

  it('treats not-yet-fully-built item types as a single placeholder slide', () => {
    const service = makeService({
      items: [
        { id: 'item-1', type: 'scripture', reference: 'John 3:16', translation: 'ESV', displayMode: 'full' },
        { id: 'item-2', type: 'video', mediaId: 'media-1' },
      ],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(2)
    expect(flat[0].itemLabel).toBe('Scripture: John 3:16')
    expect(flat[1].itemLabel).toBe('Video')
  })

  it('preserves item order across mixed item types', () => {
    const song = makeSong()
    const service = makeService({
      items: [
        { id: 'item-1', type: 'text-slide', slides: [{ id: 'w', label: 'Welcome', text: 'Hi!' }] },
        { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } },
        { id: 'item-3', type: 'scripture', reference: 'John 3:16', translation: 'ESV', displayMode: 'full' },
      ],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat.map((s) => s.itemIndex)).toEqual([0, 1, 2])
    expect(flat.map((s) => s.itemLabel)).toEqual(['Text Slide', 'Amazing Grace', 'Scripture: John 3:16'])
  })

  it('returns an empty array for a service with no items', () => {
    expect(flattenService(makeService(), new Map())).toEqual([])
  })
})
