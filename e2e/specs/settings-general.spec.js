describe('Settings — This Computer', () => {
  it('edits the computer name, saves, and it persists after navigating away and back', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    // "This Computer" is the default section, already active on arrival.
    const nameLabel = await $('label*=Computer name')
    await nameLabel.waitForExist({ timeout: 10000 })
    const labelId = await nameLabel.getAttribute('id')
    const nameField = await $(`input[aria-labelledby="${labelId}"]`)
    // clearValue() alone doesn't stick here — Vuetify's controlled input re-syncs the DOM
    // value from the (still-old) model on its next render tick, right before setValue()'s
    // keystrokes land, so the new text ends up appended after the old. Select-all + Backspace
    // fires real input events Vue observes, emptying the model first.
    await nameField.click()
    // WDIO's keys() toggles modifier keys — a lone 'Control' entry presses it down and never
    // releases it, corrupting every later keystroke/click in the session, so it must appear
    // twice (down, then up again) to actually let go.
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await nameField.addValue('E2E Renamed Machine')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    // Navigate away and back within the SPA (same "did it really persist" check
    // theme-editor.spec.js uses) rather than a hard reload.
    const servicesNav = await $('a[href="/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedLabel = await $('label*=Computer name')
    await reopenedLabel.waitForExist({ timeout: 10000 })
    const reopenedLabelId = await reopenedLabel.getAttribute('id')
    const reopenedField = await $(`input[aria-labelledby="${reopenedLabelId}"]`)
    await expect(reopenedField).toHaveValue('E2E Renamed Machine')
  })

  it('"Run Setup Wizard" opens the guided setup', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const wizardBtn = await $('button*=Run Setup Wizard')
    await wizardBtn.waitForClickable({ timeout: 10000 })
    await wizardBtn.click()

    const welcomeHeading = await $('h1*=Set up Worship Studio')
    await welcomeHeading.waitForExist({ timeout: 10000 })
    await expect(welcomeHeading).toBeExisting()
  })
})
