describe('Planning Ahead', () => {
  it('lists a future service, flagging a missing sermon title and preacher', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const createLink = await $('a*=Create Service')
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

    const submit = await $('button*=Create and Open Service')
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

    // Every month with an upcoming service gets its own entry in the month sidebar (no
    // placeholder "empty" months in between) — click September 2026's directly rather than
    // paging through a prev/next control.
    const monthOption = await $('.month-option*=September 2026')
    await monthOption.waitForExist({ timeout: 10000 })
    await monthOption.click()
    const monthHeading = await $('.month-toolbar h2')
    await expect(monthHeading).toHaveText(expect.stringContaining('September 2026'))

    const titleNotDecided = await $('span*=Title Not Decided')
    await expect(titleNotDecided).toBeExisting()

    const needsPreacher = await $('span*=Needs Preacher')
    await expect(needsPreacher).toBeExisting()

    const notStarted = await $('.planning-state*=Not Started')
    await expect(notStarted).toBeExisting()

    // Clicking the row opens the service directly (feature-spec.md's row-click behavior),
    // not just a link within it.
    const row = await $('.planning-row')
    await row.click()
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForExist({ timeout: 10000 })
    await expect(saveBtn).toBeExisting()
  })
})
