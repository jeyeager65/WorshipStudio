describe('Assignments', () => {
  // Intermittently fails adding roles via Settings — confirmed NOT a simple off-screen/scroll
  // issue (tried scrollIntoView on the assignments page's own role controls, didn't fix it) and
  // NOT a concurrent-write conflict with a live app instance (confirmed no other instance was
  // running). The actual failure point is earlier, in the add-role flow itself (an intermittent
  // "element not currently interactable" during setValue on the new-role input), not yet
  // root-caused. Still skipped after the People/Assignments/role-groups rework (renamed from
  // "Volunteer Roster") — that rework didn't touch the underlying flakiness, only the naming.
  it.skip('adds a person, assigns them to two roles, and flags the conflict', async () => {
    // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
    // setup wizard (App.vue) — see smoke.spec.js's identical guard.
    const skipLink = await $('button*=Skip setup')
    if (await skipLink.isExisting()) await skipLink.click()

    // Make sure at least two roles exist to assign against, under a fresh category.
    const settingsNav = await $('a[href="/settings"]')
    await settingsNav.waitForExist({ timeout: 15000 })
    await settingsNav.click()

    const rolesSection = await $('.v-list-item*=Roles')
    await rolesSection.waitForExist({ timeout: 10000 })
    await rolesSection.click()

    const categoryInput = await $('.settings-content input')
    await categoryInput.waitForExist({ timeout: 10000 })
    const addCategoryBtn = await $('.settings-content button')
    await categoryInput.setValue('E2E Test')
    await addCategoryBtn.click()

    const roleInput = await $$('.settings-content input')[1]
    const addRoleBtn = await $$('.settings-content button')[1]
    await roleInput.setValue('E2E Piano')
    await addRoleBtn.click()
    await roleInput.setValue('E2E Vocals')
    await addRoleBtn.click()

    const saveBtn = await $('button*=Save')
    await saveBtn.waitForClickable({ timeout: 10000 })
    await saveBtn.click()
    // Confirms the async save round-trip actually finished (not just that the click
    // dispatched) before navigating away — otherwise the assignments page's own fresh
    // getLibrarySettings() read could race a save still in flight.
    const savedText = await $('span*=All changes saved')
    await savedText.waitForExist({ timeout: 10000 })

    // Create a fresh service to open its assignments from.
    const homeNav = await $('a[href="/"]')
    await homeNav.click()
    const createLink = await $('a*=Create New Service')
    await createLink.waitForExist({ timeout: 10000 })
    await createLink.click()
    const submit = await $('button*=Create & Open Service')
    await submit.waitForClickable({ timeout: 10000 })
    await submit.click()

    // A freshly created service is a draft (unsaved) until Save is pressed — save it first so
    // navigating to Assignments doesn't hit the "unsaved changes" confirm dialog.
    const workspaceSaveBtn = await $('button*=Save')
    await workspaceSaveBtn.waitForClickable({ timeout: 15000 })
    await workspaceSaveBtn.click()

    const assignmentsLink = await $('a*=Assignments')
    await assignmentsLink.waitForExist({ timeout: 15000 })
    await assignmentsLink.click()

    const assignmentsHeading = await $('h1*=Assignments')
    await assignmentsHeading.waitForExist({ timeout: 10000 })

    // Add a person to assign.
    const addPersonBtn = await $('button*=New Person')
    await addPersonBtn.waitForClickable({ timeout: 10000 })
    await addPersonBtn.click()
    const firstNameField = await $('.v-dialog input')
    await firstNameField.waitForExist({ timeout: 10000 })
    await firstNameField.setValue('Ashley')
    const lastNameField = await $$('.v-dialog input')[1]
    await lastNameField.setValue('E2ETest')
    const savePersonBtn = await $('button*=Save Person')
    await savePersonBtn.waitForClickable({ timeout: 10000 })
    await savePersonBtn.click()

    // Add both roles to this service via the grouped "+ Add Role" picker, one at a time.
    const addRoleSelect = await $('.v-select*=Add Role')
    await addRoleSelect.scrollIntoView()
    await addRoleSelect.click()
    const pianoOption = await $('.v-list-item*=E2E Piano')
    await pianoOption.waitForClickable({ timeout: 10000 })
    await pianoOption.click()
    await addRoleSelect.click()
    const vocalsOption = await $('.v-list-item*=E2E Vocals')
    await vocalsOption.waitForClickable({ timeout: 10000 })
    await vocalsOption.click()

    // Assign Ashley to both new roles — a real double-booking, which should be flagged.
    const personSelects = await $$('.assignment-row .v-select')
    for (const select of personSelects) {
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
