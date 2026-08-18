import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

// Matches remote_server.rs's DEFAULT_REMOTE_SERVER_PORT.
const PORT = 47825

describe('Remote Control — select a today service, live slide picker, 409 while presenting', () => {
  it('starts a today service from a Full Control device, jumps slides, and blocks a second start', async () => {
    const libraryDir = path.join(appDataDir, 'Library')
    const peopleDir = path.join(libraryDir, 'people')
    const songsDir = path.join(libraryDir, 'songs')
    // Local calendar date, not UTC (toISOString) — /api/services/today filters by
    // chrono::Local::now().date_naive() on the same machine this spec runs on, so the two must
    // agree regardless of timezone or time-of-day.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const servicesDir = path.join(libraryDir, 'services', String(now.getFullYear()))
    fs.mkdirSync(peopleDir, { recursive: true })
    fs.mkdirSync(songsDir, { recursive: true })
    fs.mkdirSync(servicesDir, { recursive: true })

    const personId = 'person-e2e-select-service'
    const personPath = path.join(peopleDir, `${personId}.json`)
    fs.writeFileSync(
      personPath,
      JSON.stringify(
        {
          id: personId,
          firstName: 'Jordan',
          lastName: 'E2ESelectService',
          preferredRoleIds: [],
          unavailableDateRanges: [],
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    // remote-devices.json lives under Local, not flat in app-data — see
    // src-tauri/src/paths.rs's local_root.
    const remoteDevicesPath = path.join(appDataDir, 'Local', 'remote-devices.json')
    const fullControlToken = 'e2e-select-service-full-control'
    const viewOnlyToken = 'e2e-select-service-view-only'
    fs.writeFileSync(
      remoteDevicesPath,
      JSON.stringify(
        [
          {
            id: 'device-e2e-select-service-full',
            personId,
            name: 'E2E Full Control Phone',
            accessLevel: 'full-control',
            token: fullControlToken,
            updatedAt: '2026-07-26T00:00:00Z',
            updatedByDevice: 'e2e',
          },
          {
            id: 'device-e2e-select-service-view',
            personId,
            name: 'E2E View Only Phone',
            accessLevel: 'view-only',
            token: viewOnlyToken,
            updatedAt: '2026-07-26T00:00:00Z',
            updatedByDevice: 'e2e',
          },
        ],
        null,
        2,
      ),
    )

    const songId = 'song-e2e-select-service'
    const songPath = path.join(songsDir, `${songId}.json`)
    fs.writeFileSync(
      songPath,
      JSON.stringify(
        {
          id: songId,
          title: 'E2E Select Service Song',
          collections: [],
          tags: [],
          blocks: [
            { id: 'v1', label: 'Verse 1', text: 'First verse fixture text.' },
            { id: 'c1', label: 'Chorus', text: 'Chorus fixture text.' },
          ],
          defaultArrangement: { sequence: ['v1', 'c1'] },
          usage: { usesPastYear: 0 },
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    const serviceId = 'service-e2e-select-service'
    const servicePath = path.join(servicesDir, `${serviceId}.json`)
    fs.writeFileSync(
      servicePath,
      JSON.stringify(
        {
          id: serviceId,
          date: today,
          time: '09:00',
          serviceTypeId: 'type-e2e-select-service',
          items: [{ id: 'item-1', type: 'song', songId, arrangement: { sequence: ['v1', 'c1'] } }],
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    async function pairCookie(token) {
      const res = await fetch(`http://127.0.0.1:${PORT}/pair?token=${token}`, { redirect: 'manual' })
      return res.headers.get('set-cookie').split(';')[0]
    }

    try {
      const fullControlCookie = await pairCookie(fullControlToken)
      const viewOnlyCookie = await pairCookie(viewOnlyToken)

      // Access-level gating on the listing itself — even seeing today's schedule is Full
      // Control-only (feature-spec.md section 4), not just the button that acts on it.
      const viewOnlyListRes = await fetch(`http://127.0.0.1:${PORT}/api/services/today`, {
        headers: { Cookie: viewOnlyCookie },
      })
      expect(viewOnlyListRes.status).toBe(403)

      const fullControlListRes = await fetch(`http://127.0.0.1:${PORT}/api/services/today`, {
        headers: { Cookie: fullControlCookie },
      })
      expect(fullControlListRes.status).toBe(200)
      const todaysServices = await fullControlListRes.json()
      expect(todaysServices.some((s) => s.id === serviceId)).toBe(true)

      // Access-level gating on the action too.
      const viewOnlySelectRes = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: viewOnlyCookie },
        body: JSON.stringify({ action: 'select-service', serviceId }),
      })
      expect(viewOnlySelectRes.status).toBe(403)

      // First launch on a fresh profile redirects to the setup wizard — see smoke.spec.js.
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      // The operator's own app must be idle on the services list (not already presenting
      // something else) for select-service to be accepted at all — true by construction here,
      // since this is a freshly wiped E2E profile with nothing yet live.
      const selectRes = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: fullControlCookie },
        body: JSON.stringify({ action: 'select-service', serviceId }),
      })
      expect(selectRes.status).toBe(200)

      // select-service only opens the service (navigates useRemoteServiceSelection.ts's global
      // listener to it) — it deliberately does *not* also start presenting, so a device can't
      // put something live before anyone's looked at what's about to go up. `serviceOpen`
      // (pushed once useLiveTransport.ts mounts for this workspace) is the signal a phone would
      // wait on before it even shows a Start Presenting button.
      await browser.waitUntil(
        async () => {
          const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
            headers: { Cookie: fullControlCookie },
          })
          const polled = await res.json()
          return polled.serviceOpen === true
        },
        { timeout: 10000, timeoutMsg: 'Expected the workspace to open and report serviceOpen' },
      )

      // A separate, distinct action actually starts presenting — same togglePresenting() path
      // a manual "Start Presenting" click uses (see external-app-live.spec.js). A machine with
      // no audience display configured yet surfaces the readiness gate instead of presenting
      // directly — walk through it the same way that spec does.
      const startRes = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: fullControlCookie },
        body: JSON.stringify({ action: 'toggle-presenting' }),
      })
      expect(startRes.status).toBe(200)

      const readinessTitle = await $('.readiness-dialog-title')
      let readinessBlocked = false
      try {
        await readinessTitle.waitForExist({ timeout: 8000 })
        readinessBlocked = true
      } catch {
        readinessBlocked = false
      }
      if (readinessBlocked) {
        const displayBlocker = await $('.readiness-issue-row.is-blocker')
        await displayBlocker.waitForClickable({ timeout: 10000 })
        await displayBlocker.click()

        const displayDialog = await $('.presentation-display-dialog')
        await displayDialog.waitForExist({ timeout: 10000 })
        const option = await displayDialog.$('.presentation-display-option:not(.disabled)')
        const alreadySelected = (await option.getAttribute('class')).includes('selected')
        if (!alreadySelected) await option.click()
        const useAndStartBtn = await displayDialog.$('button*=Use Display & Start')
        await useAndStartBtn.waitForClickable({ timeout: 10000 })
        await useAndStartBtn.click()
      }

      const presentingBadge = await $('.presenting-badge')
      await presentingBadge.waitForExist({ timeout: 15000 })
      await expect(presentingBadge).toBeExisting()

      // The remote's own view of state agrees with the operator UI — confirms pushLiveState
      // fired for this remotely started presentation the same as a manually started one.
      const stateRes = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
        headers: { Cookie: fullControlCookie },
      })
      const state = await stateRes.json()
      expect(state.isPresenting).toBe(true)
      expect(state.slides).toHaveLength(2)
      expect(state.slides[0].label).toContain('Verse 1')
      expect(state.slides[1].label).toContain('Chorus')

      // The live slide picker: jump straight to the second block via `goto`, previously
      // unreachable dead code from the phone's side until this UI existed.
      const gotoRes = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: fullControlCookie },
        body: JSON.stringify({ action: 'goto', index: 1 }),
      })
      expect(gotoRes.status).toBe(200)

      await browser.waitUntil(
        async () => {
          const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
            headers: { Cookie: fullControlCookie },
          })
          const polled = await res.json()
          return polled.content?.subLabel === 'Chorus'
        },
        { timeout: 10000, timeoutMsg: 'Expected the live slide to advance to the Chorus block' },
      )

      // Now that something is presenting, a second select-service attempt is refused
      // server-side (409), not just hidden client-side — even for the very same service.
      const blockedSelectRes = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: fullControlCookie },
        body: JSON.stringify({ action: 'select-service', serviceId }),
      })
      expect(blockedSelectRes.status).toBe(409)
    } finally {
      // Stop presenting via the same remote action a phone would use, so this doesn't leave the
      // shared WebDriver session presenting for whichever spec file runs next.
      await fetch(`http://127.0.0.1:${PORT}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await pairCookie(fullControlToken) },
        body: JSON.stringify({ action: 'toggle-presenting' }),
      }).catch(() => {})
      if (fs.existsSync(remoteDevicesPath)) fs.writeFileSync(remoteDevicesPath, '[]')
      if (fs.existsSync(personPath)) fs.unlinkSync(personPath)
      if (fs.existsSync(songPath)) fs.unlinkSync(songPath)
      if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)
    }
  })
})
