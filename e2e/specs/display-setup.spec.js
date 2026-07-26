describe('Display Setup', () => {
  it('lists real detected monitors with a resolution from actual OS enumeration', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const displaySection = await $('.v-list-item*=Display Setup')
    await displaySection.waitForExist({ timeout: 10000 })
    await displaySection.click()

    // A resolution string like "1920x1080" only shows up if real OS monitor enumeration
    // worked — the old placeholder invoke stub had nothing behind it at all. Scoped to
    // .settings-content (not just "div*=x") since the sidebar nav also has labels containing
    // "x" (e.g. "External Apps").
    const resolutionText = await $('.settings-content').$('div*=x')
    await resolutionText.waitForExist({ timeout: 10000 })
    const text = await resolutionText.getText()
    await expect(text).toMatch(/^\d+x\d+$/)

    // This CI/dev machine has a single monitor, which intentionally disables the role
    // picker (see utils/displaySetup.ts's needsSingleMonitorFallback — there's nowhere to
    // send a separate audience output, so offering the choice would be misleading). Assigning
    // a role on a genuine multi-monitor machine is covered by the Rust-level round-trip test
    // for MachineSettings.display_roles instead of here.
    const singleMonitorAlert = await $('div*=Only one display detected')
    await expect(singleMonitorAlert).toBeExisting()
  })
})
