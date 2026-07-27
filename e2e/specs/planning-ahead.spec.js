describe('Planning Ahead', () => {
  it('lists a future service, flagging a missing sermon title and preacher', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const createLink = await $('a*=Create New Service')
    await createLink.waitForExist({ timeout: 15000 })
    await createLink.click()

    // Leaving Sermon Title and Preacher blank on purpose — Planning Ahead's whole point is
    // surfacing that gap before it becomes a last-minute problem.
    //
    // Native <input type="date"> fields don't behave like text inputs under setValue() —
    // WebdriverIO's keystrokes land in whichever date *segment* (month/day/year) currently
    // has focus rather than replacing the whole value, which silently produced a corrupted
    // date (e.g. year "60915") the first time this test ran. Setting .value directly and
    // dispatching input/change is the reliable way to drive this control.
    const dateField = await $('input[type="date"]')
    await dateField.waitForExist({ timeout: 10000 })
    await browser.execute((el, value) => {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, dateField, '2026-09-15')

    const submit = await $('button*=Create & Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    const workspaceSaveBtn = await $('button*=Save')
    await workspaceSaveBtn.waitForClickable({ timeout: 15000 })
    await workspaceSaveBtn.click()

    const homeLink = await $('a*=Services')
    await homeLink.waitForClickable({ timeout: 10000 })
    await homeLink.click()

    const planningAheadLink = await $('a*=Planning Ahead')
    await planningAheadLink.waitForExist({ timeout: 10000 })
    await planningAheadLink.click()

    // Month groups only exist for months that actually have an upcoming service (no
    // placeholder "empty" months in between), so September 2026 may or may not be the first
    // group shown depending on what else exists in this profile — page forward with "next
    // month" until it's showing, stopping once the button disables (no more months) rather
    // than looping forever if something's wrong.
    const monthHeading = await $('.text-h6')
    await monthHeading.waitForExist({ timeout: 10000 })
    for (let i = 0; i < 12; i++) {
      const heading = await $('.text-h6').getText()
      if (heading.includes('September 2026')) break
      // The icon itself has pointer-events disabled (standard for icon fonts) — the
      // clickable target is its containing button.
      const chevronBtn = await $('button:has(.mdi-chevron-right)')
      if (!(await chevronBtn.isEnabled())) break
      await chevronBtn.click()
    }
    await expect($('.text-h6')).toHaveText(expect.stringContaining('September 2026'))

    const notYetDecided = await $('span*=Not yet decided')
    await expect(notYetDecided).toBeExisting()

    // These two are v-chips — their text sits inside a nested .v-chip__content span rather
    // than as a direct text node of the chip itself, so they're matched by getText() on the
    // chip's own class rather than the `tag*=text` shorthand (which only matches the direct
    // text node) as used above.
    const chips = await $$('.v-chip')
    const chipTexts = []
    for (const chip of chips) {
      chipTexts.push(await chip.getText())
    }
    expect(chipTexts).toContain('Needs Preacher')
    expect(chipTexts).toContain('Not started')

    // Clicking the row opens the service directly (feature-spec.md's row-click behavior),
    // not just a link within it.
    const row = await $('.planning-row')
    await row.click()
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForExist({ timeout: 10000 })
    await expect(saveBtn).toBeExisting()
  })
})
