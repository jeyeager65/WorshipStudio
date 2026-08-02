import { describe, expect, it } from 'vitest'
import type { Person } from '@/models/library'
import { isElder, personDisplayName, personFormalName } from '@/models/library'

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1',
    firstName: 'Daniel',
    lastName: 'Renno',
    preferredRoles: [],
    unavailableDateRanges: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('person names', () => {
  it('uses the preferred name in ordinary contexts', () => {
    expect(personDisplayName(person({ preferredName: 'Dan', title: 'Pastor' }))).toBe('Dan Renno')
  })

  it('includes the title only in formal contexts', () => {
    expect(personFormalName(person({ preferredName: 'Dan', title: 'Pastor' }))).toBe(
      'Pastor Dan Renno',
    )
  })

  it('treats pastors and elders as elders without adding a separate pastor filter', () => {
    expect(isElder(person({ title: 'ELDER' }))).toBe(true)
    expect(isElder(person({ title: 'pastor' }))).toBe(true)
    expect(isElder(person({ title: 'Dr.' }))).toBe(false)
  })
})
