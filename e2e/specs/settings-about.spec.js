describe('Settings — About', () => {
  it('shows the version and copies a diagnostic summary', async () => {
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const aboutSection = await $('.v-list-item*=About')
    await aboutSection.waitForExist({ timeout: 10000 })
    await aboutSection.click()

    const versionText = await $('.about-version')
    await versionText.waitForExist({ timeout: 10000 })
    const text = await versionText.getText()
    // A real semver-ish build (e.g. "Version 0.7.0"), not the "…" loading placeholder.
    // getText() reflects the rendered text, and .about-version applies text-transform:
    // uppercase, so match case-insensitively.
    await expect(text).toMatch(/Version \d+\.\d+\.\d+/i)

    // Copying the diagnostic summary needs no native dialog (unlike "Open Logs Folder"/"Export
    // Diagnostic Bundle", which open a real OS file browser/save dialog — skipped for the same
    // reason "Browse…" buttons are skipped elsewhere in this suite) — safe to actually click.
    const copyBtn = await $('button*=Copy Diagnostic Summary')
    await copyBtn.waitForClickable({ timeout: 10000 })
    await copyBtn.click()

    const statusAlert = await $('div*=Diagnostic summary copied')
    await statusAlert.waitForExist({ timeout: 10000 })
    await expect(statusAlert).toBeExisting()
  })

  it('checks for updates and settles into a real outcome', async () => {
    // A genuine network call to GitHub (stores/tauriUpdate.ts), so the actual outcome (up to
    // date / an update available / a network error) isn't something to assert on — this just
    // confirms the button and store wiring work end to end, not what today's real answer is.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const aboutSection = await $('.v-list-item*=About')
    await aboutSection.waitForExist({ timeout: 10000 })
    await aboutSection.click()

    const checkBtn = await $('button*=Check for Updates')
    await checkBtn.waitForClickable({ timeout: 10000 })
    await checkBtn.click()

    const upToDate = await $("p*=You're up to date")
    const updateAvailable = await $('button*=Install Now')
    const checkFailed = await $('.v-alert')
    await browser.waitUntil(
      async () =>
        (await upToDate.isExisting()) ||
        (await updateAvailable.isExisting()) ||
        (await checkFailed.isExisting()),
      { timeout: 15000, timeoutMsg: 'Check for Updates never settled into any visible outcome' },
    )
  })
})
