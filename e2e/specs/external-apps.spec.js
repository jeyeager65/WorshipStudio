describe('External App Hand-off', () => {
  it('creates, edits, and deletes an external app profile', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    const settingsNav = await $('a[href="#/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const externalAppsSection = await $('.v-list-item*=External Apps')
    await externalAppsSection.waitForExist({ timeout: 10000 })
    await externalAppsSection.click()

    const addBtn = await $('button*=Add Profile')
    await addBtn.waitForClickable({ timeout: 10000 })
    await addBtn.click()

    // The profile editor is its own routed page (ExternalAppProfileEditorView.vue), not a
    // dialog — it outgrew what a modal could reasonably hold once Basic Remote Controls'
    // key-commands list was added.
    //
    // Targeted by id, not position. These used to be indexes into $$('input'), which broke
    // silently the moment a "Kind" select was added above them: index 2 became a v-select's own
    // read-only input, and it surfaced as "element is not interactable" with nothing pointing at
    // the cause. Ids cost three attributes and cannot drift when a field is added.
    const nameField = await $('#external-app-name')
    await nameField.waitForExist({ timeout: 10000 })
    await nameField.setValue('Notepad E2E Test')

    // Filling the Executable field directly rather than clicking "Browse…" — that opens a
    // native OS file picker WebdriverIO can't drive, the same reasoning the rest of this
    // suite uses for skipping native dialogs.
    await (await $('#external-app-executable')).setValue('C:\\Windows\\System32\\notepad.exe')
    await (await $('#external-app-parameter-format')).setValue('"{file}"')

    const preview = await $('div*=Will run:')
    await preview.waitForExist({ timeout: 5000 })
    const previewText = await preview.getText()
    await expect(previewText).toContain('notepad.exe "C:\\Services\\Example.pptx"')

    // Basic Remote Controls: a fully generic key-commands list (no reserved Next/Prev) — turn
    // it on, add one custom command, and capture both its keyCombo (sent to the app) and its
    // triggerKey (a Worship Studio-side keyboard shortcut) via KeyComboField's click-to-record
    // capture, not by typing into a text field (there isn't one — see KeyComboField.vue).
    // The switch's own native input is visually hidden by Vuetify (zero-size, covered by the
    // track), so WebdriverIO's viewport-overlap clickability check never passes for it or its
    // wrapper — clicking via a plain DOM .click() (still real user intent: this is exactly what
    // Vuetify's own label/track click handler ends up calling) sidesteps that heuristic.
    const remoteControlsSwitch = await $('.v-switch input')
    await remoteControlsSwitch.waitForExist({ timeout: 10000 })
    await browser.execute((el) => el.click(), remoteControlsSwitch)

    // Buttons further down the page can still be pushed below the fold — WebdriverIO's own
    // viewport-overlap clickability check doesn't always resolve that with a plain .click(), so
    // "Add Command" is scrolled into place and clicked via a plain DOM .click() instead.
    const addCommandBtn = await $('button*=Add Command')
    await addCommandBtn.waitForExist({ timeout: 10000 })
    await addCommandBtn.scrollIntoView()
    await browser.execute((el) => el.click(), addCommandBtn)

    // A new profile already seeds two starter rows (Next/Previous — see blankProfile() in
    // ExternalAppProfileEditorView.vue), so the row "Add Command" just appended is the *last*
    // one, not the only one.
    const commandRows = await $$('.key-command-row')
    await expect(commandRows).toBeElementsArrayOfSize(3)
    const commandRow = commandRows[2]
    const commandLabelInput = await commandRow.$('input')
    await commandLabelInput.setValue('Start Presentation')

    // First KeyComboField (keyCombo, sent to the app) — a plain letter key, not F5: F5 (or
    // Ctrl+R) is WebView2's own reload shortcut and reloads the whole page out from under the
    // test before preventDefault() in JS ever gets a chance to stop it, despite being a
    // perfectly valid combo for real profiles. This one needs a *real* click (scrolled into
    // view first) rather than a JS .click() — a synthetic click doesn't reliably move actual
    // keyboard focus the way a genuine one does, and without real focus the button's own
    // keydown listener never receives browser.keys().
    const keyComboBtn = await commandRow.$('button*=Click, then press a key')
    await keyComboBtn.scrollIntoView()
    await keyComboBtn.waitForClickable({ timeout: 10000 })
    await keyComboBtn.click()
    await browser.keys('k')
    const keyComboRecorded = await commandRow.$('button.key-combo-btn')
    await expect(await keyComboRecorded.getText()).toBe('K')

    // Second KeyComboField (triggerKey, optional) — a modifier combo. Ctrl/Shift must each be
    // sent a second time to actually release (see settings-general.spec.js's identical note),
    // or they'd corrupt every later keystroke this session.
    const triggerKeyBtn = await commandRow.$('button*=Button only')
    await triggerKeyBtn.scrollIntoView()
    await triggerKeyBtn.waitForClickable({ timeout: 10000 })
    await triggerKeyBtn.click()
    await browser.keys(['Control', 'Shift', 'F9', 'Shift', 'Control'])
    const triggerKeyButtons = await commandRow.$$('button.key-combo-btn')
    await expect(await triggerKeyButtons[1].getText()).toBe('Ctrl + Shift + F9')

    // The app-bar's standard Save button (App.vue) now handles this — no in-page Save button —
    // same convention as settings-managed-lists.spec.js's Service Types/Song Collections saves.
    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()

    // Saving navigates back to Settings > External Apps (same as the old dialog's Save closing
    // it) — confirmed by the list showing the new profile.
    const savedProfile = await $('.v-list-item-title*=Notepad E2E Test')
    await savedProfile.waitForExist({ timeout: 10000 })
    await expect(savedProfile).toBeExisting()

    // Reopen it and confirm the fields round-tripped through a real save/reload — the row
    // itself is clickable now (no separate edit icon).
    await savedProfile.click()

    const reopenedExecInput = await $('#external-app-executable')
    await reopenedExecInput.waitForExist({ timeout: 10000 })
    await expect(reopenedExecInput).toHaveValue('C:\\Windows\\System32\\notepad.exe')

    // The custom command (label, keyCombo, triggerKey) round-tripped through the same real
    // save/reload — not just next/previous, since there's no reserved shape anymore. Still the
    // 3rd/last row, same as before saving.
    const reopenedCommandRows = await $$('.key-command-row')
    await expect(reopenedCommandRows).toBeElementsArrayOfSize(3)
    const reopenedCommandRow = reopenedCommandRows[2]
    const reopenedLabelInput = await reopenedCommandRow.$('input')
    await expect(reopenedLabelInput).toHaveValue('Start Presentation')
    const reopenedKeyCombos = await reopenedCommandRow.$$('button.key-combo-btn')
    await expect(await reopenedKeyCombos[0].getText()).toBe('K')
    await expect(await reopenedKeyCombos[1].getText()).toBe('Ctrl + Shift + F9')

    // Back to the list without saving again (the header back-link, not a Save) — same "discard
    // whatever's unsaved" behavior Cancel had on the old dialog.
    const backBtn = await $('button*=External Apps')
    await backBtn.click()

    // Clean up: delete the test profile so it doesn't linger in the real dev profile's
    // external-apps.json.
    const deleteIcon = await $('.mdi-trash-can-outline')
    await deleteIcon.waitForClickable({ timeout: 10000 })
    await deleteIcon.click()

    const confirmBtn = await $('button*=Delete')
    await confirmBtn.waitForClickable({ timeout: 10000 })
    await confirmBtn.click()

    const goneProfile = await $('.v-list-item-title*=Notepad E2E Test')
    await goneProfile.waitForExist({ timeout: 10000, reverse: true })
    await expect(goneProfile).not.toBeExisting()
  })
})
