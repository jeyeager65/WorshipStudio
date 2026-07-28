describe('Worship Studio (native)', () => {
  it('loads the landing page', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — skip through it so this test still asserts the landing page,
    // not the wizard, regardless of which state this profile is in.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const heading = await $('p*=Select a service to continue')
    await heading.waitForExist({ timeout: 15000 })
    await expect(heading).toBeExisting()
  })

  it('creates a service and shows all five Add-to-Service tabs without any large library present', async () => {
    const createLink = await $('a*=Create New Service')
    await createLink.waitForExist({ timeout: 10000 })
    await createLink.click()

    const submit = await $('button*=Create & Open Service')
    await submit.waitForExist({ timeout: 10000 })
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    const addButton = await $('button*=Add to Service')
    await addButton.waitForExist({ timeout: 15000 })
    await addButton.waitForClickable({ timeout: 10000 })
    await addButton.click()

    // The Add-to-Service dialog picks its content type via a "Type" dropdown (not tabs) —
    // confirms every core content type still shows up as an option, regardless of song-library
    // size (the flexbox-shrink bug this originally guarded against, fixed in commit 3997ac6,
    // no longer applies now that the dialog is a fixed-size card with its own internal scroll).
    const typeSelect = await $('.v-dialog .v-select')
    await typeSelect.waitForClickable({ timeout: 10000 })
    await typeSelect.click()
    // Scoped to the open menu's own overlay content — the persistent left nav also has
    // .v-list-item entries named Songs/Slides/Media, which an unscoped query would match
    // instead (and actually navigate away from the service, not just fail the assertion).
    const overlay = await $('[role="listbox"]')
    for (const label of ['Songs', 'Scripture', 'Slides', 'Media', 'Video']) {
      const option = await overlay.$(`.v-list-item*=${label}`)
      await option.waitForExist({ timeout: 10000 })
      await expect(option).toBeDisplayed()
    }
    await browser.keys('Escape')

    const cancel = await $('button=Cancel')
    await expect(cancel).toBeDisplayed()
  })
})
