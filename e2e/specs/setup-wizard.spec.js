// Reached via Settings rather than relying on a fresh/un-onboarded profile (App.vue's
// first-launch redirect) — deterministic regardless of what earlier specs already did to this
// profile's machine-settings.json (see SettingsView's "Run First-Time Setup Wizard").
async function openWizardFromSettings() {
  const settingsBtn = await $('a[href="#/settings"]')
  await settingsBtn.waitForExist({ timeout: 15000 })
  await settingsBtn.click()

  const runWizardBtn = await $('button*=Run Setup Wizard')
  await runWizardBtn.waitForExist({ timeout: 10000 })
  await runWizardBtn.waitForClickable({ timeout: 10000 })
  await runWizardBtn.click()
}

async function continueWizard() {
  const button = await $('button*=Continue')
  await button.waitForClickable({ timeout: 10000 })
  await button.click()
}

// Welcome is a fork before it is a step: Continue does nothing until the operator says whether
// this device is starting a new library or joining one another device already set up. The two
// paths then differ (join runs the library step first and skips the ones whose answers live in
// the library it just joined), so a walkthrough has to pick one. 'new' is the longer path and
// the one that visits every step below.
async function chooseSetupMode(label) {
  const card = await $(`.mode-card*=${label}`)
  await card.waitForClickable({ timeout: 10000 })
  await card.click()
}

async function assertLandingPage() {
  const heading = await $('.services-hero').then((el) => el.$('h1*=Services'))
  await heading.waitForExist({ timeout: 15000 })
  return heading
}

describe('First-Time Setup Wizard', () => {
  it('has no persistent nav while active (it is a forced, standalone flow)', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Set up Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })

    // The regular app-bar (Home/Library/Slides/Settings) must not be reachable mid-wizard —
    // see App.vue's isSetupWizard check — or the operator could wander off before finishing.
    const settingsNav = await $('a[href="#/settings"]')
    await expect(settingsNav).not.toBeExisting()

    // Leave the app back on the landing page so later specs (and the next `it` in this file)
    // don't inherit a mid-wizard state with no nav to click.
    const skipLink = await $('button*=Skip for Now')
    await skipLink.click()
    await assertLandingPage()
  })

  it('walks a new library through Welcome -> Church -> Device -> Displays -> Library -> Defaults -> Finish and returns to the landing page', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Set up Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })

    await chooseSetupMode('Set up a new library')
    await continueWizard()
    const church = await $('h1*=Make the workspace yours')
    await church.waitForExist({ timeout: 10000 })
    // Continue is blocked with a validation alert until a church name is entered.
    const churchNameInput = await $('#church-name')
    await churchNameInput.setValue('E2E Test Church')

    // "This Device" sits between Church and Displays: a name for this particular machine, used
    // to label who made a change when resolving a Library Health conflict. It is pre-filled from
    // the device itself, so this step only has to be stepped through, not filled in.
    await continueWizard()
    const device = await $('h1*=Name this device')
    await device.waitForExist({ timeout: 10000 })

    await continueWizard()
    const displays = await $('h1*=Choose what each screen shows')
    await displays.waitForExist({ timeout: 10000 })

    await continueWizard()
    const library = await $('h1*=Bring your existing work with you')
    await library.waitForExist({ timeout: 10000 })
    // Deliberately not clicking "Choose Files…"/"Choose Sets Folder…"/"Choose Folder…" here —
    // those open real native OS dialogs, which WebdriverIO/tauri-driver can't drive and would
    // hang the run indefinitely.

    await continueWizard()
    const preferences = await $('h1*=Start each service with the right choices')
    await preferences.waitForExist({ timeout: 10000 })

    await continueWizard()
    const finish = await $('h1*=is ready')
    await finish.waitForExist({ timeout: 10000 })

    const finishBtn = await $('button*=Open Services')
    await finishBtn.waitForClickable({ timeout: 10000 })
    await finishBtn.click()

    const landingText = await assertLandingPage()
    await expect(landingText).toBeExisting()
  })

  it('Skip for Now returns to the landing page immediately from any step', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Set up Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })
    await chooseSetupMode('Set up a new library')
    await continueWizard()

    const church = await $('h1*=Make the workspace yours')
    await church.waitForExist({ timeout: 10000 })

    const skipLink = await $('button*=Skip for Now')
    await skipLink.waitForClickable({ timeout: 10000 })
    await skipLink.click()

    const landingText = await assertLandingPage()
    await expect(landingText).toBeExisting()
  })
})
