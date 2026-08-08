describe('Announcements (bulletin)', () => {
  it('adds, lists, and deletes an announcement against the real Tauri backend', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const navLink = await $('a[href="#/announcements"]')
    await navLink.waitForExist({ timeout: 15000 })
    await navLink.click()

    const heading = await $('h1*=Announcements')
    await heading.waitForExist({ timeout: 10000 })

    const addBtn = await $('button*=Add Announcement')
    await addBtn.waitForClickable({ timeout: 10000 })
    await addBtn.click()

    const dialog = await $('.v-dialog')
    await dialog.waitForExist({ timeout: 10000 })

    const textField = await dialog.$('textarea')
    await textField.waitForExist({ timeout: 10000 })
    await textField.setValue('E2E test announcement')

    // Defaults to the event-dated pattern, which needs a date before it can save. Native
    // <input type="date"> fields don't behave like text inputs under setValue() — WebdriverIO's
    // keystrokes land in whichever date *segment* has focus rather than replacing the whole
    // value (see planning-ahead.spec.js's identical note) — setting .value directly and
    // dispatching input/change is the reliable way to drive this control.
    const dateField = await dialog.$('input[type="date"]')
    await dateField.waitForExist({ timeout: 5000 })
    await browser.execute(
      (el, value) => {
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      },
      dateField,
      '2026-12-25',
    )

    const saveBtn = await dialog.$('button*=Save')
    await saveBtn.waitForClickable({ timeout: 5000 })
    await saveBtn.click()

    const listedText = await $('p*=E2E test announcement')
    await listedText.waitForExist({ timeout: 10000 })
    await expect(listedText).toBeExisting()

    const deleteBtn = await $('button[aria-label="Delete"]')
    await deleteBtn.waitForClickable({ timeout: 10000 })
    await deleteBtn.click()
    const confirmBtn = await $('button*=Delete')
    await confirmBtn.waitForClickable({ timeout: 5000 })
    await confirmBtn.click()

    await listedText.waitForExist({ timeout: 10000, reverse: true })
  })
})
