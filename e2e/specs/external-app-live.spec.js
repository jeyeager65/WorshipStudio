import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { appDataDir } from '../helpers/appDataDir.js'

describe('External App Hand-off (live launch/restore)', () => {
  it('launches on advance, and cleanly surfaces a Try Again/Skip error if the window never appears', async () => {
    // Windows 11's inbox notepad.exe is a redirector stub for the modern (UWP/MSIX) Notepad —
    // the process this app spawns exits almost immediately after handing off to a different
    // host process, so launch_and_focus's own PID-based lookup alone wouldn't find its window
    // (a fallback that scans for a newly-appeared window handles this case — see win32.rs).
    // This spec exists to verify the *live* wiring around it (auto-launch on advance, the
    // operator-only error banner with Try Again/Skip, and that Stop Presenting/restore-self
    // afterward doesn't hang the session) — not to require any particular launch outcome.
    // external-apps.json lives under Local, not flat in app-data — see
    // src-tauri/src/paths.rs's local_root.
    const externalAppsPath = path.join(appDataDir, 'Local', 'external-apps.json')
    fs.writeFileSync(
      externalAppsPath,
      JSON.stringify(
        [
          {
            id: 'external-app-e2e-live',
            name: 'E2E Live Notepad',
            launchMode: 'launch-automatically',
            executablePath: 'C:\\Windows\\System32\\notepad.exe',
            remoteControlsEnabled: false,
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

      // "Add Item" opens a menu of item types directly (no separate type-select step inside a
      // dialog anymore) — picking "External App" here opens the Add dialog straight to that tab.
      const addButton = await $('button*=Add Item')
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()
      const externalAppOption = await $('.v-list-item*=External App')
      await externalAppOption.waitForClickable({ timeout: 10000 })
      await externalAppOption.click()

      const dialog = await $('.v-dialog')
      await dialog.waitForExist({ timeout: 10000 })

      // The App Profile select is looked up by its own label text, since the Type select
      // above is also a plain .v-select and would otherwise be matched first.
      const select = await dialog.$('.v-select*=App Profile')
      await select.waitForClickable({ timeout: 10000 })
      await select.click()
      const option = await $('.v-list-item*=E2E Live Notepad')
      await option.waitForClickable({ timeout: 10000 })
      await option.click()
      const addToServiceBtn = await dialog.$('button*=Add to Service')
      await addToServiceBtn.waitForClickable({ timeout: 10000 })
      await addToServiceBtn.click()

      const itemRow = await $('.service-item-title*=E2E Live Notepad')
      await itemRow.waitForExist({ timeout: 10000 })
      await itemRow.click()

      // Selecting the item in the left list only shows its preview — a separate click on the
      // center panel's "make this item live" row is what actually sets it live (flatIndex).
      const makeLiveRow = await $('div*=Click to make this item live.')
      await makeLiveRow.waitForClickable({ timeout: 10000 })
      await makeLiveRow.click()

      const presentBtn = await $('button*=Start Presenting')
      await presentBtn.waitForClickable({ timeout: 10000 })
      await presentBtn.click()

      // A machine with no audience display configured yet surfaces the pre-service readiness
      // gate instead of presenting directly — walk through "choose display" if it appears
      // (real multi-monitor machines only; on a single-monitor machine there's no selectable
      // display and this step is expected to be unreachable, same as the live UI itself).
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

      // The presenting badge and the transport bar's current-slide label should reflect this
      // item going live regardless of whether the launch itself succeeds — this is driven by
      // flatIndex/isPresenting, not by the launch outcome.
      const presentingBadge = await $('.presenting-badge')
      await presentingBadge.waitForExist({ timeout: 10000 })
      await expect(presentingBadge).toBeExisting()
      const currentSlideLabel = await $('.current-slide-copy')
      await expect(await currentSlideLabel.getText()).toContain('E2E Live Notepad')

      // Wait for launch_and_focus to resolve one way or the other (its own internal timeout
      // is 5s) and see which path it took.
      const errorBanner = await $('button*=Try Again')
      let errored = false
      try {
        await errorBanner.waitForExist({ timeout: 8000 })
        errored = true
      } catch {
        errored = false
      }

      if (errored) {
        const skipBtn = await $('button*=Skip')
        await skipBtn.waitForClickable({ timeout: 10000 })
        await skipBtn.click()
        await errorBanner.waitForExist({ timeout: 10000, reverse: true })
      }

      // Whichever path it took, Stop Presenting (which restores Worship Studio to the
      // foreground when an external app was engaged) must not hang the session.
      const stopBtn = await $('button*=Stop Presenting')
      await stopBtn.waitForClickable({ timeout: 10000 })
      await stopBtn.click()

      await presentingBadge.waitForExist({ timeout: 10000, reverse: true })
      const restartBtn = await $('button*=Start Presenting')
      await expect(restartBtn).toBeExisting()
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
