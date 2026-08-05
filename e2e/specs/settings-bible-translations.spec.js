describe('Settings — Bible Translations', () => {
  it('shows KJV as the default and persists an ESV API key across a save', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const bibleSection = await $('.v-list-item*=Bible Translations')
    await bibleSection.waitForExist({ timeout: 10000 })
    await bibleSection.click()

    // KJV is bundled and always resolvable, with no API key required — it should already show
    // as the default in a library with no ESV/api.bible key configured (the isolated E2E
    // app-data directory starts empty on every run, see helpers/appDataDir.js).
    const kjvCard = await $('.translation-card*=King James Version')
    await kjvCard.waitForExist({ timeout: 10000 })
    const defaultBadge = await kjvCard.$('span*=Default')
    await expect(defaultBadge).toBeExisting()

    // The ESV/api.bible keys themselves aren't verifiable without real credentials and a live
    // network call (the catalog picker needs a working api.bible key) — just confirm the key
    // field round-trips through a real save, the same depth external-apps.spec.js uses for its
    // own credential-shaped fields.
    const esvLabel = await $('label*=ESV API key')
    await esvLabel.waitForExist({ timeout: 10000 })
    const esvLabelId = await esvLabel.getAttribute('id')
    const esvField = await $(`input[aria-labelledby="${esvLabelId}"]`)
    await esvField.setValue('e2e-test-esv-key')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedSection = await $('.v-list-item*=Bible Translations')
    await reopenedSection.waitForClickable({ timeout: 10000 })
    await reopenedSection.click()

    const reopenedLabel = await $('label*=ESV API key')
    await reopenedLabel.waitForExist({ timeout: 10000 })
    const reopenedLabelId = await reopenedLabel.getAttribute('id')
    const reopenedField = await $(`input[aria-labelledby="${reopenedLabelId}"]`)
    await expect(reopenedField).toHaveValue('e2e-test-esv-key')
  })
})
