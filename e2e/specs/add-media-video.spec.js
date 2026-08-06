import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Add-to-Service Media/Video tabs', () => {
  it('adds an existing Media Library image and video to a service', async () => {
    // Self-contained fixtures, same approach as sync-conflicts.spec.js / planning-report.spec.js
    // — real Import Media only works through a native file picker WebdriverIO can't drive
    // (see media-library.spec.js), so these are written directly to disk instead.
    const mediaItemsDir = path.join(appDataDir, 'Library', 'media-items')
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

      const createLink = await $('a*=Create Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()
      const submit = await $('button*=Create and Open Service')
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      // "Add Item" opens a menu of item types directly (no Type dropdown inside a dialog
      // anymore) — picking "Media" here opens the Add dialog straight to that tab. Scoped to
      // .add-item-menu — the persistent left nav also has its own "Media" .v-list-item link,
      // which an unscoped query would match instead (and actually navigate away from the
      // service, not just fail the assertion).
      const addButton = await $('button*=Add Item')
      await addButton.waitForExist({ timeout: 15000 })
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()
      const mediaOption = await $('.add-item-menu').then((el) => el.$('.v-list-item*=Media'))
      await mediaOption.waitForClickable({ timeout: 10000 })
      await mediaOption.click()

      // Picking "Media" opens the same MediaPickerDialog used by Settings > Branding's logo
      // picker, filtered to images, directly — no intermediate "Browse" step.
      // Matched without the file extension — WebdriverIO treats a selector string ending in
      // a recognized image extension (.jpg/.png/etc.) as an image-comparison selector rather
      // than plain text, which fails outright since there's no such image file to load.
      const imageCard = await $('.media-card*=e2e-add-photo')
      await imageCard.waitForExist({ timeout: 10000 })
      const addImageBtn = await imageCard.$('button*=Add to Service')
      await addImageBtn.waitForClickable({ timeout: 10000 })
      await addImageBtn.click()

      // Adding closes the dialog and selects the new item in the service order list.
      const mediaRow = await $('.service-item-title*=e2e-add-photo')
      await mediaRow.waitForExist({ timeout: 10000 })
      await expect(mediaRow).toBeExisting()

      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()
      const videoOption = await $('.add-item-menu').then((el) => el.$('.v-list-item*=Video'))
      await videoOption.waitForClickable({ timeout: 10000 })
      await videoOption.click()

      const videoCard = await $('.media-card*=e2e-add-clip')
      await videoCard.waitForExist({ timeout: 10000 })
      const addVideoBtn = await videoCard.$('button*=Add to Service')
      await addVideoBtn.waitForClickable({ timeout: 10000 })
      await addVideoBtn.click()

      const videoRow = await $('.service-item-title*=e2e-add-clip')
      await videoRow.waitForExist({ timeout: 10000 })
      await expect(videoRow).toBeExisting()
    } finally {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    }
  })
})
