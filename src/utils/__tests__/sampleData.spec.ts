import { describe, expect, it } from 'vitest'
import { buildSampleServices, sampleSongs, sampleThemes, sampleVolunteers, sampleVolunteerRoles } from '@/utils/sampleData'
import { findRoleConflicts } from '@/utils/volunteerConflicts'
import { parseReference } from '@/utils/scriptureReference'

const songsById = new Map(sampleSongs.map((s) => [s.id, s]))
const volunteerIds = new Set(sampleVolunteers.map((v) => v.id))
const services = buildSampleServices(new Date('2026-07-26T12:00:00Z'))

describe('sample data', () => {
  it('every song block ID referenced by an arrangement actually exists on that song', () => {
    for (const song of sampleSongs) {
      const blockIds = new Set(song.blocks.map((b) => b.id))
      for (const id of song.defaultArrangement.sequence) {
        expect(blockIds.has(id), `${song.title}: default arrangement references missing block "${id}"`).toBe(true)
      }
    }
  })

  it('every service item songId resolves to a real sample song, and its arrangement blocks exist on that song', () => {
    for (const service of services) {
      for (const item of service.items) {
        if (item.type !== 'song') continue
        const song = songsById.get(item.songId)
        expect(song, `${service.id}/${item.id}: unknown songId "${item.songId}"`).toBeDefined()
        const blockIds = new Set(song!.blocks.map((b) => b.id))
        for (const id of item.arrangement.sequence) {
          expect(blockIds.has(id), `${service.id}/${item.id}: arrangement references missing block "${id}" on "${song!.title}"`).toBe(true)
        }
      }
    }
  })

  it('every volunteer roster entry references a real sample volunteer', () => {
    for (const service of services) {
      for (const assignment of service.volunteerRoster ?? []) {
        if (!assignment.volunteerId) continue
        expect(volunteerIds.has(assignment.volunteerId), `${service.id}: unknown volunteerId "${assignment.volunteerId}"`).toBe(true)
      }
    }
  })

  it('every scripture reference parses to a real book/chapter/verse', () => {
    for (const service of services) {
      for (const item of service.items) {
        if (item.type !== 'scripture') continue
        expect(parseReference(item.reference), `${service.id}/${item.id}: unparseable reference "${item.reference}"`).toBeDefined()
      }
    }
  })

  it('the upcoming Sunday service has a deliberate double-booking conflict', () => {
    const soon = services.find((s) => s.id === 'service-sample-upcoming-sunday')!
    const conflicts = findRoleConflicts(soon.volunteerRoster ?? [])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].volunteerId).toBe('volunteer-sample-marcus-johnson')
    expect(conflicts[0].roles.sort()).toEqual(['Piano', 'Slides'])
  })

  it('no other service has an accidental conflict', () => {
    for (const service of services) {
      if (service.id === 'service-sample-upcoming-sunday') continue
      expect(findRoleConflicts(service.volunteerRoster ?? []), service.id).toHaveLength(0)
    }
  })

  it('produces one past service, two upcoming Sundays, and one upcoming Wednesday, in ISO yyyy-mm-dd form', () => {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    for (const service of services) {
      expect(service.date).toMatch(dateRe)
    }
    const referenceDate = new Date('2026-07-26T12:00:00Z')
    const past = services.find((s) => s.id === 'service-sample-past-sunday')!
    const soon = services.find((s) => s.id === 'service-sample-upcoming-sunday')!
    const future = services.find((s) => s.id === 'service-sample-future-sunday')!
    expect(new Date(past.date).getTime()).toBeLessThan(referenceDate.getTime())
    expect(new Date(soon.date).getTime()).toBeGreaterThan(referenceDate.getTime())
    expect(new Date(future.date).getTime()).toBeGreaterThan(new Date(soon.date).getTime())
  })

  it('themes and volunteer roles are internally consistent with the rosters/preferredRoles used above', () => {
    expect(sampleThemes.length).toBeGreaterThan(0)
    const usedRoles = new Set(services.flatMap((s) => (s.volunteerRoster ?? []).map((r) => r.role)))
    for (const role of usedRoles) {
      expect(sampleVolunteerRoles, `roster uses role "${role}" not present in sampleVolunteerRoles`).toContain(role)
    }
  })
})
