describe('Settings — Canva', () => {
  it('edits the church integration credentials, saves, and they persist', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const canvaSection = await $('.v-list-item*=Canva')
    await canvaSection.waitForExist({ timeout: 10000 })
    await canvaSection.click()

    const clientIdLabel = await $('label*=Canva client ID')
    await clientIdLabel.waitForExist({ timeout: 10000 })
    const clientIdLabelId = await clientIdLabel.getAttribute('id')
    const clientIdField = await $(`input[aria-labelledby="${clientIdLabelId}"]`)
    // clearValue() alone doesn't stick here — Vuetify's controlled input re-syncs the DOM
    // value from the (still-old) model on its next render tick, right before setValue()'s
    // keystrokes land, so the new text ends up appended after the old. Select-all + Backspace
    // fires real input events Vue observes, emptying the model first.
    await clientIdField.click()
    // WDIO's keys() toggles modifier keys — a lone 'Control' entry presses it down and never
    // releases it, corrupting every later keystroke/click in the session, so it must appear
    // twice (down, then up again) to actually let go.
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await clientIdField.addValue('e2e-test-client-id')

    const clientSecretLabel = await $('label*=Canva client secret')
    await clientSecretLabel.waitForExist({ timeout: 10000 })
    const clientSecretLabelId = await clientSecretLabel.getAttribute('id')
    const clientSecretField = await $(`input[aria-labelledby="${clientSecretLabelId}"]`)
    await clientSecretField.click()
    // WDIO's keys() toggles modifier keys — a lone 'Control' entry presses it down and never
    // releases it, corrupting every later keystroke/click in the session, so it must appear
    // twice (down, then up again) to actually let go.
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await clientSecretField.addValue('e2e-test-client-secret')

    // The registered callback URL is derived from the (fixed, Remote-Control-independent)
    // callback port — confirms the two fields' worth of setup instructions actually reflect
    // real state rather than a hardcoded placeholder.
    const callbackCode = await $('.canva-setup-steps code')
    const callbackText = await callbackCode.getText()
    await expect(callbackText).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/canva\/callback$/)

    // "Connect This Computer" needs a real OAuth round trip through a browser — not something
    // this suite can drive, same reasoning as skipping native file dialogs elsewhere.
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedSection = await $('.v-list-item*=Canva')
    await reopenedSection.waitForClickable({ timeout: 10000 })
    await reopenedSection.click()

    const reopenedIdLabel = await $('label*=Canva client ID')
    await reopenedIdLabel.waitForExist({ timeout: 10000 })
    const reopenedIdLabelId = await reopenedIdLabel.getAttribute('id')
    const reopenedIdField = await $(`input[aria-labelledby="${reopenedIdLabelId}"]`)
    await expect(reopenedIdField).toHaveValue('e2e-test-client-id')

    const reopenedSecretLabel = await $('label*=Canva client secret')
    await reopenedSecretLabel.waitForExist({ timeout: 10000 })
    const reopenedSecretLabelId = await reopenedSecretLabel.getAttribute('id')
    const reopenedSecretField = await $(`input[aria-labelledby="${reopenedSecretLabelId}"]`)
    await expect(reopenedSecretField).toHaveValue('e2e-test-client-secret')
  })
})
