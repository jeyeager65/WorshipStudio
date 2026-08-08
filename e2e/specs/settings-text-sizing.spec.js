describe('Settings — Text Sizing', () => {
  it('edits a font size range, saves, and it persists after navigating away and back', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const textSizingSection = await $('.v-list-item*=Text Sizing')
    await textSizingSection.waitForExist({ timeout: 10000 })
    await textSizingSection.click()

    const minLabel = await $('label*=Minimum size')
    await minLabel.waitForExist({ timeout: 10000 })
    const minLabelId = await minLabel.getAttribute('id')
    const minField = await $(`input[aria-labelledby="${minLabelId}"]`)
    // clearValue() alone doesn't stick here — Vuetify's controlled input re-syncs the DOM
    // value from the (still-old) model on its next render tick, right before setValue()'s
    // keystrokes land, so the new text ends up appended after the old. Select-all + Backspace
    // fires real input events Vue observes, emptying the model first.
    await minField.click()
    // WDIO's keys() toggles modifier keys — a lone 'Control' entry presses it down and never
    // releases it, corrupting every later keystroke/click in the session, so it must appear
    // twice (down, then up again) to actually let go.
    await browser.keys(['Control', 'a', 'Control'])
    await browser.keys('Backspace')
    await minField.addValue('64')

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const servicesNav = await $('a[href="#/"]')
    await servicesNav.waitForClickable({ timeout: 10000 })
    await servicesNav.click()
    await settingsNav.waitForClickable({ timeout: 10000 })
    await settingsNav.click()

    const reopenedSection = await $('.v-list-item*=Text Sizing')
    await reopenedSection.waitForClickable({ timeout: 10000 })
    await reopenedSection.click()

    const reopenedMinLabel = await $('label*=Minimum size')
    await reopenedMinLabel.waitForExist({ timeout: 10000 })
    const reopenedMinLabelId = await reopenedMinLabel.getAttribute('id')
    const reopenedMinField = await $(`input[aria-labelledby="${reopenedMinLabelId}"]`)
    await expect(reopenedMinField).toHaveValue('64')
  })
})
