describe('CCLI Reporting', () => {
  it('loads the report and quick-range chips update the date fields', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const reportsNav = await $('a[href="/reports"]')
    await reportsNav.waitForExist({ timeout: 15000 })
    await reportsNav.click()

    const ccliLink = await $('a*=Song Usage')
    await ccliLink.waitForExist({ timeout: 10000 })
    await ccliLink.click()

    const heading = await $('h1*=Song Usage')
    await heading.waitForExist({ timeout: 10000 })

    // Summary cards should render even with zero usage in range (a fresh profile with no
    // services yet) — this is asserting the computation doesn't error out, not a specific count.
    const totalUsesLabel = await $('div*=Song uses')
    await expect(totalUsesLabel).toBeExisting()

    const dateInputs = await $$('input[type="date"]')
    const startDateInput = dateInputs[0]
    const beforeValue = await startDateInput.getValue()

    const lastYearChip = await $('.v-chip*=Last Year')
    await lastYearChip.waitForClickable({ timeout: 10000 })
    await lastYearChip.click()

    // Deliberately not clicking "Export PDF Report" — it opens a real native OS print dialog,
    // which WebdriverIO/tauri-driver can't drive and would hang the run.
    await browser.waitUntil(async () => (await startDateInput.getValue()) !== beforeValue, {
      timeout: 10000,
      timeoutMsg: 'expected the start date to change after clicking "Last Year"',
    })
    const afterValue = await startDateInput.getValue()
    await expect(afterValue).toMatch(/^\d{4}-01-01$/)
  })
})
