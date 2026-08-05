describe('Settings — Branding', () => {
  it('edits church name and brand colors, saves, and they persist after navigating away and back', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const brandingSection = await $('.v-list-item*=Branding')
    await brandingSection.waitForExist({ timeout: 10000 })
    await brandingSection.click()

    const nameLabel = await $('label*=Church or ministry name')
    await nameLabel.waitForExist({ timeout: 10000 })
    const nameLabelId = await nameLabel.getAttribute('id')
    const nameField = await $(`input[aria-labelledby="${nameLabelId}"]`)
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
    await nameField.addValue('E2E Community Church')

    // The color swatches are a native <input type="color">, and the text field next to each
    // is the two-way-bound hex value — editing the text field is the reliable, driver-friendly
    // way in (a native OS color-picker popup isn't something WebdriverIO can drive, same
    // reasoning as skipping "Browse…" file dialogs elsewhere in this suite). The "Primary
    // color" text is a plain static <span> (not a Vuetify label prop), so there's no
    // aria-labelledby link — select structurally instead: the first .branding-color-field's
    // text input that isn't the native color swatch (type="color").
    const primaryField = await $('.branding-color-field').$('input:not([type="color"])')
    await primaryField.waitForExist({ timeout: 10000 })
    await primaryField.click()
    // WDIO's keys() toggles modifier keys — a lone 'Control' entry presses it down and never
    // releases it, corrupting every later keystroke/click in the session, so it must appear
    // twice (down, then up again) to actually let go.
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await primaryField.addValue('#112233')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedBranding = await $('.v-list-item*=Branding')
    await reopenedBranding.waitForClickable({ timeout: 10000 })
    await reopenedBranding.click()

    const reopenedNameLabel = await $('label*=Church or ministry name')
    await reopenedNameLabel.waitForExist({ timeout: 10000 })
    const reopenedNameLabelId = await reopenedNameLabel.getAttribute('id')
    const reopenedNameField = await $(`input[aria-labelledby="${reopenedNameLabelId}"]`)
    await expect(reopenedNameField).toHaveValue('E2E Community Church')

    const reopenedPrimaryField = await $('.branding-color-field').$('input:not([type="color"])')
    await reopenedPrimaryField.waitForExist({ timeout: 10000 })
    await expect(reopenedPrimaryField).toHaveValue('#112233')

    // The live preview reflects the same identity — confirms the fields actually drive the
    // document-branding preview, not just their own inputs.
    const previewName = await $('.branding-document-preview strong')
    await expect(previewName).toHaveText('E2E Community Church')
  })
})
