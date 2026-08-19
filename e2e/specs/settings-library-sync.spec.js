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

  it('edits the local data folder, saves it via its own button, and it persists after navigating away and back', async () => {
    // Browse… opens a real native OS folder dialog, which webdriver can't drive — typing
    // directly into the field (same approach settings-general.spec.js uses for computer name)
    // still exercises the part that matters: the field renders, binds, and persists. This panel
    // has its own Save button (not the page-level one) — see LibrarySyncSection.vue's own
    // comment on why the Local root can't be saved as part of the shared settings document.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    const pathLabel = await $('label*=Local data path')
    await pathLabel.waitForExist({ timeout: 10000 })
    const labelId = await pathLabel.getAttribute('id')
    const pathField = await $(`input[aria-labelledby="${labelId}"]`)
    await pathField.click()
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await pathField.addValue('C:\\E2E\\LocalData')

    const saveBtn = await $('button*=Save Local Data Folder')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()
    const savedText = await $('div*=Saved. Files already at the previous location')
    await savedText.waitForExist({ timeout: 10000 })

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()
    const reopenedSyncSection = await $('.v-list-item*=Library & Sync')
    await reopenedSyncSection.waitForExist({ timeout: 10000 })
    await reopenedSyncSection.click()

    const reopenedLabel = await $('label*=Local data path')
    await reopenedLabel.waitForExist({ timeout: 10000 })
    const reopenedLabelId = await reopenedLabel.getAttribute('id')
    const reopenedField = await $(`input[aria-labelledby="${reopenedLabelId}"]`)
    await expect(reopenedField).toHaveValue('C:\\E2E\\LocalData')

    // Must revert before this test ends — unlike the library path (which the suite's other
    // specs deliberately avoid touching, see this file's first test's own comment), the Local
    // root is what every later spec's machine-settings.json/Canva auth/paired devices actually
    // resolve through. Left pointed at C:\E2E\LocalData, every spec that runs after this one
    // would silently start reading/writing a different, unseeded folder instead of the shared
    // E2E app-data directory reset once at suite start.
    await reopenedField.click()
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    const revertSaveBtn = await $('button*=Save Local Data Folder')
    await revertSaveBtn.waitForClickable({ timeout: 10000 })
    await revertSaveBtn.click()
    const revertedSavedText = await $('div*=Saved. Files already at the previous location')
    await revertedSavedText.waitForExist({ timeout: 10000 })
    await expect(reopenedField).toHaveValue('')
  })

  it('clears media and settings-list backups when clearing existing data', async () => {
    const libraryDir = path.join(appDataDir, 'Library')
    fs.mkdirSync(libraryDir, { recursive: true })

    // A stand-in for a real .backup sibling — write_json_file only ever refreshes a
    // .backup sibling on a write that already has a previous version to preserve, and the
    // migration that seeded service-types.json ran long before this spec, so its own real
    // .backup may or may not still be from that first write. Writing this one directly makes
    // the assertion below deterministic regardless of what earlier specs happened to leave.
    const serviceTypesBackupPath = path.join(libraryDir, 'service-types.json.backup')
    fs.writeFileSync(serviceTypesBackupPath, '[]')
    // Seeded the same deterministic way — library-settings.json itself is never touched by
    // Clear Existing Data, so this backup must survive it untouched too.
    const librarySettingsBackupPath = path.join(libraryDir, 'library-settings.json.backup')
    fs.writeFileSync(librarySettingsBackupPath, '{}')

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
    expect(fs.existsSync(serviceTypesBackupPath)).toBe(false)
    // library-settings.json.backup is deliberately excluded — that file itself is never touched
    // by Clear Existing Data, so its backup shouldn't be swept away either.
    expect(fs.existsSync(librarySettingsBackupPath)).toBe(true)

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
