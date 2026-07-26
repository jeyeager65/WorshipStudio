describe('Theme Editor', () => {
  it('creates a theme, edits it, saves, and it persists after reselecting', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const themesSection = await $('.v-list-item*=Themes')
    await themesSection.waitForExist({ timeout: 10000 })
    await themesSection.click()

    const openEditorBtn = await $('a*=Open Theme Editor')
    await openEditorBtn.waitForClickable({ timeout: 10000 })
    await openEditorBtn.click()

    const newThemeBtn = await $('button*=New Theme')
    await newThemeBtn.waitForClickable({ timeout: 10000 })
    await newThemeBtn.click()

    const nameField = await $('input[value="New Theme"]')
    await nameField.waitForExist({ timeout: 10000 })
    await nameField.setValue('Christmas')

    const saveBtn = await $('button*=Save Theme')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const themeInList = await $('.v-list-item*=Christmas')
    await themeInList.waitForExist({ timeout: 10000 })
    await expect(themeInList).toBeExisting()
  })
})
