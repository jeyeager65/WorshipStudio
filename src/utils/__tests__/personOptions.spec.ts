import { describe, expect, it } from 'vitest'
import { personOptionsForRole } from '@/utils/personOptions'
import type { Person } from '@/models/library'

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1',
    firstName: 'First',
    lastName: 'Last',
    preferredRoleIds: [],
    unavailableDateRanges: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('personOptionsForRole', () => {
  it('sorts people who prefer the role first, then everyone else, each group alphabetically, under section headers', () => {
    const people: Person[] = [
      person({ id: 'pete', firstName: 'Pete', lastName: 'Donovan' }),
      person({ id: 'tina', firstName: 'Tina', lastName: 'Marsh' }),
      person({ id: 'vera', firstName: 'Vera', lastName: 'Turner', preferredRoleIds: ['Slides'] }),
      person({ id: 'owen', firstName: 'Owen', lastName: 'Castillo' }),
      person({ id: 'jenna', firstName: 'Jenna', lastName: 'Turner', preferredRoleIds: ['Slides'] }),
      person({ id: 'rosa', firstName: 'Rosa', lastName: 'Alvarado' }),
    ]
    const options = personOptionsForRole(people, 'Slides')
    expect(options.map((o) => o.title)).toEqual([
      'Preferred',
      'Jenna Turner',
      'Vera Turner',
      'Everyone Else',
      'Owen Castillo',
      'Pete Donovan',
      'Rosa Alvarado',
      'Tina Marsh',
    ])
    expect(options.map((o) => o.type)).toEqual([
      'subheader',
      undefined,
      undefined,
      'subheader',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('falls back to plain alphabetical order when no role is given', () => {
    const people: Person[] = [
      person({ id: 'b', firstName: 'Bob', lastName: 'Bell', preferredRoleIds: ['Vocals'] }),
      person({ id: 'a', firstName: 'Ann', lastName: 'Adams' }),
    ]
    expect(personOptionsForRole(people, undefined).map((o) => o.title)).toEqual([
      'Ann Adams',
      'Bob Bell',
    ])
  })

  it('omits section headers when no one prefers the role — a lone "Everyone Else" header would be odd', () => {
    const people: Person[] = [
      person({ id: 'b', firstName: 'Bob', lastName: 'Bell' }),
      person({ id: 'a', firstName: 'Ann', lastName: 'Adams' }),
    ]
    const options = personOptionsForRole(people, 'Vocals')
    expect(options).toEqual([
      { title: 'Ann Adams', value: 'a' },
      { title: 'Bob Bell', value: 'b' },
    ])
  })

  it('omits section headers when everyone prefers the role', () => {
    const people: Person[] = [
      person({ id: 'b', firstName: 'Bob', lastName: 'Bell', preferredRoleIds: ['Vocals'] }),
      person({ id: 'a', firstName: 'Ann', lastName: 'Adams', preferredRoleIds: ['Vocals'] }),
    ]
    const options = personOptionsForRole(people, 'Vocals')
    expect(options).toEqual([
      { title: 'Ann Adams', value: 'a' },
      { title: 'Bob Bell', value: 'b' },
    ])
  })

  it('does not treat a role name as a substring match against unrelated preferred roles', () => {
    const people: Person[] = [
      person({
        id: 'a',
        firstName: 'Ann',
        lastName: 'Adams',
        preferredRoleIds: ['Sound Booth Lead'],
      }),
      person({ id: 'b', firstName: 'Bob', lastName: 'Bell', preferredRoleIds: ['Sound Booth'] }),
    ]
    const options = personOptionsForRole(people, 'Sound Booth')
    expect(options.map((o) => o.title)).toEqual([
      'Preferred',
      'Bob Bell',
      'Everyone Else',
      'Ann Adams',
    ])
  })
})
