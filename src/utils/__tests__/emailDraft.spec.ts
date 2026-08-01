import { describe, expect, it } from 'vitest'
import {
  assignmentEmailRosterLines,
  emailDraftText,
  mailtoUrl,
  uniqueEmailAddresses,
} from '@/utils/emailDraft'

describe('email draft helpers', () => {
  it('creates a mailto draft with encoded To recipients, subject, and message', () => {
    const url = mailtoUrl({
      to: ['one@example.com', 'two@example.com'],
      subject: 'Assignments — August 2',
      body: 'Hello,\n\nPiano: Jordan Lee',
    })

    expect(url).toContain('mailto:one%40example.com,two%40example.com?')
    expect(url).toContain('subject=Assignments%20%E2%80%94%20August%202')
    expect(url).toContain('body=Hello%2C%0A%0APiano%3A%20Jordan%20Lee')
  })

  it('copies all fields needed to recreate the draft manually', () => {
    expect(
      emailDraftText({
        to: ['one@example.com'],
        subject: 'Sunday Assignments',
        body: 'Here is the roster.',
      }),
    ).toBe('To: one@example.com\nSubject: Sunday Assignments\n\nHere is the roster.')
  })

  it('normalizes empty and duplicate addresses without changing display casing', () => {
    expect(
      uniqueEmailAddresses([' Jordan@example.com ', 'jordan@example.com', undefined, '']),
    ).toEqual(['Jordan@example.com'])
  })

  it('groups assignment lines by category and then role', () => {
    expect(
      assignmentEmailRosterLines(
        [
          { name: 'Worship Team', roles: ['Vocals', 'Piano'] },
          { name: 'Production', roles: ['Sound'] },
        ],
        [
          { role: 'Vocals', personName: 'Alex Morgan' },
          { role: 'Vocals', personName: 'Jordan Lee', tentative: true },
          { role: 'Piano' },
          { role: 'Sound', personName: 'Sam Taylor' },
        ],
      ),
    ).toEqual([
      'Worship Team',
      '• Vocals: Alex Morgan, Jordan Lee (tentative)',
      '• Piano: (unassigned)',
      '',
      'Production',
      '• Sound: Sam Taylor',
    ])
  })
})
