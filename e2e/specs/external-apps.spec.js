describe('External App Hand-off', () => {
  it('creates, edits, and deletes an external app profile', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const externalAppsSection = await $('.v-list-item*=External Apps')
    await externalAppsSection.waitForExist({ timeout: 10000 })
    await externalAppsSection.click()

    const addBtn = await $('button*=Add Profile')
    await addBtn.waitForClickable({ timeout: 10000 })
    await addBtn.click()

    // Fields aren't individually id'd, so they're targeted positionally within the dialog —
    // same approach assignments.spec.js uses for its add-person dialog. With "Launch
    // Automatically" selected by default (it is, out of the box), the order is
    // Name, Executable, Parameter Format. Waiting for all 3 inputs (not just the dialog's
    // existence) so the open transition has actually finished before typing into it.
    await browser.waitUntil(async () => (await $$('.v-dialog input')).length >= 3, { timeout: 10000 })
    const dialogInputs = await $$('.v-dialog input')
    await dialogInputs[0].setValue('Notepad E2E Test')

    // Filling the Executable field directly rather than clicking "Browse…" — that opens a
    // native OS file picker WebdriverIO can't drive, the same reasoning the rest of this
    // suite uses for skipping native dialogs. "Test Launch" and "Recapture Position" are
    // skipped for the same reason: both trigger real Win32 window focus/positioning that
    // could interfere with the E2E harness's own window tracking.
    await dialogInputs[1].setValue('C:\\Windows\\System32\\notepad.exe')
    await dialogInputs[2].setValue('"{file}"')

    const preview = await $('div*=Will run:')
    await preview.waitForExist({ timeout: 5000 })
    const previewText = await preview.getText()
    await expect(previewText).toContain('notepad.exe "C:\\Services\\Example.pptx"')

    const saveBtn = await $('button*=Save Profile')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const savedProfile = await $('.v-list-item-title*=Notepad E2E Test')
    await savedProfile.waitForExist({ timeout: 10000 })
    await expect(savedProfile).toBeExisting()

    // Reopen it and confirm the fields round-tripped through a real save/reload. Only one
    // profile exists on screen at this point, so the icon can be targeted directly with a
    // flat selector rather than scoping a query off a separately-fetched row element.
    const editIcon = await $('.mdi-pencil-outline')
    await editIcon.waitForClickable({ timeout: 10000 })
    await editIcon.click()

    await browser.waitUntil(async () => (await $$('.v-dialog input')).length >= 3, { timeout: 10000 })
    const reopenedExecInput = (await $$('.v-dialog input'))[1]
    await expect(reopenedExecInput).toHaveValue('C:\\Windows\\System32\\notepad.exe')

    const cancelBtn = await $('button*=Cancel')
    await cancelBtn.click()

    // Clean up: delete the test profile so it doesn't linger in the real dev profile's
    // external-apps.json.
    const deleteIcon = await $('.mdi-trash-can-outline')
    await deleteIcon.waitForClickable({ timeout: 10000 })
    await deleteIcon.click()

    const confirmBtn = await $('button*=Delete')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    const goneProfile = await $('.v-list-item-title*=Notepad E2E Test')
    await goneProfile.waitForExist({ timeout: 10000, reverse: true })
    await expect(goneProfile).not.toBeExisting()
  })
})
