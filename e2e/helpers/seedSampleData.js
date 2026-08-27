// Seeds the e2e sandbox with realistic, populated content — the same "Load Sample Data" + "Add
// Stock Backgrounds" flow Settings > Library & Sync exposes, driven the same way
// e2e/specs/settings-library-sync.spec.js already exercises it. Shared by every "drive the real
// app and capture something" script (screenshots/capture.js, video/overview.record.js) so they
// never drift from each other on how a populated starting state gets produced — a future video
// re-recording and a screenshot refresh should always be looking at the same sample library.
// Left out of settings-library-sync.spec.js on purpose: that spec is asserting this flow works
// step by step, not just using it as setup, so it keeps its own inline sequence.
export async function seedSampleData() {
  const skipLink = await $('button*=Skip setup')
  if (await skipLink.isExisting()) await skipLink.click()

  const settingsNav = await $('a[href="#/settings"]')
  await settingsNav.waitForExist({ timeout: 15000 })
  await settingsNav.click()

  const syncSection = await $('.v-list-item*=Library & Sync')
  await syncSection.waitForExist({ timeout: 10000 })
  await syncSection.click()

  const loadSampleBtn = await $('button*=Load Sample Data')
  await loadSampleBtn.waitForClickable({ timeout: 10000 })
  await loadSampleBtn.click()

  const confirmBtn = await $('button*=Delete Everything & Load Sample Data')
  await confirmBtn.waitForClickable({ timeout: 10000 })
  await confirmBtn.click()

  const sampleSuccess = await $('div*=Sample songs, services, people')
  await sampleSuccess.waitForExist({ timeout: 45000 })

  const addStockBtn = await $('button*=Add Stock Backgrounds')
  await addStockBtn.waitForClickable({ timeout: 10000 })
  await addStockBtn.click()

  const stockSuccess = await $('div*=already-present ones were skipped')
  await stockSuccess.waitForExist({ timeout: 20000 })

  const servicesNav = await $('a[href="#/"]')
  await servicesNav.waitForClickable({ timeout: 10000 })
  await servicesNav.click()

  // Loading sample data leaves the settings document dirty (see
  // settings-library-sync.spec.js's identical comment) — handle the unsaved-changes guard if it
  // shows up.
  const saveAndLeaveBtn = await $('button*=Save & Leave')
  if (await saveAndLeaveBtn.waitForExist({ timeout: 3000 }).catch(() => false)) {
    await saveAndLeaveBtn.click()
  }

  // Callers land on Services next either way — handing back the nav link and the now-visible
  // first service card saves every caller re-querying both immediately afterward.
  const serviceCard = await $('.service-card')
  await serviceCard.waitForExist({ timeout: 10000 })
  return { servicesNav, serviceCard }
}
