// Reached via Settings rather than relying on a fresh/un-onboarded profile (App.vue's
// first-launch redirect) — deterministic regardless of what earlier specs already did to this
// profile's machine-settings.json (see SettingsView's "Run First-Time Setup Wizard").
async function openWizardFromSettings() {
  const settingsBtn = await $('a[href="/settings"]')
  await settingsBtn.waitForExist({ timeout: 15000 })
  await settingsBtn.click()

  const runWizardBtn = await $('button*=Run First-Time Setup Wizard')
  await runWizardBtn.waitForExist({ timeout: 10000 })
  await runWizardBtn.waitForClickable({ timeout: 10000 })
  await runWizardBtn.click()
}

async function continueWizard() {
  const button = await $('button*=Continue')
  await button.waitForClickable({ timeout: 10000 })
  await button.click()
}

describe('First-Time Setup Wizard', () => {
  it('has no persistent nav while active (it is a forced, standalone flow)', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Welcome to Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })

    // The regular app-bar (Home/Library/Slides/Settings) must not be reachable mid-wizard —
    // see App.vue's isSetupWizard check — or the operator could wander off before finishing.
    const settingsNav = await $('a[href="/settings"]')
    await expect(settingsNav).not.toBeExisting()

    // Leave the app back on the landing page so later specs (and the next `it` in this file)
    // don't inherit a mid-wizard state with no nav to click.
    const skipLink = await $('button*=Skip setup')
    await skipLink.click()
    const landingText = await $('p*=Select a service to continue')
    await landingText.waitForExist({ timeout: 15000 })
  })

  it('walks Welcome -> Displays -> Library -> Preferences -> Finish and returns to the landing page', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Welcome to Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })

    await continueWizard()
    const displays = await $('h1*=Set Up Your Displays')
    await displays.waitForExist({ timeout: 10000 })

    await continueWizard()
    const library = await $('h1*=Import Your Library')
    await library.waitForExist({ timeout: 10000 })
    // Deliberately not clicking "Choose Files…"/"Choose Sets Folder…"/"Choose Folder…" here —
    // those open real native OS dialogs, which WebdriverIO/tauri-driver can't drive and would
    // hang the run indefinitely.

    await continueWizard()
    const preferences = await $('h1*=Basic Preferences')
    await preferences.waitForExist({ timeout: 10000 })

    await continueWizard()
    const finish = await $("h1*=You're All Set")
    await finish.waitForExist({ timeout: 10000 })

    const finishBtn = await $('button*=Finish')
    await finishBtn.waitForClickable({ timeout: 10000 })
    await finishBtn.click()

    const landingText = await $('p*=Select a service to continue')
    await landingText.waitForExist({ timeout: 15000 })
    await expect(landingText).toBeExisting()
  })

  it('Skip setup returns to the landing page immediately from any step', async () => {
    await openWizardFromSettings()

    const welcome = await $('h1*=Welcome to Worship Studio')
    await welcome.waitForExist({ timeout: 10000 })
    await continueWizard()

    const displays = await $('h1*=Set Up Your Displays')
    await displays.waitForExist({ timeout: 10000 })

    const skipLink = await $('button*=Skip setup')
    await skipLink.waitForClickable({ timeout: 10000 })
    await skipLink.click()

    const landingText = await $('p*=Select a service to continue')
    await landingText.waitForExist({ timeout: 15000 })
    await expect(landingText).toBeExisting()
  })
})
