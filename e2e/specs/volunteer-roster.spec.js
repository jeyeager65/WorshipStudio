describe('Volunteer Roster', () => {
  it('adds a volunteer, assigns them to two roles, and flags the conflict', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    // Make sure at least two volunteer roles exist to assign against.
    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const rolesSection = await $('.v-list-item*=Volunteer Roles')
    await rolesSection.waitForExist({ timeout: 10000 })
    await rolesSection.click()

    const roleInput = await $('.settings-content input')
    await roleInput.waitForExist({ timeout: 10000 })
    const addRoleBtn = await $('.settings-content button')
    await roleInput.setValue('E2E Piano')
    await addRoleBtn.click()
    await roleInput.setValue('E2E Vocals')
    await addRoleBtn.click()

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()
    // Confirms the async save round-trip actually finished (not just that the click
    // dispatched) before navigating away — otherwise the roster page's own fresh
    // getLibrarySettings() read could race a save still in flight.
    const savedText = await $('span*=All changes saved')
    await savedText.waitForExist({ timeout: 10000 })

    // Create a fresh service to open its roster from.
    const homeNav = await $('a[href="/"]')
    await homeNav.click()
    const createLink = await $('a*=Create New Service')
    await createLink.waitForExist({ timeout: 10000 })
    await createLink.click()
    const submit = await $('button*=Create & Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    // A freshly created service is a draft (unsaved) until Save is pressed — save it first so
    // navigating to the roster doesn't hit the "unsaved changes" confirm dialog.
    const workspaceSaveBtn = await $('button*=Save')
    await workspaceSaveBtn.waitForClickable({ timeout: 15000 })
    await workspaceSaveBtn.click()

    const rosterLink = await $('a*=Volunteer Roster')
    await rosterLink.waitForExist({ timeout: 15000 })
    await rosterLink.click()

    const rosterHeading = await $('h1*=Volunteer Roster')
    await rosterHeading.waitForExist({ timeout: 10000 })

    // Add a volunteer to assign.
    const addVolunteerBtn = await $('button*=Add Volunteer')
    await addVolunteerBtn.waitForClickable({ timeout: 10000 })
    await addVolunteerBtn.click()
    const firstNameField = await $('.v-dialog input')
    await firstNameField.waitForExist({ timeout: 10000 })
    await firstNameField.setValue('Ashley')
    const lastNameField = await $$('.v-dialog input')[1]
    await lastNameField.setValue('E2ETest')
    const saveVolunteerBtn = await $('button*=Save Volunteer')
    await saveVolunteerBtn.waitForClickable({ timeout: 10000 })
    await saveVolunteerBtn.click()

    // Assign Ashley to both new roles — a real double-booking, which should be flagged.
    const addToPiano = await $('button*=Add to E2E Piano')
    await addToPiano.waitForClickable({ timeout: 10000 })
    await addToPiano.click()
    const addToVocals = await $('button*=Add to E2E Vocals')
    await addToVocals.waitForClickable({ timeout: 10000 })
    await addToVocals.click()

    const volunteerSelects = await $$('.role-row .v-select')
    for (const select of volunteerSelects) {
      await select.click()
      const option = await $('.v-list-item*=Ashley E2ETest')
      await option.waitForClickable({ timeout: 10000 })
      await option.click()
    }

    const conflictBadge = await $('.v-chip*=CONFLICT')
    await conflictBadge.waitForExist({ timeout: 10000 })
    await expect(conflictBadge).toBeExisting()

    // Email compose never actually sends — verify the honest "not sent" message shows.
    const sendBtn = await $('button*=Send Assignments by Email')
    await sendBtn.waitForClickable({ timeout: 10000 })
    await sendBtn.click()
    const dialogSendBtn = await $('button=Send')
    await dialogSendBtn.waitForClickable({ timeout: 10000 })
    await dialogSendBtn.click()
    const notSentAlert = await $('div*=Not sent')
    await notSentAlert.waitForExist({ timeout: 10000 })
    await expect(notSentAlert).toBeExisting()
  })
})
