import { beforeEach, describe, expect, it } from 'vitest'
import type { Theme, Person } from '@/models/library'
import type { Announcement } from '@/models/announcement'
import { createWebAnnouncementsPort } from '../announcements'
import { createWebPeoplePort } from '../people'
import { createWebSettingsPort } from '../settings'
import { createWebThemesPort } from '../themes'
import { createFakeRoot } from './fakeFsa'

beforeEach(() => {
  localStorage.clear()
})

describe('createWebThemesPort', () => {
  it('saves to themes/<id>.json and round-trips through list', async () => {
    const root = createFakeRoot()
    const port = createWebThemesPort(root, createWebSettingsPort(root))
    const theme: Theme = {
      id: 'theme-1',
      name: 'Golden Cross',
      font: 'Montserrat',
      textColor: '#FFFFFF',
      outline: true,
      useAsDefaultFor: [],
      updatedAt: '',
      updatedByDevice: '',
    }
    await port.save(theme)
    expect((await port.list()).map((t) => t.name)).toEqual(['Golden Cross'])

    await port.delete('theme-1')
    expect(await port.list()).toEqual([])
  })
})

describe('createWebPeoplePort', () => {
  it('saves to people/<id>.json and round-trips through list', async () => {
    const root = createFakeRoot()
    const port = createWebPeoplePort(root, createWebSettingsPort(root))
    const person: Person = {
      id: 'person-1',
      firstName: 'Dan',
      lastName: 'Smith',
      preferredRoleIds: [],
      unavailableDateRanges: [],
      updatedAt: '',
      updatedByDevice: '',
    }
    await port.save(person)
    expect((await port.list()).map((p) => p.firstName)).toEqual(['Dan'])

    await port.delete('person-1')
    expect(await port.list()).toEqual([])
  })
})

describe('createWebAnnouncementsPort', () => {
  it('saves to announcements/<id>.json and round-trips through list', async () => {
    const root = createFakeRoot()
    const port = createWebAnnouncementsPort(root, createWebSettingsPort(root))
    const announcement: Announcement = {
      id: 'ann-1',
      text: 'Potluck this Sunday',
      updatedAt: '',
      updatedByDevice: '',
    }
    await port.save(announcement)
    expect((await port.list()).map((a) => a.text)).toEqual(['Potluck this Sunday'])

    await port.delete('ann-1')
    expect(await port.list()).toEqual([])
  })
})
