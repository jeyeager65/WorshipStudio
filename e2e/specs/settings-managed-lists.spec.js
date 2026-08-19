describe('Settings — Service Types and Song Collections', () => {
  it('adds and removes a service type', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const serviceTypesSection = await $('.v-list-item*=Service Types')
    await serviceTypesSection.waitForExist({ timeout: 10000 })
    await serviceTypesSection.click()

    const addLabel = await $('label*=Add a service type')
    await addLabel.waitForExist({ timeout: 10000 })
    const addLabelId = await addLabel.getAttribute('id')
    const addField = await $(`input[aria-labelledby="${addLabelId}"]`)
    await addField.setValue('E2E Sunrise Service')
    await browser.keys('Enter')

    // Service Types uses its own dedicated row layout (name + description + remove button),
    // not a chip list — see ServiceTypesSection.vue.
    const row = await $('.service-type-row*=E2E Sunrise Service')
    await row.waitForExist({ timeout: 10000 })
    await expect(row).toBeExisting()

    const removeIcon = await row.$('button[aria-label="Remove service type"]')
    await removeIcon.waitForClickable({ timeout: 10000 })
    await removeIcon.click()

    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    await row.waitForExist({ timeout: 10000, reverse: true })
    await expect(row).not.toBeExisting()
  })

  it('adds and removes a song collection', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const collectionsSection = await $('.v-list-item*=Song Collections')
    await collectionsSection.waitForExist({ timeout: 10000 })
    await collectionsSection.click()

    // Song Collections has its own dedicated row layout (name + bulletin abbreviation +
    // remove button) rather than the generic chip-list ManagedStringList component the
    // "service type" test above uses — see SongCollectionsSection.vue.
    const addLabel = await $('label*=Add a collection')
    await addLabel.waitForExist({ timeout: 10000 })
    const addLabelId = await addLabel.getAttribute('id')
    const addField = await $(`input[aria-labelledby="${addLabelId}"]`)
    await addField.setValue('E2E Hymnal Supplement')
    await browser.keys('Enter')

    const row = await $('.collection-row*=E2E Hymnal Supplement')
    await row.waitForExist({ timeout: 10000 })
    await expect(row).toBeExisting()

    const removeIcon = await row.$('button[aria-label="Remove collection"]')
    await removeIcon.waitForClickable({ timeout: 10000 })
    await removeIcon.click()

    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    await row.waitForExist({ timeout: 10000, reverse: true })
    await expect(row).not.toBeExisting()
  })

  it('edits a service type description, saves via the page Save button, and it persists', async () => {
    // Unlike Add/Remove above (immediate), description edits are deferred to the page's own
    // Save button for consistency with the rest of Settings — see ServiceTypesSection.vue and
    // SettingsView.vue's own comments on why.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const serviceTypesSection = await $('.v-list-item*=Service Types')
    await serviceTypesSection.waitForExist({ timeout: 10000 })
    await serviceTypesSection.click()

    const addLabel = await $('label*=Add a service type')
    await addLabel.waitForExist({ timeout: 10000 })
    const addLabelId = await addLabel.getAttribute('id')
    const addField = await $(`input[aria-labelledby="${addLabelId}"]`)
    await addField.setValue('E2E Description Type')
    await browser.keys('Enter')

    const row = await $('.service-type-row*=E2E Description Type')
    await row.waitForExist({ timeout: 10000 })
    const descriptionField = await row.$('input')
    await descriptionField.click()
    await descriptionField.addValue('E2E description text')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()
    const reopenedSection = await $('.v-list-item*=Service Types')
    await reopenedSection.waitForClickable({ timeout: 10000 })
    await reopenedSection.click()

    const reopenedRow = await $('.service-type-row*=E2E Description Type')
    await reopenedRow.waitForExist({ timeout: 10000 })
    const reopenedDescriptionField = await reopenedRow.$('input')
    await expect(reopenedDescriptionField).toHaveValue('E2E description text')

    // Clean up so this doesn't leave a permanent extra service type in the shared E2E library.
    const removeIcon = await reopenedRow.$('button[aria-label="Remove service type"]')
    await removeIcon.waitForClickable({ timeout: 10000 })
    await removeIcon.click()
    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()
    await reopenedRow.waitForExist({ timeout: 10000, reverse: true })
  })

  it('edits a song collection abbreviation, saves via the page Save button, and it persists', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const collectionsSection = await $('.v-list-item*=Song Collections')
    await collectionsSection.waitForExist({ timeout: 10000 })
    await collectionsSection.click()

    const addLabel = await $('label*=Add a collection')
    await addLabel.waitForExist({ timeout: 10000 })
    const addLabelId = await addLabel.getAttribute('id')
    const addField = await $(`input[aria-labelledby="${addLabelId}"]`)
    await addField.setValue('E2E Abbreviation Collection')
    await browser.keys('Enter')

    const row = await $('.collection-row*=E2E Abbreviation Collection')
    await row.waitForExist({ timeout: 10000 })
    const abbreviationField = await row.$('input')
    await abbreviationField.click()
    await abbreviationField.addValue('E2EAC')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()
    const reopenedSection = await $('.v-list-item*=Song Collections')
    await reopenedSection.waitForClickable({ timeout: 10000 })
    await reopenedSection.click()

    const reopenedRow = await $('.collection-row*=E2E Abbreviation Collection')
    await reopenedRow.waitForExist({ timeout: 10000 })
    const reopenedAbbreviationField = await reopenedRow.$('input')
    await expect(reopenedAbbreviationField).toHaveValue('E2EAC')

    // Clean up so this doesn't leave a permanent extra collection in the shared E2E library.
    const removeIcon = await reopenedRow.$('button[aria-label="Remove collection"]')
    await removeIcon.waitForClickable({ timeout: 10000 })
    await removeIcon.click()
    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()
    await reopenedRow.waitForExist({ timeout: 10000, reverse: true })
  })
})
