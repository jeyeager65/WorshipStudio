import { describe, expect, it } from 'vitest'
import {
  buildSampleServices,
  sampleSongs,
  sampleThemes,
  samplePeople,
  sampleRoles,
} from '@/utils/sampleData'
import { findRoleConflicts } from '@/utils/rosterConflicts'
import { parseReference } from '@/utils/scriptureReference'
import { buildSampleSlides } from '@/utils/sampleSlides'

const songsById = new Map(sampleSongs.map((s) => [s.id, s]))
const personIds = new Set(samplePeople.map((p) => p.id))
const services = buildSampleServices(new Date('2026-07-26T12:00:00Z'))

describe('sample data', () => {
  it('every song block ID referenced by an arrangement actually exists on that song', () => {
    for (const song of sampleSongs) {
      const blockIds = new Set(song.blocks.map((b) => b.id))
      for (const id of song.defaultArrangement.sequence) {
        expect(
          blockIds.has(id),
          `${song.title}: default arrangement references missing block "${id}"`,
        ).toBe(true)
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
          expect(
            blockIds.has(id),
            `${service.id}/${item.id}: arrangement references missing block "${id}" on "${song!.title}"`,
          ).toBe(true)
        }
      }
    }
  })

  it('every assignment references a real sample person', () => {
    for (const service of services) {
      for (const assignment of service.assignments ?? []) {
        if (!assignment.personId) continue
        expect(
          personIds.has(assignment.personId),
          `${service.id}: unknown personId "${assignment.personId}"`,
        ).toBe(true)
      }
    }
  })

  it('every scripture reference parses to a real book/chapter/verse', () => {
    for (const service of services) {
      for (const item of service.items) {
        if (item.type !== 'scripture') continue
        expect(
          parseReference(item.reference),
          `${service.id}/${item.id}: unparseable reference "${item.reference}"`,
        ).toBeDefined()
      }
    }
  })

  it('the upcoming Sunday service has a deliberate double-booking conflict', () => {
    const soon = services.find((s) => s.id === 'service-sample-upcoming-sunday')!
    const conflicts = findRoleConflicts(soon.assignments ?? [])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].personId).toBe('person-sample-marcus-johnson')
    expect(conflicts[0].roleIds.sort()).toEqual(['role-sample-open', 'role-sample-piano'])
  })

  it('no other service has an accidental conflict', () => {
    for (const service of services) {
      if (service.id === 'service-sample-upcoming-sunday') continue
      expect(findRoleConflicts(service.assignments ?? []), service.id).toHaveLength(0)
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

  it('themes and role groups are internally consistent with the rosters/preferredRoleIds used above', () => {
    expect(sampleThemes.length).toBeGreaterThan(0)
    const availableRoleIds = new Set(sampleRoles.map((r) => r.id))
    const usedRoleIds = new Set(services.flatMap((s) => (s.assignments ?? []).map((r) => r.roleId)))
    for (const roleId of usedRoleIds) {
      expect(availableRoleIds, `roster uses role "${roleId}" not present in sampleRoles`).toContain(
        roleId,
      )
    }
  })
})

describe('sample services follow the real templates', () => {
  const sundays = services.filter((service) => service.serviceTemplateId)

  it('uses the communion template on first Sundays and the ordinary one otherwise', () => {
    // The church's own pattern: communion on the first Sunday of each month.
    expect(sundays.length).toBeGreaterThan(4)
    for (const service of sundays) {
      const dayOfMonth = Number(service.date.split('-')[2])
      const communion = service.serviceTemplateId === 'template-sample-sunday-communion'
      expect(communion, `${service.date}`).toBe(dayOfMonth <= 7)
      expect(service.serviceTypeId).toBe(
        communion ? 'type-sample-sunday-communion' : 'type-sample-sunday-worship',
      )
    }
  })

  it('produces both kinds, so neither template is left undemonstrated', () => {
    const kinds = new Set(sundays.map((service) => service.serviceTemplateId))
    expect(kinds).toContain('template-sample-sunday-worship')
    expect(kinds).toContain('template-sample-sunday-communion')
  })

  it('every templated service is on a Sunday', () => {
    for (const service of sundays) {
      // Parsed as local time deliberately — `new Date('yyyy-mm-dd')` is UTC and would shift the
      // weekday for anyone west of Greenwich.
      const [y, m, d] = service.date.split('-').map(Number)
      expect(new Date(y!, m! - 1, d!).getDay(), service.date).toBe(0)
    }
  })

  it('gives communion its extra songs — the table and the cup', () => {
    const communion = sundays.find(
      (service) => service.serviceTemplateId === 'template-sample-sunday-communion',
    )!
    const labels = communion.items.map((item) => item.bulletinLabel)
    expect(labels).toContain("The Lord's Supper")
    expect(labels).toContain('Tithes and Offerings')
    expect(labels).toContain('Closing Song')
  })

  it('follows the ordinary template order, welcome through closing song', () => {
    const worship = sundays.find(
      (service) => service.serviceTemplateId === 'template-sample-sunday-worship',
    )!
    const labels = worship.items.map((item) => item.bulletinLabel).filter(Boolean)
    expect(labels[0]).toBe('Welcome and Announcements')
    expect(labels).toContain('Silent Preparation')
    expect(labels).toContain('Scriptural Call to Worship')
    expect(labels).toContain('Prayer of Praise and Confession')
    expect(labels).toContain('Scripture Reading')
    expect(labels).toContain('Prayer of Thanksgiving and Petition')
    expect(labels[labels.length - 1]).toBe('Closing Song')
  })

  it('gives songs a usage history worth reporting on', () => {
    // Four services clustered around today left every usage report empty, which made a real
    // feature look broken in every screenshot.
    const used = new Map<string, number>()
    for (const service of services) {
      for (const item of service.items) {
        if (item.type === 'song') used.set(item.songId, (used.get(item.songId) ?? 0) + 1)
      }
    }
    expect(used.size).toBeGreaterThanOrEqual(sampleSongs.length - 1)
    expect(Math.max(...used.values())).toBeGreaterThan(3)
  })
})

describe('the pre-service slide loop', () => {
  const sundays = services.filter((service) => service.serviceTemplateId)

  it('opens every templated Sunday', () => {
    for (const service of sundays) {
      expect(service.items[0]?.type, service.date).toBe('slide-ref')
    }
  })

  it('carries no bulletin label, so it stays out of the printed order of worship', () => {
    // orderOfWorship.ts filters out a slide item with no bulletinLabel — right for something that
    // plays to an empty room before anyone is seated.
    for (const service of sundays) {
      const first = service.items[0]!
      expect(first.bulletinLabel, service.date).toBeUndefined()
    }
  })

  it('points at a slide item that actually exists', () => {
    const slideIds = new Set(buildSampleSlides().map((item) => item.id))
    for (const service of sundays) {
      const first = service.items[0]!
      if (first.type === 'slide-ref') expect(slideIds).toContain(first.slideId)
    }
  })
})

describe('seeded themes cover every presentation target exactly once', () => {
  it('gives each content type its own background rather than sharing one', async () => {
    // Songs, scripture, sermons and text slides should each render on their own image out of the
    // box; a service can still override an individual item. Two themes claiming the same target is
    // the collision importStockBackgrounds avoids, so it must not appear in seeded data either.
    const { seedThemes } = await import('@/adapters/mock/fixtures')
    const claims = seedThemes.flatMap((theme) =>
      theme.useAsDefaultFor.map((target) => ({ target, theme: theme.id })),
    )
    const targets = claims.map((claim) => claim.target).sort()
    expect(targets).toEqual(['scripture', 'sermon', 'songs', 'text-slides'])

    // ...and each by a theme with its own distinct background.
    const backgrounds = claims.map(
      (claim) => seedThemes.find((theme) => theme.id === claim.theme)?.backgroundId,
    )
    expect(new Set(backgrounds).size).toBe(claims.length)
    for (const background of backgrounds) expect(background).toBeTruthy()
  })

  it('every seeded theme background is a real seeded media item', async () => {
    const { seedThemes, seedMedia } = await import('@/adapters/mock/fixtures')
    const mediaIds = new Set(seedMedia.map((item) => item.id))
    for (const theme of seedThemes) {
      if (theme.backgroundId) expect(mediaIds, theme.id).toContain(theme.backgroundId)
    }
  })
})
