describe('Theme Editor', () => {
  it('creates a theme, edits it, saves, and it persists after reselecting', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    // Themes moved out of Settings into its own top-level "Design" sidebar section.
    const themesNav = await $('a[href="#/library/themes"]')
    await themesNav.waitForExist({ timeout: 15000 })
    await themesNav.click()

    const newThemeBtn = await $('button*=New Theme')
    await newThemeBtn.waitForClickable({ timeout: 10000 })
    await newThemeBtn.click()

    // Vuetify 4 links input -> label via aria-labelledby (not a `for` attribute on the label).
    const nameLabel = await $('label*=Theme name')
    await nameLabel.waitForExist({ timeout: 10000 })
    const labelId = await nameLabel.getAttribute('id')
    const nameField = await $(`input[aria-labelledby="${labelId}"]`)
    await nameField.setValue('Christmas')

    // Saving is the same persistent app-bar "Save" button every other editor in the app uses
    // now, not a page-specific "Save Theme" button.
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    const backToThemes = await $('a*=Presentation Themes')
    await backToThemes.waitForClickable({ timeout: 10000 })
    await backToThemes.click()

    const themeInList = await $('.theme-card*=Christmas')
    await themeInList.waitForExist({ timeout: 10000 })
    await expect(themeInList).toBeExisting()
  })
})
