import { describe, expect, it } from 'vitest'
import { buildOrderOfWorship, toHtml, toPlainText } from '@/utils/orderOfWorship'
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
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
  },
]

const slides: SlideLibraryItem[] = [
  {
    id: 'slide-1',
    label: 'Welcome and Announcements',
    slides: [],
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
  },
]

function baseService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    date: '2026-07-26',
    type: 'Sunday Morning Worship',
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
    expect(doc.lines).toEqual([{ text: 'Come Behold the Wondrous Mystery 184', person: undefined }])
  })

  it('renders a scripture line with its reference and person', () => {
    const service = baseService({
      items: [
        {
          id: 'item-1',
          type: 'scripture',
          reference: 'Matthew 25:1-30',
          translation: 'ESV',
          displayMode: 'full',
          person: 'David Hamilton',
        },
      ],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines).toEqual([{ role: 'Scripture Reading:', text: 'Matthew 25:1-30', person: 'David Hamilton' }])
  })

  it("uses a referenced slide's own label as the line", () => {
    const service = baseService({
      items: [{ id: 'item-1', type: 'slide-ref', slideId: 'slide-1', person: 'Elder Rob Varano' }],
    })
    const doc = buildOrderOfWorship(service, songs, slides, new Map())
    expect(doc.lines[0]).toMatchObject({ role: 'Welcome and Announcements', person: 'Elder Rob Varano' })
  })

  it('builds the volunteer line from the roster, marking tentative assignments', () => {
    const service = baseService({
      volunteerRoster: [
        { role: 'Piano', volunteerId: 'v-1', tentative: false },
        { role: 'Guitar', volunteerId: 'v-2', tentative: true },
      ],
    })
    const names = new Map([
      ['v-1', 'Marlene'],
      ['v-2', 'Jason'],
    ])
    const doc = buildOrderOfWorship(service, songs, slides, names)
    expect(doc.volunteerLine).toBe('Piano — Marlene, Guitar — Jason?')
  })

  it('leaves volunteerLine undefined when there is no roster', () => {
    const doc = buildOrderOfWorship(baseService(), songs, slides, new Map())
    expect(doc.volunteerLine).toBeUndefined()
  })

  it('includes the service date and type in the date line', () => {
    const doc = buildOrderOfWorship(baseService(), songs, slides, new Map())
    expect(doc.dateLine).toContain('2026')
    expect(doc.dateLine).toContain('Sunday Morning Worship')
  })
})

describe('toPlainText', () => {
  it('formats a role, text, and person on one line', () => {
    const text = toPlainText({
      title: 'Order of Worship',
      dateLine: 'Sunday, July 26, 2026 · Sunday Morning Worship',
      lines: [{ role: 'Scripture Reading:', text: 'Matthew 25:1-30', person: 'David Hamilton' }],
    })
    expect(text).toContain('Scripture Reading: Matthew 25:1-30 — David Hamilton')
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
})
