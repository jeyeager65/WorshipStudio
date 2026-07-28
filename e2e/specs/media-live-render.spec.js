import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Real media rendering in the operator preview', () => {
  it('shows an actual loaded image, not a placeholder label, for a Media item', async () => {
    // Self-contained media fixture — this used to reuse a real "SimplePhoto.jpg" file that
    // happened to already sit in the shared dev profile's Media Library, but the isolated
    // E2E app-data directory (see helpers/appDataDir.js) starts empty on every run. A real
    // (if tiny) 1x1 PNG, not just arbitrary bytes, since the whole point of this test is
    // confirming an actual image loads (naturalWidth > 0), not a placeholder.
    const libraryDir = path.join(appDataDir, 'Library')
    const mediaDir = path.join(libraryDir, 'media')
    const mediaItemsDir = path.join(libraryDir, 'media-items')
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.mkdirSync(mediaItemsDir, { recursive: true })

    const mediaFilename = 'e2e-live-render-fixture.png'
    const mediaFilePath = path.join(mediaDir, mediaFilename)
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    fs.writeFileSync(mediaFilePath, onePixelPng)

    const mediaId = 'media-e2e-live-render-fixture'
    const mediaItemPath = path.join(mediaItemsDir, `${mediaId}.json`)
    fs.writeFileSync(
      mediaItemPath,
      JSON.stringify(
        {
          id: mediaId,
          filename: mediaFilename,
          kind: 'image',
          tags: [],
          location: 'synced',
          contentHash: 'e2e-fixture',
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

      // The Add-to-Service dialog picks its content type via a "Type" dropdown, not tabs. The
      // option lookup is scoped to the open menu's own overlay content — an unscoped query can
      // match the persistent left nav's own .v-list-item entries instead (e.g. its "Media"
      // link, which would navigate away from the service instead of picking the dropdown item).
      const typeSelect = await $('.v-dialog .v-select')
      await typeSelect.waitForClickable({ timeout: 10000 })
      await typeSelect.click()
      const mediaOption = await (await $('[role="listbox"]')).$('.v-list-item*=Media')
      await mediaOption.waitForClickable({ timeout: 10000 })
      await mediaOption.click()

      const photoEntry = await $('.v-list-item*=e2e-live-render-fixture')
      await photoEntry.waitForClickable({ timeout: 10000 })
      await photoEntry.click()

      // Adding closes the dialog and selects the new item — its preview should now show a
      // real <img>, resolved through get_media_file_path + convertFileSrc, not the old
      // plain-text "Click to make this item live." placeholder.
      const image = await $('img.media-preview')
      await image.waitForExist({ timeout: 10000 })

      const naturalWidth = await browser.execute((el) => el.naturalWidth, image)
      expect(naturalWidth).toBeGreaterThan(0)

      const src = await image.getAttribute('src')
      expect(src).not.toBe('')
      expect(src.startsWith('http')).toBe(true)
    } finally {
      if (fs.existsSync(mediaFilePath)) fs.unlinkSync(mediaFilePath)
      if (fs.existsSync(mediaItemPath)) fs.unlinkSync(mediaItemPath)
    }
  })
})
