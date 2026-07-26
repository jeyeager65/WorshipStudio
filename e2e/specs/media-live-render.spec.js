describe('Real media rendering in the operator preview', () => {
  it('shows an actual loaded image, not a placeholder label, for a Media item', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const createLink = await $('a*=Create New Service')
    await createLink.waitForExist({ timeout: 15000 })
    await createLink.click()
    const submit = await $('button*=Create & Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    const addButton = await $('button*=Add to Service')
    await addButton.waitForExist({ timeout: 15000 })
    await addButton.waitForClickable({ timeout: 10000 })
    await addButton.click()

    const mediaTab = await $('.v-tab*=Media')
    await mediaTab.waitForExist({ timeout: 10000 })
    await mediaTab.click()

    // Reuses the real "SimplePhoto.jpg" fixture already sitting in this dev profile's Media
    // Library from earlier work (Media Library phase) — no new fixture needed.
    const photoEntry = await $('.v-list-item*=SimplePhoto')
    await photoEntry.waitForClickable({ timeout: 10000 })
    await photoEntry.click()

    // Adding closes the dialog and selects the new item — its preview should now show a real
    // <img>, resolved through get_media_file_path + convertFileSrc, not the old plain-text
    // "Click to make this item live." placeholder.
    const image = await $('img.media-preview')
    await image.waitForExist({ timeout: 10000 })

    const naturalWidth = await browser.execute((el) => el.naturalWidth, image)
    expect(naturalWidth).toBeGreaterThan(0)

    const src = await image.getAttribute('src')
    expect(src).not.toBe('')
    expect(src.startsWith('http')).toBe(true)
  })
})
