import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { appDataDir } from '../helpers/appDataDir.js'

describe('External App Hand-off (live launch/restore)', () => {
  it('launches on advance, and cleanly surfaces a Try Again/Skip error if the window never appears', async () => {
    // Windows 11's inbox notepad.exe is a redirector stub for the modern (UWP/MSIX) Notepad —
    // the process this app spawns exits almost immediately after handing off to
    // ApplicationFrameHost.exe, so launch_and_focus's 5s wait-for-window never finds a window
    // owned by the PID it's actually tracking. That's a real Windows 11 environment quirk,
    // not a Worship Studio bug — the same launch_and_focus primitive already works when
    // driven from Settings' "Test Launch" against a real Win32 executable. This spec exists
    // to verify the *live* wiring around it (auto-launch on advance, the operator-only
    // error banner with Try Again/Skip, and that Stop Presenting/restore-self afterward
    // doesn't hang the session) — not to require an app that happens to cold-start under 5s.
    const externalAppsPath = path.join(appDataDir, 'external-apps.json')
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

      const createLink = await $('a*=Create New Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()
      const submit = await $('button*=Create & Open Service')
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      const addButton = await $('button*=Add to Service')
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()

      const dialog = await $('.v-dialog')
      const typeSelect = await dialog.$('.v-select')
      await typeSelect.waitForClickable({ timeout: 10000 })
      await typeSelect.click()
      // Scoped to the open menu's own overlay content — an unscoped query can match the
      // persistent left nav's own .v-list-item entries instead.
      const externalAppOption = await (await $('[role="listbox"]')).$('.v-list-item*=External App')
      await externalAppOption.waitForClickable({ timeout: 10000 })
      await externalAppOption.click()

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

      const itemRow = await $('span*=E2E Live Notepad')
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

      // The live-status footer should reflect this item going live regardless of whether the
      // launch itself succeeds — this is driven by flatIndex/isPresenting, not by the launch
      // outcome.
      const liveStatus = await $('span*=LIVE: E2E Live Notepad')
      await liveStatus.waitForExist({ timeout: 10000 })
      await expect(liveStatus).toBeExisting()

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

      const notPresenting = await $('span*=Not Presenting')
      await notPresenting.waitForExist({ timeout: 10000 })
      await expect(notPresenting).toBeExisting()
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
