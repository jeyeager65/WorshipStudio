describe('Settings — Library & Sync data tools', () => {
  it('loads sample data after confirming the destructive-action warning', async () => {
    // The library path picker/portable-folder buttons aren't covered here — actually changing
    // the library path would point this test (and the reload prompt it triggers) at a
    // different folder entirely, which isn't safely reversible mid-test. "Check Now"/sync
    // health is already covered by sync-conflicts.spec.js. Sample data is the one remaining,
    // safe-to-drive action: it's isolated to this spec's own empty E2E app-data directory (see
    // helpers/appDataDir.js).
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()

    const loadSampleBtn = await $('button*=Load Sample Data')
    await loadSampleBtn.waitForClickable({ timeout: 10000 })
    await loadSampleBtn.click()

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
    const servicesNav = await $('a[href="/"]')
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
})
