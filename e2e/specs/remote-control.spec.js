describe('Remote Control', () => {
  it('pairs a device, shows a QR code, lists it, and revokes it', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const remoteSection = await $('.v-list-item*=Remote Control')
    await remoteSection.waitForExist({ timeout: 10000 })
    await remoteSection.click()

    const pairBtn = await $('button*=Pair a Device')
    await pairBtn.waitForClickable({ timeout: 10000 })
    await pairBtn.click()

    await browser.waitUntil(async () => (await $$('.v-dialog input')).length >= 1, { timeout: 10000 })
    const nameInput = (await $$('.v-dialog input'))[0]
    await nameInput.setValue('E2E Test Phone')

    // Access level defaults to Advance Only — left as-is, no need to change it for this test.
    const generateBtn = await $('button*=Generate QR Code')
    await generateBtn.waitForClickable({ timeout: 10000 })
    await generateBtn.click()

    // A real QR code gets generated (real LAN IP detection + qrcode PNG rendering on the
    // Rust side) — confirm it actually rendered as a data URL image, not just that the
    // dialog changed state.
    const qrImage = await $('img[alt="Pairing QR code"]')
    await qrImage.waitForExist({ timeout: 10000 })
    const qrSrc = await qrImage.getAttribute('src')
    expect(qrSrc.startsWith('data:image/png;base64,')).toBe(true)

    const pairingUrlText = await $('p*=/pair?token=')
    await expect(pairingUrlText).toBeExisting()

    const doneBtn = await $('button*=Done')
    await doneBtn.waitForClickable({ timeout: 10000 })
    await doneBtn.click()

    const deviceRow = await $('.v-list-item-title*=E2E Test Phone')
    await deviceRow.waitForExist({ timeout: 10000 })
    await expect(deviceRow).toBeExisting()

    // Clean up: revoke the paired device so it doesn't linger in the real dev profile's
    // remote-devices.json.
    const deleteIcon = await $('.mdi-trash-can-outline')
    await deleteIcon.waitForClickable({ timeout: 10000 })
    await deleteIcon.click()

    const confirmBtn = await $('button*=Revoke')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    const goneRow = await $('.v-list-item-title*=E2E Test Phone')
    await goneRow.waitForExist({ timeout: 10000, reverse: true })
    await expect(goneRow).not.toBeExisting()
  })
})
