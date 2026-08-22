import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { appDataDir } from '../helpers/appDataDir.js'

describe('External App Hand-off (Basic Remote Controls trigger key)', () => {
  it('a bound trigger key overrides Worship Studio\'s own handling only while its item is live and presenting', async () => {
    // Down normally moves the sidebar selection (useLiveTransport.ts's onKeydown) — chosen
    // deliberately so this test proves real interception (Worship Studio's own handling is
    // suppressed), not just "the app didn't crash". See keyCombo.ts's RESERVED_SHORTCUTS list
    // for the full set this same override applies to.
    const externalAppsPath = path.join(appDataDir, 'Local', 'external-apps.json')
    fs.writeFileSync(
      externalAppsPath,
      JSON.stringify(
        [
          {
            id: 'external-app-e2e-trigger',
            name: 'E2E Trigger Notepad',
            launchMode: 'launch-automatically',
            executablePath: 'C:\\Windows\\System32\\notepad.exe',
            remoteControlsEnabled: true,
            keyCommands: [
              { id: 'cmd-e2e-trigger', label: 'Test Command', keyCombo: 'F5', triggerKey: 'Down' },
            ],
            updatedAt: '2026-07-26T00:00:00Z',
            updatedByDevice: 'e2e',
          },
        ],
        null,
        2,
      ),
    )

    try {
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const createLink = await $('a*=Create Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()
      const submit = await $('button*=Create & Open Service')
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      // Two items so a real (uncaught) ArrowDown would have something to move the sidebar
      // selection to — same profile both times, no `{file}` in its parameter format so
      // "Add to Service" needs no file picked either time.
      for (let i = 0; i < 2; i++) {
        const addButton = await $('button*=Add Item')
        await addButton.waitForClickable({ timeout: 10000 })
        await addButton.click()
        const externalAppOption = await $('.v-list-item*=External App')
        await externalAppOption.waitForClickable({ timeout: 10000 })
        await externalAppOption.click()

        const dialog = await $('.v-dialog')
        await dialog.waitForExist({ timeout: 10000 })
        const select = await dialog.$('.v-select*=App Profile')
        await select.waitForClickable({ timeout: 10000 })
        await select.click()
        const option = await $('.v-list-item*=E2E Trigger Notepad')
        await option.waitForClickable({ timeout: 10000 })
        await option.click()
        const addToServiceBtn = await dialog.$('button*=Add to Service')
        await addToServiceBtn.waitForClickable({ timeout: 10000 })
        await addToServiceBtn.click()
        await dialog.waitForExist({ timeout: 10000, reverse: true })
      }

      // Both items are the same profile (itemLabel() would show identical text for either), so
      // the sidebar's own `.service-item--selected` class — not the label — is what proves
      // which one is actually selected.
      const itemRows = await $$('.service-item')
      await expect(itemRows).toBeElementsArrayOfSize(2)
      await itemRows[0].click()
      await expect((await itemRows[0].getAttribute('class')).includes('service-item--selected')).toBe(
        true,
      )

      // Control check first, before anything is live/presenting: ArrowDown here really does
      // move the sidebar selection normally — otherwise the interception assertion below would
      // pass for the wrong reason (ArrowDown just not doing anything either way).
      await browser.keys('ArrowDown')
      await browser.waitUntil(
        async () => (await itemRows[1].getAttribute('class')).includes('service-item--selected'),
        { timeout: 5000 },
      )

      // Back to the first item, then make it live.
      await itemRows[0].click()
      const makeLiveRow = await $('div*=Click to make this item live.')
      await makeLiveRow.waitForClickable({ timeout: 10000 })
      await makeLiveRow.click()

      const presentBtn = await $('button*=Start Presenting')
      await presentBtn.waitForClickable({ timeout: 10000 })
      await presentBtn.click()

      // Same real-multi-monitor-machine guard as external-app-live.spec.js.
      const readinessTitle = await $('.readiness-dialog-title')
      let readinessBlocked = false
      try {
        await readinessTitle.waitForExist({ timeout: 3000 })
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
      await presentingBadge.waitForExist({ timeout: 10000 })

      // Same "launch might not resolve on this machine" tolerance as external-app-live.spec.js
      // — resolve it one way or the other before the real assertion below, so the interception
      // check below isn't racing an in-flight launch attempt.
      const errorBanner = await $('button*=Try Again')
      try {
        await errorBanner.waitForExist({ timeout: 8000 })
        const skipBtn = await $('button*=Skip')
        await skipBtn.waitForClickable({ timeout: 10000 })
        await skipBtn.click()
        await errorBanner.waitForExist({ timeout: 10000, reverse: true })
      } catch {
        // Launched fine — nothing to resolve.
      }

      // The real assertion: pressing Down while this item is live and presenting must NOT move
      // the sidebar selection — Test Command's triggerKey ("Down") overrides Worship Studio's
      // own ArrowDown handling entirely (useLiveTransport.ts's onKeydown, tryForwardKeydown).
      // No direct way to assert "nothing happened", so briefly wait past where a real move
      // would already be visible, then confirm the first item is still the selected one.
      await browser.keys('ArrowDown')
      await browser.pause(500)
      await expect((await itemRows[0].getAttribute('class')).includes('service-item--selected')).toBe(
        true,
      )
      await expect(
        (await itemRows[1].getAttribute('class')).includes('service-item--selected'),
      ).toBe(false)

      const stopBtn = await $('button*=Stop Presenting')
      await stopBtn.waitForClickable({ timeout: 10000 })
      await stopBtn.click()
      await presentingBadge.waitForExist({ timeout: 10000, reverse: true })
    } finally {
      if (fs.existsSync(externalAppsPath)) fs.unlinkSync(externalAppsPath)
      try {
        execSync('taskkill /F /IM notepad.exe')
      } catch {
        // Not running — fine.
      }
    }
  })
})
