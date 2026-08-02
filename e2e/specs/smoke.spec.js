describe('Worship Studio (native)', () => {
  it('loads the landing page', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — skip through it so this test still asserts the landing page,
    // not the wizard, regardless of which state this profile is in.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const heading = await $('.services-hero').then((el) => el.$('h1*=Services'))
    await heading.waitForExist({ timeout: 15000 })
    await expect(heading).toBeExisting()
  })

  it('creates a service and shows all five Add-to-Service item types without any large library present', async () => {
    const createLink = await $('a*=Create Service')
    await createLink.waitForExist({ timeout: 10000 })
    await createLink.click()

    const submit = await $('button*=Create and Open Service')
    await submit.waitForExist({ timeout: 10000 })
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    // "Add Item" opens a menu of item types directly (no Type dropdown inside a dialog
    // anymore) — confirms every core content type still shows up as an option, regardless of
    // song-library size (the flexbox-shrink bug this originally guarded against no longer
    // applies now that this is a plain anchored menu, not a shrinking flex dialog).
    const addButton = await $('button*=Add Item')
    await addButton.waitForExist({ timeout: 15000 })
    await addButton.waitForClickable({ timeout: 10000 })
    await addButton.click()

    const menu = await $('.add-item-menu')
    await menu.waitForExist({ timeout: 10000 })
    for (const label of ['Song', 'Scripture', 'Slides', 'Media', 'Video']) {
      const option = await menu.$(`.v-list-item*=${label}`)
      await option.waitForExist({ timeout: 10000 })
      await expect(option).toBeDisplayed()
    }
    await browser.keys('Escape')
    await menu.waitForExist({ timeout: 5000, reverse: true })
  })
})
