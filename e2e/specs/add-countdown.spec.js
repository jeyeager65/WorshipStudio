describe('Add-to-Service Countdown tab', () => {
  it('adds a countdown item and shows a live-ticking clock in the operator preview', async () => {
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

    // "Add Item" opens a menu of item types directly (no Type dropdown inside a dialog
    // anymore) — picking "Countdown" here opens the Add dialog straight to that tab.
    const addButton = await $('button*=Add Item')
    await addButton.waitForExist({ timeout: 15000 })
    await addButton.waitForClickable({ timeout: 10000 })
    await addButton.click()
    const countdownOption = await $('.v-list-item*=Countdown')
    await countdownOption.waitForClickable({ timeout: 10000 })
    await countdownOption.click()

    // Vuetify's v-window keeps other tabs' fields mounted (just hidden) after they're first
    // activated, so a plain `input[type=...]` or positional query can match a stale field left
    // over from an earlier tab (e.g. the Songs tab's search box) — labels stay uniquely
    // associated with their own field regardless, so look up each field that way instead.
    async function fieldByLabel(labelText) {
      const label = await $(`label*=${labelText}`)
      await label.waitForExist({ timeout: 10000 })
      // Vuetify 4 links input -> label via aria-labelledby (not a `for` attribute on the label).
      const labelId = await label.getAttribute('id')
      return $(`input[aria-labelledby="${labelId}"]`)
    }

    // 10 minutes from now, formatted for <input type="datetime-local"> (no timezone, no
    // seconds) — set directly via JS rather than setValue(), the same native-input reliability
    // issue documented in planning-ahead.spec.js for date inputs applies to datetime-local too.
    const targetInput = await fieldByLabel('Target Time')
    const target = new Date(Date.now() + 10 * 60 * 1000)
    const pad = (n) => String(n).padStart(2, '0')
    const targetValue = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`
    await browser.execute(
      (el, value) => {
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      },
      targetInput,
      targetValue,
    )

    const textInput = await fieldByLabel('Custom Text')
    await textInput.setValue('Join us at 10:15!')

    const addToServiceBtn = await $('.v-dialog').$('button*=Add to Service')
    await addToServiceBtn.waitForClickable({ timeout: 10000 })
    await addToServiceBtn.click()

    const itemRow = await $('.service-item-title*=Join us at 10:15!')
    await itemRow.waitForExist({ timeout: 10000 })
    await itemRow.click()

    const makeLiveRow = await $('div*=Join us at 10:15!')
    await makeLiveRow.waitForExist({ timeout: 10000 })

    // The operator preview shows the custom text plus a live-ticking mm:ss clock counting
    // down toward the 10-minutes-out target.
    const clock = await $('div.text-h5')
    await clock.waitForExist({ timeout: 10000 })
    const clockText = await clock.getText()
    expect(clockText).toMatch(/^\d{2}:\d{2}$/)
  })
})
