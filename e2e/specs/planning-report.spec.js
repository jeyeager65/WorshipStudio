import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Multi-Week Planning Report', () => {
  it('shows planned songs and roster for a service within the default range', async () => {
    // Self-contained fixtures (song + person + service), same approach as
    // sync-conflicts.spec.js — written directly to disk and cleaned up in `finally`, rather
    // than driving the flaky native date-input control through Create Service (see
    // planning-ahead.spec.js's fix for that same control). The isolated E2E app-data
    // directory (see helpers/appDataDir.js) starts empty on every run, so this can no longer
    // borrow an existing song from the library the way it once did against the real profile —
    // it has to create its own, like every other fixture here.
    const libraryDir = path.join(appDataDir, 'Library')
    const songsDir = path.join(libraryDir, 'songs')
    const peopleDir = path.join(libraryDir, 'people')
    const servicesDir = path.join(libraryDir, 'services', '2026')
    fs.mkdirSync(songsDir, { recursive: true })
    fs.mkdirSync(peopleDir, { recursive: true })
    fs.mkdirSync(servicesDir, { recursive: true })

    const songId = 'song-e2e-planning-report'
    const songPath = path.join(songsDir, `${songId}.json`)
    const songTitle = 'E2E Planning Report Song'
    fs.writeFileSync(
      songPath,
      JSON.stringify(
        {
          id: songId,
          title: songTitle,
          collections: [],
          tags: [],
          blocks: [{ id: 'v1', label: 'Verse 1', text: 'E2E fixture verse.' }],
          defaultArrangement: { sequence: ['v1'] },
          usage: { usesPastYear: 0 },
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    const personId = 'person-e2e-planning-report'
    const personPath = path.join(peopleDir, `${personId}.json`)
    fs.writeFileSync(
      personPath,
      JSON.stringify(
        {
          id: personId,
          firstName: 'Jordan',
          lastName: 'E2EReport',
          preferredRoles: [],
          unavailableDateRanges: [],
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    const serviceId = 'service-e2e-planning-report'
    const servicePath = path.join(servicesDir, `${serviceId}.json`)
    // 30 days out — inside the report's default (today through +3 months) range.
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    fs.writeFileSync(
      servicePath,
      JSON.stringify(
        {
          id: serviceId,
          date: futureDate,
          type: 'Sunday Morning Worship',
          sermonTitle: 'E2E Planning Report Sermon',
          preacherId: personId,
          items: [{ id: 'item-1', type: 'song', songId, arrangement: { sequence: ['v1'] } }],
          assignments: [{ role: 'Piano', personId, tentative: false }],
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    try {
      // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
      // setup wizard (App.vue) — see smoke.spec.js's identical guard.
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const reportsNav = await $('a*=Reports')
      await reportsNav.waitForExist({ timeout: 15000 })
      await reportsNav.click()

      const planningLink = await $('a*=Multi-Week Planning Report')
      await planningLink.waitForExist({ timeout: 10000 })
      await planningLink.click()

      const heading = await $('h1*=Multi-Week Planning Report')
      await heading.waitForExist({ timeout: 10000 })

      const sermonTitle = await $('span*=E2E Planning Report Sermon')
      await sermonTitle.waitForExist({ timeout: 10000 })
      await expect(sermonTitle).toBeExisting()

      const songsLine = await $(`div*=${songTitle}`)
      await expect(songsLine).toBeExisting()

      const rosterLine = await $('div*=Piano — Jordan E2EReport')
      await expect(rosterLine).toBeExisting()
    } finally {
      if (fs.existsSync(songPath)) fs.unlinkSync(songPath)
      if (fs.existsSync(personPath)) fs.unlinkSync(personPath)
      if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)
    }
  })
})
