describe('Settings — Service Types and Song Collections', () => {
  it('adds and removes a service type', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
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

    const chip = await $('.v-chip*=E2E Sunrise Service')
    await chip.waitForExist({ timeout: 10000 })
    await expect(chip).toBeExisting()

    const closeIcon = await chip.$('.v-chip__close')
    await closeIcon.waitForClickable({ timeout: 10000 })
    await closeIcon.click()

    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    await chip.waitForExist({ timeout: 10000, reverse: true })
    await expect(chip).not.toBeExisting()
  })

  it('adds and removes a song collection', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const collectionsSection = await $('.v-list-item*=Song Collections')
    await collectionsSection.waitForExist({ timeout: 10000 })
    await collectionsSection.click()

    const addLabel = await $('label*=Add a collection')
    await addLabel.waitForExist({ timeout: 10000 })
    const addLabelId = await addLabel.getAttribute('id')
    const addField = await $(`input[aria-labelledby="${addLabelId}"]`)
    await addField.setValue('E2E Hymnal Supplement')
    await browser.keys('Enter')

    const chip = await $('.v-chip*=E2E Hymnal Supplement')
    await chip.waitForExist({ timeout: 10000 })
    await expect(chip).toBeExisting()

    const closeIcon = await chip.$('.v-chip__close')
    await closeIcon.waitForClickable({ timeout: 10000 })
    await closeIcon.click()

    const confirmBtn = await $('button*=Remove')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    await chip.waitForExist({ timeout: 10000, reverse: true })
    await expect(chip).not.toBeExisting()
  })
})
