describe('Worship Studio (native)', () => {
  it('loads the landing page', async () => {
    const heading = await $('p*=Select a service to continue')
    await heading.waitForExist({ timeout: 15000 })
    await expect(heading).toBeExisting()
  })

  it('creates a service and shows all three Add-to-Service tabs without any large library present', async () => {
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

    // Regression check for the flexbox-shrink bug (fixed in commit 3997ac6): the tabs bar
    // must stay visible regardless of song-library size, not just when the library is small.
    for (const label of ['Songs', 'Scripture', 'Slides']) {
      const tab = await $(`.v-tab*=${label}`)
      await tab.waitForExist({ timeout: 10000 })
      await expect(tab).toBeDisplayed()
    }

    const cancel = await $('button=Cancel')
    await expect(cancel).toBeDisplayed()
  })
})
