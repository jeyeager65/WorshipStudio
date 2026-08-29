describe('Planning Ahead', () => {
  it('lists a future service under Plan Ahead and opens it from the card', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const createLink = await $('a*=Create Service')
    await createLink.waitForExist({ timeout: 15000 })
    await createLink.click()

    // Leaving Sermon Title and Preacher blank on purpose — confirms ServiceCard's "No sermon
    // details yet" placeholder (src/components/ServiceCard.vue) shows up for it.
    //
    // Native <input type="date"> fields don't behave like text inputs under setValue() —
    // WebdriverIO's keystrokes land in whichever date *segment* (month/day/year) currently
    // has focus rather than replacing the whole value, which silently produced a corrupted
    // date (e.g. year "60915") the first time this test ran. Setting .value directly and
    // dispatching input/change is the reliable way to drive this control.
    const dateField = await $('input[type="date"]')
    await dateField.waitForExist({ timeout: 10000 })
    await browser.execute((el, value) => {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, dateField, '2026-09-15')

    const submit = await $('button*=Create & Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    const workspaceSaveBtn = await $('button*=Save')
    await workspaceSaveBtn.waitForClickable({ timeout: 15000 })
    await workspaceSaveBtn.click()

    const homeLink = await $('a*=Services')
    await homeLink.waitForClickable({ timeout: 10000 })
    await homeLink.click()

    // The tab reads "Plan", not "Plan Ahead" — renamed in LandingView.vue because three full
    // labels overflowed into a horizontal scroller on a phone. The toolbar heading below still
    // says "Plan Ahead", which is what the rest of this spec asserts on.
    const planningAheadLink = await $('.v-tab*=Plan')
    await planningAheadLink.waitForExist({ timeout: 10000 })
    await planningAheadLink.click()

    // Plan Ahead groups every upcoming service by month directly (LandingView.vue's
    // futureServiceGroups) — no separate month sidebar/toolbar to navigate through first.
    const monthHeading = await $('h3*=September 2026')
    await monthHeading.waitForExist({ timeout: 10000 })
    await expect(monthHeading).toBeExisting()

    const emptySermon = await $('.service-sermon--empty*=No sermon details yet')
    await expect(emptySermon).toBeExisting()

    // Clicking the card opens the service workspace directly (ServiceCard.vue's
    // openWorkspace), not just a link within it.
    const card = await $('.service-card')
    await card.click()
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForExist({ timeout: 10000 })
    await expect(saveBtn).toBeExisting()
  })
})
