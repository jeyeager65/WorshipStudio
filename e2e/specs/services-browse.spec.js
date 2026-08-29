import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Services — Browse tab', () => {
  it('renders a service with a missing serviceTypeId instead of crashing', async () => {
    // Regression coverage for a real device: a service with no resolvable serviceTypeId (an
    // orphaned/malformed record — see cloudSync.ts's resetAndResync reconciliation fix, which
    // this is downstream of) crashed the whole Browse tab, because serviceTypeOptions used to
    // sort by a name that could be undefined for such a service. There's no in-app way to
    // produce a service missing this field (Create Service always sets one), so this is written
    // directly to disk, same approach as sync-conflicts.spec.js's fixture.
    const libraryDir = path.join(appDataDir, 'Library')
    const servicesDir = path.join(libraryDir, 'services', '2020')
    fs.mkdirSync(servicesDir, { recursive: true })
    const serviceId = 'service-e2e-missing-type'
    const servicePath = path.join(servicesDir, `${serviceId}.json`)
    fs.writeFileSync(
      servicePath,
      JSON.stringify(
        {
          id: serviceId,
          date: '2020-01-05',
          items: [],
          updatedAt: '2020-01-05T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    try {
      // Reload before touching the UI. The fixture above is written straight to disk while the
      // app is already running, and the services store reads that directory once — so whether
      // this file is seen at all comes down to whether the write landed before that read. It
      // used to win by accident (earlier specs had already created and settled the Library
      // directory); with the app-data wipe now running per spec, the app is creating that same
      // directory as this test writes into it, and the race became visible — failing about two
      // runs in three. A reload makes the ordering explicit instead of lucky.
      await browser.refresh()

      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const homeLink = await $('a*=Services')
      await homeLink.waitForExist({ timeout: 15000 })
      await homeLink.click()

      const browseTab = await $('.v-tab*=Browse')
      await browseTab.waitForExist({ timeout: 10000 })
      await browseTab.click()

      // 2020 predates "recent" — switch to All Services so the fixture is actually in scope.
      const allServicesOption = await $('.visible-filter-option*=All Services')
      await allServicesOption.waitForClickable({ timeout: 10000 })
      await allServicesOption.click()

      // The page rendering at all (rather than a black screen) is the actual regression check —
      // this heading only exists if LandingView.vue's Browse tab is still mounted, not crashed.
      const heading = await $('h2*=Browse Services')
      await expect(heading).toBeExisting()

      // Confirms the fallback path itself, not just "didn't crash" — a real service whose type
      // can't be resolved shows as "Unknown Type" rather than blanking or throwing.
      const unknownTypeCard = await $('.service-card*=Unknown Type')
      await expect(unknownTypeCard).toBeExisting()
    } finally {
      if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)
    }
  })
})
