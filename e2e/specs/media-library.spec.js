describe('Media Library', () => {
  it('loads the grid and opens/cancels the Import Media dialog', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const mediaNav = await $('a[href="/library/media"]')
    await mediaNav.waitForExist({ timeout: 15000 })
    await mediaNav.click()

    const heading = await $('h1*=Media Library')
    await heading.waitForExist({ timeout: 10000 })

    const importBtn = await $('button*=Import Media')
    await importBtn.waitForClickable({ timeout: 10000 })
    await importBtn.click()

    const dialogTitle = await $('.v-card-title*=Import Media')
    await dialogTitle.waitForExist({ timeout: 10000 })

    // Deliberately not clicking "Browse for images and video loops…" here — it opens a real
    // native OS file dialog, which WebdriverIO/tauri-driver can't drive and would hang the run.
    const cancelBtn = await $('button*=Cancel')
    await cancelBtn.waitForClickable({ timeout: 10000 })
    await cancelBtn.click()

    await dialogTitle.waitForExist({ timeout: 10000, reverse: true })
  })
})
