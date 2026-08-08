describe('Settings — Appearance', () => {
  it('toggles dark mode and it persists after navigating away and back', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const appearanceSection = await $('.v-list-item*=Appearance')
    await appearanceSection.waitForExist({ timeout: 10000 })
    await appearanceSection.click()

    const darkModeSwitch = await $('input[aria-label="Dark mode"]')
    await darkModeSwitch.waitForExist({ timeout: 10000 })
    const wasChecked = await darkModeSwitch.isSelected()
    const expectedAfterToggle = !wasChecked

    await darkModeSwitch.click()
    await browser.waitUntil(async () => (await darkModeSwitch.isSelected()) === expectedAfterToggle, {
      timeout: 5000,
    })

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedAppearance = await $('.v-list-item*=Appearance')
    await reopenedAppearance.waitForClickable({ timeout: 10000 })
    await reopenedAppearance.click()

    const reopenedSwitch = await $('input[aria-label="Dark mode"]')
    await reopenedSwitch.waitForExist({ timeout: 10000 })
    await expect(await reopenedSwitch.isSelected()).toBe(expectedAfterToggle)
  })
})
