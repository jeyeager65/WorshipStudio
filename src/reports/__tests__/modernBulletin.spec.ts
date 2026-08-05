import { describe, expect, it } from 'vitest'
import { renderModernBulletin } from '@/reports/modernBulletin'
import type { OrderOfWorshipDoc } from '@/utils/orderOfWorship'
import type { BulletinPage2Doc } from '@/utils/bulletinPage2'

const branding = {
  churchName: 'Grace Church',
  primaryColor: '#315EA8',
  secondaryColor: '#B08D3F',
}

const doc: OrderOfWorshipDoc = {
  title: 'Order of Worship',
  dateLine: 'Sunday, August 2, 2026 · Morning Worship',
  lines: [
    {
      role: 'Scriptural Call to Worship:',
      text: 'Psalm 100',
      kind: 'scripture',
      separatorBefore: false,
    },
    { text: 'Amazing Grace', kind: 'song', separatorBefore: true },
    { text: 'Doxology', kind: 'song', separatorBefore: false },
    {
      role: 'Prayer of Praise:',
      text: '',
      person: 'James',
      kind: 'bulletin-note',
      separatorBefore: true,
    },
    {
      role: 'Silent Reflection',
      text: '',
      note: '(a quiet moment)',
      kind: 'bulletin-note',
      separatorBefore: true,
    },
    {
      role: 'Worship Through the Word:',
      text: 'Matthew 5:1-5',
      person: 'Pastor Dan',
      kind: 'sermon',
      separatorBefore: true,
    },
    { role: 'Something Unmapped:', text: 'A line with no matching keyword', separatorBefore: true },
  ],
  footer: { title: 'Heart Preparation', text: 'Be still and know.' },
}

const page2: BulletinPage2Doc = {
  title: 'Announcements',
  upcoming: [{ dateLabel: 'Aug 9', text: 'Church picnic' }],
  general: [{ text: 'Nursery volunteers needed' }],
  servingSchedule: {
    headers: ['Role', 'This Week', 'Next Week'],
    rows: [
      { role: 'Nursery', thisWeek: ['Alex', 'Jamie'], nextWeek: ['TBD'] },
      { role: 'Greeters', thisWeek: ['TBD'], nextWeek: ['TBD'] },
    ],
  },
  footer: { title: 'Thought to Ponder', text: 'Grace upon grace.' },
}

describe('renderModernBulletin', () => {
  it('renders a genuine single-page PDF with no page2 or footer', async () => {
    const bytes = await renderModernBulletin(
      { title: doc.title, dateLine: doc.dateLine, lines: doc.lines },
      undefined,
      branding,
    )
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('renders every icon-matching branch (scripture, song grouping, sermon, unmapped) without throwing', async () => {
    const bytes = await renderModernBulletin(doc, undefined, branding)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('renders a second page with announcements, serving schedule, and both footers', async () => {
    const bytes = await renderModernBulletin(doc, page2, branding)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
