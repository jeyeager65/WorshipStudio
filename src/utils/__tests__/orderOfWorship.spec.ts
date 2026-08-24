import { describe, expect, it } from 'vitest'
import { buildOrderOfWorship, toDocxBlob, toHtml, toPlainText } from '@/utils/orderOfWorship'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'

const songs: Song[] = [
  {
    id: 'song-1',
    title: 'Come Behold the Wondrous Mystery',
    collections: [{ collectionId: 'hymnal', number: '184' }],
    tags: [],
    blocks: [],
    defaultArrangement: { sequence: [] },
    usageDates: [],
    updatedAt: '',
    updatedByDevice: '',
  },
  {
    id: 'song-2',
    title: 'It Is Well',
    collections: [],
    tags: [],
    blocks: [],
    defaultArrangement: { sequence: [] },
    usageDates: [],
    updatedAt: '',
    updatedByDevice: '',
  },
]

const slides: SlideLibraryItem[] = [
  {
    id: 'slide-1',
    label: 'Welcome and Announcements',
    tags: [],
    documentVersion: 2,
    slides: [],
    usage: {},
    updatedAt: '',
    updatedByDevice: '',
  },
]

function baseService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    date: '2026-07-26',
    serviceTypeId: 'type-sunday-morning-worship',
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('buildOrderOfWorship', () => {
  it('renders a song line with its collection number', () => {
    const service = baseService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toMatchObject([
      { text: 'Come Behold the Wondrous Mystery 184', person: undefined },
    ])
  })

  it('prefixes a bulletin song number with its optional collection abbreviation', () => {
    const service = baseService({
      items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map(), new Map(), undefined, [
      { id: 'hymnal', name: 'hymnal', abbreviation: 'WH' },
    ])
    expect(doc.lines[0]?.text).toBe('Come Behold the Wondrous Mystery WH 184')
  })

  it("resolves an item's person via its role's Assignments entry, not a direct id", () => {
    const service = baseService({
      assignments: [{ roleId: 'Scripture Reader', personId: 'person-jordan', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'Matthew 25:1-30',
          translation: 'ESV',
          displayMode: 'full',
          roleId: 'Scripture Reader',
        },
      ],
    })
    const doc = buildOrderOfWorship(
      service,
      songs,
      slides,
      new Map([['person-jordan', 'Jordan Example']]),
    )
    expect(doc.lines).toMatchObject([
      { role: 'Scripture Reading:', text: 'Matthew 25:1-30', person: 'Jordan Example' },
    ])
  })

  it('uses formal names for every assigned bulletin participant, not only the preacher', () => {
    const service = baseService({
      assignments: [{ roleId: 'Scripture Reader', personId: 'person-jordan', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'Matthew 25:1-30',
          translation: 'ESV',
          displayMode: 'full',
          roleId: 'Scripture Reader',
        },
      ],
    })
    const doc = buildOrderOfWorship(
      service,
      songs,
      slides,
      new Map([['person-jordan', 'Jordan Example']]),
      new Map([['person-jordan', 'Elder Jordan Example']]),
    )
    expect(doc.lines[0]?.person).toBe('Elder Jordan Example')
  })

  it('shows no one when a role has no matching (or no) Assignments entry', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'Matthew 25:1-30',
          translation: 'ESV',
          displayMode: 'full',
          roleId: 'Scripture Reader',
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]?.person).toBeUndefined()
  })

  it('excludes a slide item with no bulletinLabel rather than printing its on-screen label/text', () => {
    const service = baseService({
      items: [
        { id: 'item-1', type: 'slide-ref', slideId: 'slide-1' },
        { id: 'item-2', type: 'text-slide', slides: [{ id: 's1', label: 'Welcome', text: 'Hi!' }] },
        { id: 'item-3', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0]?.text).toContain('Come Behold the Wondrous Mystery')
  })

  it('includes a slide item once it has a bulletinLabel, using that label rather than the slide’s own', () => {
    const service = baseService({
      assignments: [{ roleId: 'Announcer', personId: 'person-rob', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'slide-ref',
          slideId: 'slide-1',
          roleId: 'Announcer',
          bulletinLabel: 'Welcome and Announcements',
        },
        {
          id: 'item-2',
          type: 'text-slide',
          slides: [{ id: 's1', label: 'Welcome', text: 'Hi!' }],
          bulletinLabel: 'Silent Preparation',
        },
      ],
    })
    const doc = buildOrderOfWorship(
      service,
      songs,
      slides,
      new Map([['person-rob', 'Elder Rob Delgado']]),
    )
    expect(doc.lines).toMatchObject([
      { role: 'Welcome and Announcements', text: '', person: 'Elder Rob Delgado' },
      { role: 'Silent Preparation', text: '' },
    ])
  })

  it('includes the service date but not the service type in the date line', () => {
    const doc = buildOrderOfWorship(baseService(), songs, slides, new Map())
    expect(doc.dateLine).toContain('2026')
    expect(doc.dateLine).not.toContain('Sunday Morning Worship')
  })

  it('excludes an external-app item with no bulletinLabel rather than printing a "[External App]" placeholder', () => {
    const service = baseService({
      items: [
        { id: 'item-1', type: 'external-app', profileId: 'profile-1' },
        { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0]?.text).toContain('Come Behold the Wondrous Mystery')
  })

  it('includes an external-app item once it has a bulletinLabel, with the label as the line and no placeholder text', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'external-app',
          profileId: 'profile-1',
          bulletinLabel: 'PowerPoint: Missions Update',
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toMatchObject([{ role: 'PowerPoint: Missions Update', text: '' }])
  })

  it('excludes a media/video item with no bulletinLabel rather than printing a "[Media]"/"[Video]" placeholder', () => {
    const service = baseService({
      items: [
        { id: 'item-1', type: 'media', mediaId: 'media-1', fit: 'cover' },
        { id: 'item-2', type: 'video', mediaId: 'media-2' },
        { id: 'item-3', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0]?.text).toContain('Come Behold the Wondrous Mystery')
  })

  it('includes a media/video item once it has a bulletinLabel, with the label as the line and no placeholder text', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'media',
          mediaId: 'media-1',
          fit: 'cover',
          bulletinLabel: 'Offering Video',
        },
        { id: 'item-2', type: 'video', mediaId: 'media-2', bulletinLabel: 'Baptism Video' },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toMatchObject([
      { role: 'Offering Video', text: '' },
      { role: 'Baptism Video', text: '' },
    ])
  })

  it('defaults to "Order of Worship" when no bulletin title is configured, and honors one when it is', () => {
    const withoutSettings = buildOrderOfWorship(baseService(), songs, slides, new Map())
    expect(withoutSettings.title).toBe('Order of Worship')

    const withSettings = buildOrderOfWorship(baseService(), songs, slides, new Map(), new Map(), {
      title: 'Liturgy',
      footer: { enabled: true, title: 'Heart Preparation' },
    })
    expect(withSettings.title).toBe('Liturgy')
  })

  it('includes the footer only when enabled and the service has text for it', () => {
    const withFooter = buildOrderOfWorship(
      baseService({ bulletinPage1Footer: 'Be still and know.' }),
      songs,
      slides,
      new Map(),
      new Map(),
      {
        title: 'Order of Worship',
        footer: { enabled: true, title: 'Heart Preparation' },
      },
    )
    expect(withFooter.footer).toEqual({ title: 'Heart Preparation', text: 'Be still and know.' })

    const noText = buildOrderOfWorship(baseService(), songs, slides, new Map())
    expect(noText.footer).toBeUndefined()

    const disabled = buildOrderOfWorship(
      baseService({ bulletinPage1Footer: 'Be still and know.' }),
      songs,
      slides,
      new Map(),
      new Map(),
      {
        title: 'Order of Worship',
        footer: { enabled: false, title: 'Heart Preparation' },
      },
    )
    expect(disabled.footer).toBeUndefined()
  })

  it('bulletinLabel overrides a type’s own default heading, and bulletinNote adds a second line', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'Psalm 135:3, 5-7, 13-14; 20-21',
          translation: 'ESV',
          displayMode: 'reference-only',
          bulletinLabel: 'Scriptural Call to Worship:',
          bulletinNote: '(please stand)',
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({
      role: 'Scriptural Call to Worship:',
      text: 'Psalm 135:3, 5-7, 13-14; 20-21',
      note: '(please stand)',
    })
  })

  it('a sermon line uses the sermon title as its heading and the main passage as its note', () => {
    const service = baseService({
      assignments: [{ roleId: 'Preacher', personId: 'person-dan', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          title: 'From Chained to Commissioned',
          roleId: 'Preacher',
          passages: [
            { id: 'p1', reference: 'Romans 8:28', translation: 'ESV', displayMode: 'full' },
            { id: 'p2', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p2',
          outline: [],
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map([['person-dan', 'Pastor Dan']]))
    expect(doc.lines[0]).toMatchObject({
      role: 'From Chained to Commissioned',
      text: '',
      person: 'Pastor Dan',
      note: 'Mark 5:1-20',
    })
  })

  it('falls back to the generic "Worship Through the Word" heading when the sermon has no title', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          passages: [
            { id: 'p1', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p1',
          outline: [],
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({ role: 'Worship Through the Word', note: 'Mark 5:1-20' })
  })

  it("a sermon's own bulletinNote overrides the main passage as the note, but the title still shows as the heading", () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          title: 'From Chained to Commissioned',
          passages: [
            { id: 'p1', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p1',
          outline: [],
          bulletinNote: 'Custom note',
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({
      role: 'From Chained to Commissioned',
      note: 'Custom note',
    })
  })

  it('a sermon with both a bulletinLabel and a title uses the label as the heading and moves the title (with the main passage) to the note', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          title: 'From Chained to Commissioned',
          bulletinLabel: 'Worship Through the Word',
          passages: [
            { id: 'p1', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p1',
          outline: [],
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({
      role: 'Worship Through the Word',
      note: 'From Chained to Commissioned · Mark 5:1-20',
    })
  })

  it('a sermon with a bulletinLabel but no title still shows just the main passage as the note', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'sermon',
          bulletinLabel: 'Worship Through the Word',
          passages: [
            { id: 'p1', reference: 'Mark 5:1-20', translation: 'ESV', displayMode: 'full' },
          ],
          mainPassageId: 'p1',
          outline: [],
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({
      role: 'Worship Through the Word',
      note: 'Mark 5:1-20',
    })
  })

  it('a bulletin-note item renders its label/note/role-resolved person and never a slide-worthy text', () => {
    const service = baseService({
      assignments: [{ roleId: 'Prayer', personId: 'person-elder', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'bulletin-note',
          roleId: 'Prayer',
          bulletinLabel: 'Prayer of Praise and Confession',
          bulletinNote: '(please kneel if able)',
        },
      ],
    })
    const doc = buildOrderOfWorship(
      service,
      songs,
      slides,
      new Map([['person-elder', 'Elder Bruce Barton']]),
    )
    expect(doc.lines[0]).toMatchObject({
      role: 'Prayer of Praise and Confession',
      text: '',
      person: 'Elder Bruce Barton',
      note: '(please kneel if able)',
    })
  })

  it('a bulletin-note item with no role needs no one assigned (e.g. Silent Preparation)', () => {
    const service = baseService({
      items: [{ id: 'item-1', type: 'bulletin-note', bulletinLabel: 'Silent Preparation' }],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({
      role: 'Silent Preparation',
      text: '',
      person: undefined,
      note: undefined,
    })
  })

  it("an unreplaced placeholder shows its label, its role's resolved person, and '(to be filled in)'", () => {
    const service = baseService({
      assignments: [{ roleId: 'Scripture Reader', personId: 'person-jordan', tentative: false }],
      items: [
        {
          id: 'item-1',
          type: 'placeholder',
          label: 'Scripture Reading',
          roleId: 'Scripture Reader',
        },
      ],
    })
    const doc = buildOrderOfWorship(
      service,
      songs,
      slides,
      new Map([['person-jordan', 'Jordan Example']]),
    )
    expect(doc.lines[0]).toMatchObject({
      role: 'Scripture Reading',
      text: '(to be filled in)',
      person: 'Jordan Example',
      note: undefined,
    })
  })

  it('never separates two consecutive songs, but separates every other item boundary', () => {
    const service = baseService({
      items: [
        { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
        { id: 'item-2', type: 'song', songId: 'song-2', arrangement: { sequence: [] } },
        {
          id: 'item-3',
          type: 'scripture',
          reference: 'Matthew 25:1-30',
          translation: 'ESV',
          displayMode: 'full',
        },
        { id: 'item-4', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(
      doc.lines.map((line) => ({ kind: line.kind, separatorBefore: line.separatorBefore })),
    ).toEqual([
      { kind: 'song', separatorBefore: false }, // first line, never separated
      { kind: 'song', separatorBefore: false }, // song after song — no separator
      { kind: 'scripture', separatorBefore: true }, // song -> scripture — separated
      { kind: 'song', separatorBefore: true }, // scripture -> song — separated
    ])
  })
})
describe('toPlainText', () => {
  it('formats a role, text, and person on one line', () => {
    const text = toPlainText({
      title: 'Order of Worship',
      dateLine: 'Sunday, July 26, 2026 · Sunday Morning Worship',
      lines: [{ role: 'Scripture Reading:', text: 'Matthew 25:1-30', person: 'Jordan Example' }],
    })
    expect(text).toContain('Scripture Reading: Matthew 25:1-30 — Jordan Example')
  })

  it('renders a note on its own following line', () => {
    const text = toPlainText({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [
        {
          role: 'Worship Through the Word',
          text: 'Mark 5:1-20',
          person: 'Jordan Example',
          note: '"From Chained to Commissioned"',
        },
      ],
    })
    expect(text).toContain(
      'Worship Through the Word Mark 5:1-20 — Jordan Example\n"From Chained to Commissioned"',
    )
  })

  it('adds a blank line before a line with separatorBefore, and none otherwise', () => {
    const text = toPlainText({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [
        { kind: 'song', text: 'Song One', separatorBefore: false },
        { kind: 'song', text: 'Song Two', separatorBefore: false },
        { kind: 'scripture', text: 'Matthew 25:1-30', separatorBefore: true },
      ],
    })
    expect(text).toContain('Song One\nSong Two\n\nMatthew 25:1-30')
  })

  it('appends the footer title and text when present', () => {
    const text = toPlainText({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [{ text: 'Amazing Grace' }],
      footer: { title: 'Heart Preparation', text: 'Be still and know.' },
    })
    expect(text).toContain('Amazing Grace\n\nHeart Preparation\nBe still and know.')
  })
})

describe('toHtml', () => {
  it('escapes text content to avoid HTML injection', () => {
    const html = toHtml({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [{ text: '<script>alert(1)</script>' }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders and escapes a note', () => {
    const html = toHtml({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [{ text: 'Mark 5:1-20', note: '<b>note</b>' }],
    })
    expect(html).toContain('&lt;b&gt;note&lt;/b&gt;')
  })

  it('adds extra spacing before a separated line, but never a visible rule/line', () => {
    const html = toHtml({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [
        { kind: 'song', text: 'Song One', separatorBefore: false },
        { kind: 'song', text: 'Song Two', separatorBefore: false },
        { kind: 'scripture', text: 'Matthew 25:1-30', separatorBefore: true },
      ],
    })
    expect(html).not.toContain('<hr')
    expect(html).toContain('margin:2px 0')
    expect(html).toContain('margin:8px 0 2px 0')
  })

  it('renders and escapes the footer when present, and omits it otherwise', () => {
    const withFooter = toHtml({
      title: 'Order of Worship',
      dateLine: 'Sunday',
      lines: [],
      footer: { title: 'Heart Preparation', text: '<i>Be still</i>' },
    })
    expect(withFooter).toContain('<strong>Heart Preparation</strong>')
    expect(withFooter).toContain('&lt;i&gt;Be still&lt;/i&gt;')

    const withoutFooter = toHtml({ title: 'Order of Worship', dateLine: 'Sunday', lines: [] })
    expect(withoutFooter).not.toContain('Heart Preparation')
  })
})

describe('toDocxBlob', () => {
  it('produces a real zip-based .docx file, not an HTML-in-disguise one', async () => {
    const blob = await toDocxBlob({
      title: 'Order of Worship',
      dateLine: 'Sunday, July 26, 2026 · Sunday Morning Worship',
      lines: [
        {
          role: 'Scripture Reading:',
          text: 'Matthew 25:1-30',
          person: 'Jordan Example',
          kind: 'scripture',
          separatorBefore: false,
        },
        {
          role: 'From Chained to Commissioned',
          text: '',
          person: 'Pastor Dan',
          note: 'Mark 5:1-20',
          kind: 'sermon',
          separatorBefore: true,
        },
      ],
    })

    expect(blob.size).toBeGreaterThan(0)

    // A real .docx is a zip archive — every zip file starts with the "PK" magic bytes ("local
    // file header signature"), which plain HTML/text never does. This is what actually
    // distinguishes a genuine .docx from the old "HTML saved with a .doc extension" trick.
    const firstBytes = new Uint8Array(await blob.arrayBuffer()).slice(0, 2)
    expect(String.fromCharCode(...firstBytes)).toBe('PK')
  })
})
