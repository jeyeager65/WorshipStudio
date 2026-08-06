describe('Order of Worship Export', () => {
  it('renders a preview from the service and copies it as text', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const createLink = await $('a*=Create Service')
    await createLink.waitForExist({ timeout: 15000 })
    await createLink.click()
    const submit = await $('button*=Create and Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    // A freshly created service is a draft (unsaved) until Save is pressed.
    const workspaceSaveBtn = await $('button*=Save')
    await workspaceSaveBtn.waitForClickable({ timeout: 15000 })
    await workspaceSaveBtn.click()

    const oowLink = await $('a*=Bulletin')
    await oowLink.waitForExist({ timeout: 15000 })
    await oowLink.click()

    const heading = await $('h2*=Order of Worship')
    await heading.waitForExist({ timeout: 10000 })

    // Copy only applies to the Classic style (Modern, the page's default, is PDF-only) — switch
    // to it first so the Copy button is present and active.
    const styleSelect = await $('.style-picker')
    await styleSelect.click()
    const classicOption = await $('.v-list-item*=Classic')
    await classicOption.waitForExist({ timeout: 5000 })
    await classicOption.click()

    // Deliberately not clicking "Open Word"/"Open PDF" here — both trigger OS-level behavior
    // (a file save / the default viewer) that WebdriverIO can't drive and would risk hanging
    // the run, the same reasoning as skipping native file dialogs elsewhere in this suite.
    const copyTextBtn = await $('.bulletin-btn*=Copy')
    await copyTextBtn.waitForClickable({ timeout: 10000 })
    await copyTextBtn.click()

    const copiedAlert = await $('div*=Bulletin copied')
    await copiedAlert.waitForExist({ timeout: 10000 })
    await expect(copiedAlert).toBeExisting()
  })
})
