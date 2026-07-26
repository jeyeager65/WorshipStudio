import fs from 'node:fs'
import path from 'node:path'

describe('Multi-Week Planning Report', () => {
  it('shows planned songs and roster for a service within the default range', async () => {
    // Self-contained fixtures (volunteer + service), same approach as sync-conflicts.spec.js —
    // written directly to disk and cleaned up in `finally`, rather than driving the flaky
    // native date-input control through Create Service (see planning-ahead.spec.js's fix for
    // that same control).
    const libraryDir = path.join(process.env.APPDATA, 'dev.yeager.worshipstudio', 'Library')
    const songsDir = path.join(libraryDir, 'songs')
    const volunteersDir = path.join(libraryDir, 'volunteers')
    const servicesDir = path.join(libraryDir, 'services', '2026')
    fs.mkdirSync(servicesDir, { recursive: true })

    const originalFile = fs.readdirSync(songsDir).find((f) => f.endsWith('.json') && !f.includes('('))
    const song = JSON.parse(fs.readFileSync(path.join(songsDir, originalFile), 'utf8'))

    const volunteerId = 'volunteer-e2e-planning-report'
    const volunteerPath = path.join(volunteersDir, `${volunteerId}.json`)
    fs.writeFileSync(
      volunteerPath,
      JSON.stringify(
        {
          id: volunteerId,
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
          preacher: 'Pastor E2E',
          items: [{ id: 'item-1', type: 'song', songId: song.id, arrangement: { sequence: [] } }],
          volunteerRoster: [{ role: 'Piano', volunteerId, tentative: false }],
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

      const songsLine = await $(`div*=${song.title}`)
      await expect(songsLine).toBeExisting()

      const rosterLine = await $('div*=Piano — Jordan E2EReport')
      await expect(rosterLine).toBeExisting()
    } finally {
      if (fs.existsSync(volunteerPath)) fs.unlinkSync(volunteerPath)
      if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)
    }
  })
})
