import { describe, expect, it } from 'vitest'
import { flattenService } from '@/utils/flattenService'
import { OLD_TESTAMENT_FRACTION } from '@/utils/scriptureReference'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'
import type { ScripturePassage } from '@/adapters/types'
import { createBlankScene, createTextElement } from '@/utils/slideScene'

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
    // The non-repeated block (Verse 1) gets no repeat label; the twice-used Chorus is
    // numbered "1/2" then "2/2" in the order it actually appears.
    expect(flat.map((s) => s.repeatLabel)).toEqual([undefined, '1/2', '2/2'])
  })

  it('numbers repeats per back-to-back run, not by total appearances in the arrangement', () => {
    // V1, C, V2, C, C, V3, C, C — 5 Choruses overall, but only the two *consecutive* pairs are
    // numbered, independently of each other; the two lone (non-repeated-in-place) Choruses get
    // no label at all, same as any other non-repeated block.
    const song = makeSong({
      blocks: [
        { id: 'v1', label: 'Verse 1', text: '' },
        { id: 'v2', label: 'Verse 2', text: '' },
        { id: 'v3', label: 'Verse 3', text: '' },
        { id: 'c', label: 'Chorus', text: '' },
      ],
    })
    const service = makeService({
      items: [
        {
          id: 'item-1',
          type: 'song',
          songId: 'song-1',
          arrangement: { sequence: ['v1', 'c', 'v2', 'c', 'c', 'v3', 'c', 'c'] },
        },
      ],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat.map((s) => s.subLabel)).toEqual([
      'Verse 1',
      'Chorus',
      'Verse 2',
      'Chorus',
      'Chorus',
      'Verse 3',
      'Chorus',
      'Chorus',
    ])
    expect(flat.map((s) => s.repeatLabel)).toEqual([
      undefined,
      undefined,
      undefined,
      '1/2',
      '2/2',
      undefined,
      '1/2',
      '2/2',
    ])
  })

  it("shows the song's first collection citation as the footer instead of the block label", () => {
    const song = makeSong({
      collections: [
        { collectionId: 'Hymns of Grace', number: '123' },
        { collectionId: 'Second Book', number: '9' },
      ],
    })
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } }],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat[0].footerText).toBe('Hymns of Grace #123')
  })

  it('omits the collection number when the entry has none, and returns an empty footer when there are no collections', () => {
    const withoutNumber = flattenService(
      makeService({
        items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } }],
      }),
      new Map([['song-1', makeSong({ collections: [{ collectionId: 'Hymns of Grace' }] })]]),
    )
    expect(withoutNumber[0].footerText).toBe('Hymns of Grace')

    const withoutCollections = flattenService(
      makeService({
        items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } }],
      }),
      new Map([['song-1', makeSong({ collections: [] })]]),
    )
    expect(withoutCollections[0].footerText).toBe('')
  })

  it('applies the configured song font range to every block', () => {
    const song = makeSong()
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1', 'c'] } }],
    })
    const flat = flattenService(service, new Map([['song-1', song]]), new Map(), new Map(), new Map(), undefined, {
      minPx: 20,
      maxPx: 60,
    })
    expect(flat.every((s) => s.fontRange?.maxPx === 60 && s.fontRange?.minPx === 20)).toBe(true)
    // Song lines shouldn't wrap unless necessary, and should never break at a plain word
    // boundary when they do — only at a comma/semicolon (see PresentationView's use of lineWrap).
    expect(flat.every((s) => s.lineWrap === true)).toBe(true)
  })

  it('never splits a song block across multiple slides, however long its text', () => {
    const longSong = makeSong({
      blocks: [{ id: 'v1', label: 'Verse 1', text: Array.from({ length: 50 }, (_, i) => `Line ${i + 1} of the song.`).join('\n') }],
    })
    const service = makeService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } }],
    })
    const flat = flattenService(service, new Map([['song-1', longSong]]))
    expect(flat).toHaveLength(1)
    expect(flat[0].text).toBe(longSong.blocks[0].text)
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
      items: [{ id: 'item-1', type: 'audio', mediaId: 'media-1' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0].itemLabel).toBe('Audio')
    expect(flat[0].mediaId).toBeUndefined()
  })

  it('carries a media item through with its fit choice for the caller to resolve', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'media', mediaId: 'media-1', fit: 'contain' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Media', mediaId: 'media-1', mediaKind: 'image', mediaFit: 'contain' })
  })

  it('carries a video item through, defaulting to a Contain fit', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'video', mediaId: 'media-1' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Video', mediaId: 'media-1', mediaKind: 'video', mediaFit: 'contain' })
  })

  it('carries an external-app item through with its profile name and chosen file', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'external-app', profileId: 'profile-1', file: 'C:\\Services\\slides.pptx' }],
    })
    const profiles = new Map([
      [
        'profile-1',
        {
          id: 'profile-1',
          name: 'PowerPoint',
          launchMode: 'launch-automatically' as const,
          remoteControlsEnabled: false,
          updatedAt: '',
          updatedByDevice: '',
        },
      ],
    ])
    const flat = flattenService(service, new Map(), new Map(), new Map(), profiles)
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({
      itemLabel: 'PowerPoint',
      externalApp: { profileId: 'profile-1', file: 'C:\\Services\\slides.pptx' },
    })
  })

  it('falls back to a generic label for an external-app item whose profile no longer exists', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'external-app', profileId: 'missing-profile' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat[0]).toMatchObject({ itemLabel: 'External App', externalApp: { profileId: 'missing-profile' } })
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
    expect(flat[0].text).toBe('16 For God so loved the world... 17 For God sent not his Son...')
  })

  it('applies the configured font range to a resolved full-text scripture slide', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'full' }],
    })
    const flat = flattenService(service, new Map(), new Map([['item-1', makePassage()]]), new Map(), new Map(), {
      minPx: 30,
      maxPx: 60,
    })
    expect(flat[0].fontRange).toEqual({ minPx: 30, maxPx: 60 })
  })

  it('splits a passage that does not fit at the minimum size into multiple slides at verse boundaries', () => {
    const longVerses = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      text: 'This is a reasonably long verse of scripture text meant to force pagination across several slides.',
    }))
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'Psalm 119:1-30', translation: 'KJV', displayMode: 'full' }],
    })
    const flat = flattenService(
      service,
      new Map(),
      new Map([['item-1', makePassage({ verses: longVerses })]]),
      new Map(),
      new Map(),
      { minPx: 28, maxPx: 72 },
    )
    expect(flat.length).toBeGreaterThan(1)
    // Every slide's key is distinct, sub-labels show progress, and every verse number appears
    // exactly once across the whole run (no verse dropped, none duplicated, none split).
    expect(new Set(flat.map((s) => s.key)).size).toBe(flat.length)
    expect(flat.every((s) => /\(\d+\/\d+\)$/.test(s.subLabel))).toBe(true)
    const allNumbers = flat.flatMap((s) => [...s.text.matchAll(/(?:^|\s)(\d+)\s/g)].map((m) => Number(m[1])))
    expect(allNumbers).toEqual(longVerses.map((v) => v.number))
  })

  it('shows no verse text in reference-only mode, even if a passage happens to be resolved', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'reference-only' }],
    })
    const flat = flattenService(service, new Map(), new Map([['item-1', makePassage()]]))
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'John 3:16-17', subLabel: 'Reference Only', text: '' })
  })

  it('includes the surrounding-books wayfinding list in reference-only mode', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'reference-only' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat[0]?.wayfindingBooks?.map((b) => [b.name, b.distance])).toEqual([
      ['Mark', -2],
      ['Luke', -1],
      ['John', 0],
      ['Acts', 1],
      ['Romans', 2],
    ])
  })

  it('omits the wayfinding list in full-text mode', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'full' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat[0]?.wayfindingBooks).toBeUndefined()
  })

  it('gives a New Testament reference-only passage a bibleProgress past the Old Testament fraction', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'John 3:16-17', translation: 'KJV', displayMode: 'reference-only' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat[0]?.bibleProgress).toBeGreaterThan(OLD_TESTAMENT_FRACTION)
  })

  it('gives an Old Testament reference-only passage a bibleProgress before the Old Testament fraction', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'scripture', reference: 'Psalm 23', translation: 'KJV', displayMode: 'reference-only' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat[0]?.bibleProgress).toBeLessThan(OLD_TESTAMENT_FRACTION)
  })
})

describe('flattenService — slide-ref', () => {
  function makeSlideItem(overrides: Partial<SlideLibraryItem> = {}): SlideLibraryItem {
    return {
      id: 'slide-1',
      label: 'Announcements',
      tags: [],
      documentVersion: 2,
      slides: [
        { id: 'a', label: 'Slide 1', scene: { ...createBlankScene(), elements: [createTextElement('Welcome!')] }, source: { type: 'native' } },
        { id: 'b', label: 'Slide 2', scene: { ...createBlankScene(), elements: [createTextElement('Potluck this Friday')] }, source: { type: 'native' } },
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

  it("carries the service's own date/time through for a Countdown scene element in 'service' mode", () => {
    const service = makeService({
      date: '2026-08-02',
      time: '10:30',
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'slide-1' }],
    })
    const flat = flattenService(service, new Map(), new Map(), new Map([['slide-1', makeSlideItem()]]))
    expect(flat[0].serviceDateTime).toBeDefined()
    expect(new Date(flat[0].serviceDateTime!).getHours()).toBe(10)
    expect(new Date(flat[0].serviceDateTime!).getMinutes()).toBe(30)
  })

  it('omits serviceDateTime when the service has no start time set', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'slide-1' }],
    })
    const flat = flattenService(service, new Map(), new Map(), new Map([['slide-1', makeSlideItem()]]))
    expect(flat[0].serviceDateTime).toBeUndefined()
  })
})

describe('flattenService — bulletin-note', () => {
  it('produces no slides at all — the one deliberate exception to every item getting at least one', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'bulletin-note', bulletinLabel: 'Silent Preparation' }],
    })
    expect(flattenService(service, new Map())).toEqual([])
  })

  it('is skipped in place, leaving surrounding items unaffected', () => {
    const song = makeSong()
    const service = makeService({
      items: [
        { id: 'item-1', type: 'bulletin-note', bulletinLabel: 'Silent Preparation' },
        { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: ['v1'] } },
      ],
    })
    const flat = flattenService(service, new Map([['song-1', song]]))
    expect(flat).toHaveLength(1)
    expect(flat[0].itemId).toBe('item-2')
  })
})

describe('flattenService — sermon', () => {
  function makePassage(overrides: Partial<ScripturePassage> = {}): ScripturePassage {
    return {
      reference: 'Mark 5:1-20',
      translation: 'ESV',
      verses: [{ number: 1, text: 'They came to the other side...' }],
      ...overrides,
    }
  }

  it('presents the main passage first, then the legacy supporting passages and outline', () => {
    const service = makeService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          passages: [
            { id: 'p1', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'reference-only' },
            { id: 'p2', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p2',
          outline: [
            { id: 'o1', label: 'The Setup', text: 'Point one' },
            { id: 'o2', label: 'The Turn', text: 'Point two' },
          ],
        },
      ],
    })
    const scriptureById = new Map([['item-1:p2', makePassage()]])
    const flat = flattenService(service, new Map(), scriptureById)

    expect(flat).toHaveLength(4)
    expect(flat.map((s) => s.itemLabel)).toEqual(['Mark 5:1-20', 'Romans 8:28', 'Sermon Outline', 'Sermon Outline'])
    expect(flat.map((s) => s.subLabel)).toEqual(['ESV', 'Reference Only', 'The Setup', 'The Turn'])
    expect(flat[3].text).toBe('Point two')
    expect(new Set(flat.map((s) => s.key)).size).toBe(4)
    // Content-addressed keys (by the passage's/block's own id, not cumulative position) — see
    // the "keeps a passage's key stable" test below for the regression this guards against.
    expect(flat.map((s) => s.key)).toEqual([
      'item-1:passage:p2:0',
      'item-1:passage:p1:0',
      'item-1:outline:o1',
      'item-1:outline:o2',
    ])
  })

  it('interleaves supporting scripture and outline points in sermon flow order', () => {
    const service = makeService({
      items: [{
        id: 'item-1',
        type: 'sermon',
        passages: [
          { id: 'main', reference: 'John 1:1-4', translation: 'ESV', displayMode: 'reference-only' },
          { id: 'support', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'reference-only' },
        ],
        mainPassageId: 'main',
        outline: [{ id: 'point', label: 'God is faithful', text: '' }],
        flow: [
          { type: 'outline', outlineId: 'point' },
          { type: 'passage', passageId: 'support' },
        ],
      }],
    })

    const flat = flattenService(service, new Map())
    expect(flat.map((slide) => slide.key)).toEqual([
      'item-1:passage:main:0',
      'item-1:outline:point',
      'item-1:passage:support:0',
    ])
  })

  it('keeps supporting scripture in flow order when the sermon has no main passage', () => {
    const service = makeService({
      items: [{
        id: 'item-1',
        type: 'sermon',
        passages: [
          { id: 'support', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'reference-only' },
        ],
        mainPassageId: '',
        outline: [{ id: 'point', label: 'God is faithful', text: '' }],
        flow: [
          { type: 'outline', outlineId: 'point' },
          { type: 'passage', passageId: 'support' },
        ],
      }],
    })

    const flat = flattenService(service, new Map())
    expect(flat.map((slide) => slide.key)).toEqual([
      'item-1:outline:point',
      'item-1:passage:support:0',
    ])
  })

  it("carries an outline block's title separately from its details, and suppresses the footer", () => {
    const service = makeService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          passages: [],
          mainPassageId: '',
          outline: [
            { id: 'o1', label: 'The Setup', text: 'Point one' },
            { id: 'o2', label: 'The Turn', text: '' },
          ],
        },
      ],
    })
    const flat = flattenService(service, new Map())
    // outlineTitle drives the large title in the main slide area (see
    // SlideContentRenderer.vue) — the label as typed, with no auto-numbering prepended;
    // footerText is explicitly '' so the title never also shows in the footer via a subLabel
    // fallback.
    expect(flat[0]).toMatchObject({ outlineTitle: 'The Setup', text: 'Point one', footerText: '' })
    expect(flat[1]).toMatchObject({ outlineTitle: 'The Turn', text: '', footerText: '' })
  })

  it("keeps a passage's key stable when another passage is added, so a live slide can never silently reassign to unrelated content", () => {
    const before = flattenService(
      makeService({
        items: [
          {
            id: 'item-1',
            type: 'sermon',
            passages: [{ id: 'p1', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'reference-only' }],
            mainPassageId: 'p1',
            outline: [{ id: 'o1', label: 'The Setup', text: 'Point one' }],
          },
        ],
      }),
      new Map(),
    )
    const p1KeyBefore = before.find((s) => s.itemLabel === 'Romans 8:28')!.key
    const outlineKeyBefore = before.find((s) => s.itemLabel === 'Sermon Outline')!.key

    // Adding a brand-new second passage must not change either existing slide's key — the bug
    // this guards against: a cumulative position-based key shifted every later passage/outline
    // by one slot, so the newly-added (unrelated, still-empty) passage silently inherited
    // whatever key used to point at the previously-live slide.
    const after = flattenService(
      makeService({
        items: [
          {
            id: 'item-1',
            type: 'sermon',
            passages: [
              { id: 'p1', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'reference-only' },
              { id: 'p2', reference: '', translation: 'ESV', displayMode: 'full' },
            ],
            mainPassageId: 'p1',
            outline: [{ id: 'o1', label: 'The Setup', text: 'Point one' }],
          },
        ],
      }),
      new Map(),
    )
    expect(after.find((s) => s.itemLabel === 'Romans 8:28')!.key).toBe(p1KeyBefore)
    expect(after.find((s) => s.itemLabel === 'Sermon Outline')!.key).toBe(outlineKeyBefore)
    // And the new passage must not reuse either of those pre-existing keys.
    const p2Key = after.find((s) => s.passageId === 'p2')!.key
    expect(p2Key).not.toBe(p1KeyBefore)
    expect(p2Key).not.toBe(outlineKeyBefore)
  })

  it("passage slides use the 'scripture' theme target, but outline slides use 'sermon'", () => {
    const service = makeService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          passages: [{ id: 'p1', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' }],
          mainPassageId: 'p1',
          outline: [{ id: 'o1', label: 'The Setup', text: 'Point one' }],
        },
      ],
    })
    const scriptureById = new Map([['item-1:p1', makePassage()]])
    const flat = flattenService(service, new Map(), scriptureById)
    expect(flat.map((s) => s.themeTarget)).toEqual(['scripture', 'sermon'])
  })

  it('produces a placeholder when a sermon has neither passages nor outline yet', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'sermon', passages: [], mainPassageId: '', outline: [] }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Sermon', subLabel: '(empty)' })
  })
})

describe('flattenService — placeholder (unreplaced service template slot)', () => {
  it('produces an obviously-unfilled slide using the placeholder label', () => {
    const service = makeService({
      items: [{ id: 'item-1', type: 'placeholder', label: 'Opening Song' }],
    })
    const flat = flattenService(service, new Map())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ itemLabel: 'Opening Song', subLabel: '(placeholder — not yet filled in)', text: '' })
  })
})
