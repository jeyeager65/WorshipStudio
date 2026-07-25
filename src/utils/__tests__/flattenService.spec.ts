import { describe, expect, it } from 'vitest'
import { flattenService } from '@/utils/flattenService'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'
import type { ScripturePassage } from '@/adapters/types'

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
      items: [{ id: 'item-1', type: 'video', mediaId: 'media-1' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0].itemLabel).toBe('Video')
  })

  it('falls back gracefully when a slide-ref cannot be resolved', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'missing-slide' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Unknown Slide', subLabel: '', text: '' })
  })

  it('preserves item order across mixed item types', () => {
    const song = makeSong()
    const service = makeService({
      items: [
        { id: 'item-1', type: 'text-slide', slides: [{ id: 'w', label: 'Welcome', text: 'Hi!' }] },
        { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } },
        { id: 'item-3', type: 'scripture', reference: 'John 3:16', translation: 'KJV', displayMode: 'full' },
      ],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat.map((s) => s.itemIndex)).toEqual([0, 1, 2])
    expect(flat.map((s) => s.itemLabel)).toEqual(['Text Slide', 'Amazing Grace', 'John 3:16'])
  })

  it('returns an empty array for a service with no items', () => {
    expect(flattenService(makeService(), new Map())).toEqual([])
  })
})

describe('flattenService — scripture', () => {
  function makePassage(overrides: Partial<ScripturePassage> = {}): ScripturePassage {
    return {
      reference: 'John 3:16-17',
      translation: 'KJV',
      verses: [
        { number: 16, text: 'For God so loved the world...' },
        { number: 17, text: 'For God sent not his Son...' },
      ],
      ...overrides,
    }
  }

  it('falls back to the raw reference as a placeholder before the passage resolves', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'full' }],
    })
    const flat = flattenService(service, new Map(), new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'John 3:16-17', text: '' })
  })

  it('renders resolved verse text with verse numbers on a single slide', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'full' }],
    })
    const flat = flattenService(service, new Map(), new Map([['item-1', makePassage()]]))
    expect(flat).toHaveLength(1)
    expect(flat[0].itemLabel).toBe('John 3:16-17')
    expect(flat[0].subLabel).toBe('KJV')
    expect(flat[0].text).toBe('16 For God so loved the world...\n17 For God sent not his Son...')
  })

  it('shows no verse text in reference-only mode, even if a passage happens to be resolved', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'reference-only' }],
    })
    const flat = flattenService(service, new Map(), new Map([['item-1', makePassage()]]))
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'John 3:16-17', subLabel: 'Reference Only', text: '' })
  })
})

describe('flattenService — slide-ref', () => {
  function makeSlideItem(overrides: Partial<SlideLibraryItem> = {}): SlideLibraryItem {
    return {
      id: 'slide-1',
      label: 'Announcements',
      slides: [
        { id: 'a', label: 'Slide 1', text: 'Welcome!' },
        { id: 'b', label: 'Slide 2', text: 'Potluck this Friday' },
      ],
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
      ...overrides,
    }
  }

  it('expands a slide-ref into one flat slide per slide in the referenced library item', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'slide-1' }],
    })
    const flat = flattenService(service, new Map(), new Map(), new Map([['slide-1', makeSlideItem()]]))
    expect(flat).toHaveLength(2)
    expect(flat.every((s) => s.itemLabel === 'Announcements')).toBe(true)
    expect(flat.map((s) => s.subLabel)).toEqual(['Slide 1', 'Slide 2'])
    expect(flat[1].text).toBe('Potluck this Friday')
  })

  it('produces a placeholder for a referenced item with no slides', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'slide-1' }],
    })
    const flat = flattenService(service, new Map(), new Map(), new Map([['slide-1', makeSlideItem({ slides: [] })]]))
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Announcements', subLabel: '(empty)' })
  })
})
