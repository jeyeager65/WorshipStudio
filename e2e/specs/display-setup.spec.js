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
    // worked — the old placeholder invoke stub had nothing behind it at all. Scoped to the
    // name/resolution copy block's own <span> (not just "div*=x") since a plain div-level
    // query also picks up the sibling <strong> name text in the same container.
    const resolutionText = await $('.display-setting-copy span')
    await resolutionText.waitForExist({ timeout: 10000 })
    const text = await resolutionText.getText()
    await expect(text).toMatch(/^\d+x\d+$/)

    // Single-monitor machines intentionally disable the role picker (see
    // utils/displaySetup.ts's needsSingleMonitorFallback — there's nowhere to send a separate
    // audience output, so offering the choice would be misleading). Genuine multi-monitor
    // machines get a real, usable role picker instead — assert whichever is actually true
    // rather than hardcoding one machine's monitor count.
    const rows = await $$('.display-setting-row')
    const singleMonitorAlert = await $('div*=Only one display detected')
    if (rows.length <= 1) {
      await expect(singleMonitorAlert).toBeExisting()
    } else {
      await expect(singleMonitorAlert).not.toBeExisting()
    }
  })
})
