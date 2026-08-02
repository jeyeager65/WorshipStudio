import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Add-to-Service External App tab', () => {
  it('rejects a missing executable at add-time, then adds a valid profile', async () => {
    // Self-contained fixtures (one pointed at a real, always-present Windows binary; one
    // pointed at nothing), same approach as other specs — written directly to disk rather
    // than driving the full Settings profile editor here.
    const externalAppsPath = path.join(appDataDir, 'external-apps.json')
    fs.writeFileSync(
      externalAppsPath,
      JSON.stringify(
        [
          {
            id: 'external-app-e2e-missing',
            name: 'E2E Missing App',
            launchMode: 'launch-automatically',
            executablePath: 'C:\\Does\\Not\\Exist.exe',
            remoteControlsEnabled: false,
            updatedAt: '2026-07-26T00:00:00Z',
            updatedByDevice: 'e2e',
          },
          {
            id: 'external-app-e2e-add',
            name: 'E2E Notepad',
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
      // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
      // setup wizard (App.vue) — see smoke.spec.js's identical guard.
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const createLink = await $('a*=Create Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()
      const submit = await $('button*=Create and Open Service')
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      // "Add Item" opens a menu of item types directly (no separate type-select step inside a
      // dialog anymore) — picking "External App" here opens the Add dialog straight to that tab.
      const addButton = await $('button*=Add Item')
      await addButton.waitForExist({ timeout: 15000 })
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()
      const externalAppOption = await $('.v-list-item*=External App')
      await externalAppOption.waitForClickable({ timeout: 10000 })
      await externalAppOption.click()

      // Scoped selectors below use the dialog as the root — the "Add to Service" text is also
      // the top-level button that opened this dialog, so an unscoped query would grab the
      // wrong one.
      const dialog = await $('.v-dialog')
      await dialog.waitForExist({ timeout: 10000 })

      // The App Profile select is looked up by its own label text, since the Type select
      // above is also a plain .v-select and would otherwise be matched first.
      const select = await dialog.$('.v-select*=App Profile')
      await select.waitForClickable({ timeout: 10000 })
      await select.click()
      const missingOption = await $('.v-list-item*=E2E Missing App')
      await missingOption.waitForClickable({ timeout: 10000 })
      await missingOption.click()

      // No {file} placeholder in either profile's parameter format, so no file picker
      // appears — straight to add-time verification (executable exists), which exercises the
      // real Rust command without launching anything.
      const addToServiceBtn = await dialog.$('button*=Add to Service')
      await addToServiceBtn.waitForClickable({ timeout: 10000 })
      await addToServiceBtn.click()

      const errorAlert = await $('div*=Executable not found')
      await errorAlert.waitForExist({ timeout: 10000 })
      await expect(errorAlert).toBeExisting()
      // Dialog stays open on failure, and nothing was added to the service order list — the
      // "no items yet" placeholder (behind the still-open dialog) confirms that; a plain
      // `span*=E2E Missing App` search would also match the select's own closed-dropdown
      // display of the chosen (but not yet added) profile name.
      await expect(await $('p*=This service has no items yet')).toBeExisting()

      // Switch to the valid profile without closing the dialog, and confirm it succeeds.
      await select.click()
      const validOption = await $('.v-list-item*=E2E Notepad')
      await validOption.waitForClickable({ timeout: 10000 })
      await validOption.click()
      await addToServiceBtn.waitForClickable({ timeout: 10000 })
      await addToServiceBtn.click()

      const itemRow = await $('.service-item-title*=E2E Notepad')
      await itemRow.waitForExist({ timeout: 10000 })
      await expect(itemRow).toBeExisting()
    } finally {
      if (fs.existsSync(externalAppsPath)) fs.unlinkSync(externalAppsPath)
    }
  })
})
