import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Settings — Library & Sync data tools', () => {
  it('loads sample data after confirming the destructive-action warning', async () => {
    // The library path picker/portable-folder buttons aren't covered here — actually changing
    // the library path would point this test (and the reload prompt it triggers) at a
    // different folder entirely, which isn't safely reversible mid-test. "Check Now"/sync
    // health is already covered by sync-conflicts.spec.js. Sample data is the one remaining,
    // safe-to-drive action: it shares the E2E app-data directory (see helpers/appDataDir.js)
    // with every other spec in this run — reset once at suite start, not per spec — so by the
    // time this runs, other specs' leftover services/themes may already make the confirmation
    // below require typing DELETE rather than a plain confirm; handled below either way.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    const loadSampleBtn = await $('button*=Load Sample Data')
    await loadSampleBtn.waitForClickable({ timeout: 10000 })
    await loadSampleBtn.click()

    // Whether this needs a plain confirm or a typed "DELETE" depends on whether the shared
    // E2E library already has real content at this point in the suite run — other specs that
    // ran earlier (add-external-app, order-of-worship, etc.) leave services/themes behind
    // rather than cleaning up, since the app-data directory is only reset once per full run,
    // not per spec (see ConfirmDialog.vue / LibrarySyncSection.vue's confirmDestructiveAction).
    const phraseField = await $('label*=Type DELETE to confirm')
    if (await phraseField.waitForExist({ timeout: 3000 }).catch(() => false)) {
      const phraseLabelId = await phraseField.getAttribute('id')
      const phraseInput = await $(`input[aria-labelledby="${phraseLabelId}"]`)
      await phraseInput.setValue('DELETE')
    }

    const confirmBtn = await $('button*=Delete Everything & Load Sample Data')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    // Loading sample data sequentially saves several dozen songs/people/themes/services, each
    // its own async Tauri IPC round trip — genuinely slower than a typical Settings action.
    const successText = await $('div*=Sample songs, services, people, and themes added')
    await successText.waitForExist({ timeout: 45000 })
    await expect(successText).toBeExisting()

    // Confirms it's real content, not just a status message — the sample services should now
    // be visible from the Services list. Loading sample data leaves the settings document dirty
    // (the service types/role groups/templates/collections fields it overwrites are part of the
    // same document, even though this action already persisted them itself), so navigating away
    // triggers the app's own unsaved-changes guard — handle it if it shows up.
    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()

    const saveAndLeaveBtn = await $('button*=Save & Leave')
    if (await saveAndLeaveBtn.waitForExist({ timeout: 3000 }).catch(() => false)) {
      await saveAndLeaveBtn.click()
    }

    const serviceCard = await $('.service-card')
    await serviceCard.waitForExist({ timeout: 10000 })
    await expect(serviceCard).toBeExisting()
  })

  it('edits the local media path, saves, and it persists after navigating away and back', async () => {
    // Browse… opens a real native OS folder dialog, which webdriver can't drive — typing
    // directly into the field (same approach settings-general.spec.js uses for computer name)
    // still exercises the part that matters: the field renders, binds, and persists.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    const pathLabel = await $('label*=Local media path')
    await pathLabel.waitForExist({ timeout: 10000 })
    const labelId = await pathLabel.getAttribute('id')
    const pathField = await $(`input[aria-labelledby="${labelId}"]`)
    await pathField.click()
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await pathField.addValue('C:\\E2E\\LocalMedia')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()
    const reopenedSyncSection = await $('.v-list-item*=Library & Sync')
    await reopenedSyncSection.waitForExist({ timeout: 10000 })
    await reopenedSyncSection.click()

    const reopenedLabel = await $('label*=Local media path')
    await reopenedLabel.waitForExist({ timeout: 10000 })
    const reopenedLabelId = await reopenedLabel.getAttribute('id')
    const reopenedField = await $(`input[aria-labelledby="${reopenedLabelId}"]`)
    await expect(reopenedField).toHaveValue('C:\\E2E\\LocalMedia')
  })

  it('clears media and one-time migration snapshot files when clearing existing data', async () => {
    // A stand-in for a real "library-settings.pre-*-id-migration.json" recovery snapshot — the
    // real ones are only ever written once, the first time each id migration runs, so the
    // shared E2E library (already fully migrated well before this spec runs) won't have one on
    // its own; writing it directly is the only way to exercise clear_migration_snapshots here.
    const libraryDir = path.join(appDataDir, 'Library')
    fs.mkdirSync(libraryDir, { recursive: true })
    const snapshotPath = path.join(
      libraryDir,
      'library-settings.pre-role-id-migration.json',
    )
    fs.writeFileSync(snapshotPath, '{}')

    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    // Guarantees real media exists to clear — idempotent/non-destructive, safe even if earlier
    // specs in this run already added the stock backgrounds.
    const addStockBtn = await $('button*=Add Stock Backgrounds')
    await addStockBtn.waitForClickable({ timeout: 10000 })
    await addStockBtn.click()
    const stockAddedText = await $('div*=already-present ones were skipped')
    await stockAddedText.waitForExist({ timeout: 15000 })

    const clearBtn = await $('button*=Clear Existing Data')
    await clearBtn.waitForClickable({ timeout: 10000 })
    await clearBtn.click()

    // The shared E2E library has real content well before this spec runs (see this file's other
    // tests, plus every spec that ran earlier), so this is always the typed-DELETE path.
    const phraseField = await $('label*=Type DELETE to confirm')
    await phraseField.waitForExist({ timeout: 5000 })
    const phraseLabelId = await phraseField.getAttribute('id')
    const phraseInput = await $(`input[aria-labelledby="${phraseLabelId}"]`)
    await phraseInput.setValue('DELETE')

    const confirmBtn = await $('button*=Delete Everything')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    const clearedText = await $('div*=have been deleted')
    await clearedText.waitForExist({ timeout: 20000 })
    expect(await clearedText.getText()).toContain('media')

    // Confirmed on disk, not just via the UI's own status message — deleting each media item
    // through the store (rather than nuking the whole folder) leaves an empty directory behind
    // rather than removing it, so this checks for an empty directory, not a missing one.
    const mediaDir = path.join(libraryDir, 'media')
    const mediaItemsDir = path.join(libraryDir, 'media-items')
    for (const dir of [mediaDir, mediaItemsDir]) {
      if (fs.existsSync(dir)) {
        expect(fs.readdirSync(dir)).toHaveLength(0)
      }
    }
    expect(fs.existsSync(snapshotPath)).toBe(false)

    // This is the one test in the whole suite that actually empties the shared E2E library
    // (service types included) rather than just adding to it — every other spec assumes at
    // least the 3 default service types exist (Create Service's Type dropdown, the smoke test's
    // "Create & Open Service" flow, etc.), and nothing re-seeds them once service-types.json
    // already exists. Restoring via Load Sample Data (already proven by this file's first test)
    // leaves the shared library in the same populated baseline specs later in the run expect,
    // instead of this test silently breaking everything that runs after it.
    const loadSampleBtn = await $('button*=Load Sample Data')
    await loadSampleBtn.waitForClickable({ timeout: 10000 })
    await loadSampleBtn.click()

    // The library is empty at this point (just cleared above), so this is always the plain
    // confirm path, not the typed-DELETE one — but handle both the same way the earlier test
    // does, in case a future change alters what counts as "empty".
    const restorePhraseField = await $('label*=Type DELETE to confirm')
    if (await restorePhraseField.waitForExist({ timeout: 3000 }).catch(() => false)) {
      const restorePhraseLabelId = await restorePhraseField.getAttribute('id')
      const restorePhraseInput = await $(`input[aria-labelledby="${restorePhraseLabelId}"]`)
      await restorePhraseInput.setValue('DELETE')
    }
    const restoreConfirmBtn = await $('button*=Delete Everything & Load Sample Data')
    await restoreConfirmBtn.waitForClickable({ timeout: 10000 })
    await restoreConfirmBtn.click()

    const restoredText = await $('div*=Sample songs, services, people, and themes added')
    await restoredText.waitForExist({ timeout: 45000 })
    await expect(restoredText).toBeExisting()
  })
})
