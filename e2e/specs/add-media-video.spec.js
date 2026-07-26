import fs from 'node:fs'
import path from 'node:path'

describe('Add-to-Service Media/Video tabs', () => {
  it('adds an existing Media Library image and video to a service', async () => {
    // Self-contained fixtures, same approach as sync-conflicts.spec.js / planning-report.spec.js
    // — real Import Media only works through a native file picker WebdriverIO can't drive
    // (see media-library.spec.js), so these are written directly to disk instead.
    const mediaItemsDir = path.join(process.env.APPDATA, 'dev.yeager.worshipstudio', 'Library', 'media-items')
    fs.mkdirSync(mediaItemsDir, { recursive: true })

    const imageId = 'media-e2e-add-image'
    const imagePath = path.join(mediaItemsDir, `${imageId}.json`)
    fs.writeFileSync(
      imagePath,
      JSON.stringify(
        {
          id: imageId,
          filename: 'e2e-add-photo.jpg',
          kind: 'image',
          tags: [],
          location: 'synced',
          contentHash: 'e2e-fixture-image',
          usage: { usesPastYear: 0 },
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    const videoId = 'media-e2e-add-video'
    const videoPath = path.join(mediaItemsDir, `${videoId}.json`)
    fs.writeFileSync(
      videoPath,
      JSON.stringify(
        {
          id: videoId,
          filename: 'e2e-add-clip.mp4',
          kind: 'video',
          tags: [],
          location: 'synced',
          contentHash: 'e2e-fixture-video',
          usage: { usesPastYear: 0 },
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    try {
      // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
      // setup wizard (App.vue) — see smoke.spec.js's identical guard.
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const createLink = await $('a*=Create New Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()
      const submit = await $('button*=Create & Open Service')
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      const addButton = await $('button*=Add to Service')
      await addButton.waitForExist({ timeout: 15000 })
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()

      const mediaTab = await $('.v-tab*=Media')
      await mediaTab.waitForExist({ timeout: 10000 })
      await mediaTab.click()

      // Matched without the file extension — WebdriverIO treats a selector string ending in
      // a recognized image extension (.jpg/.png/etc.) as an image-comparison selector rather
      // than plain text, which fails outright since there's no such image file to load.
      const imageEntry = await $('.v-list-item*=e2e-add-photo')
      await imageEntry.waitForClickable({ timeout: 10000 })
      await imageEntry.click()

      // Adding closes the dialog and selects the new item in the service order list.
      const mediaRow = await $('span*=e2e-add-photo')
      await mediaRow.waitForExist({ timeout: 10000 })
      await expect(mediaRow).toBeExisting()

      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()

      const videoTab = await $('.v-tab*=Video')
      await videoTab.waitForExist({ timeout: 10000 })
      await videoTab.click()

      const videoEntry = await $('.v-list-item*=e2e-add-clip')
      await videoEntry.waitForClickable({ timeout: 10000 })
      await videoEntry.click()

      const videoRow = await $('span*=e2e-add-clip')
      await videoRow.waitForExist({ timeout: 10000 })
      await expect(videoRow).toBeExisting()
    } finally {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    }
  })
})
