import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Add Item — Song list order', () => {
  it('lists songs alphabetically by title, not insertion order', async () => {
    // Regression coverage for a real bug: AddServiceItemDialog.vue's song list filtered but
    // never sorted, so it just reflected whatever order songs happened to load in (effectively
    // file-listing order, unrelated to title) instead of matching Song Library's own alphabetical
    // sort. Seeded with a deliberately non-alphabetical insertion order so this can't pass by
    // accident.
    const songsDir = path.join(appDataDir, 'Library', 'songs')
    fs.mkdirSync(songsDir, { recursive: true })
    const titles = ['E2E Zebra Song', 'E2E Apple Song', 'E2E Middle Song']
    const songPaths = titles.map((title, index) => {
      const id = `song-e2e-order-${index}`
      const songPath = path.join(songsDir, `${id}.json`)
      fs.writeFileSync(
        songPath,
        JSON.stringify(
          {
            id,
            title,
            author: '',
            collections: [],
            tags: [],
            blocks: [{ id: 'v1', label: 'Verse 1', text: 'E2E fixture verse.' }],
            defaultArrangement: { sequence: ['v1'] },
            usage: { usesPastYear: 0 },
            updatedAt: '2026-07-25T16:00:00Z',
            updatedByDevice: 'e2e',
          },
          null,
          2,
        ),
      )
      return songPath
    })

    try {
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      const createLink = await $('a*=Create Service')
      await createLink.waitForExist({ timeout: 15000 })
      await createLink.click()

      const submit = await $('button*=Create & Open Service')
      await submit.waitForExist({ timeout: 10000 })
      await submit.waitForClickable({ timeout: 10000 })
      await submit.click()

      const addButton = await $('button*=Add Item')
      await addButton.waitForExist({ timeout: 15000 })
      await addButton.waitForClickable({ timeout: 10000 })
      await addButton.click()

      const menu = await $('.add-item-menu')
      await menu.waitForExist({ timeout: 10000 })
      const songOption = await menu.$('.v-list-item*=Song')
      await songOption.waitForClickable({ timeout: 10000 })
      await songOption.click()

      const searchLabel = await $('label*=Search songs')
      await searchLabel.waitForExist({ timeout: 10000 })
      const searchLabelId = await searchLabel.getAttribute('id')
      const searchField = await $(`input[aria-labelledby="${searchLabelId}"]`)
      await searchField.setValue('E2E ')

      const zebraItem = await $('.v-list-item*=E2E Zebra Song')
      await zebraItem.waitForExist({ timeout: 10000 })

      const listItems = await $$('.v-list-item')
      const visibleTitles = []
      for (const item of listItems) {
        const text = await item.getText()
        if (text.includes('E2E ') && text.includes('Song')) visibleTitles.push(text.split('\n')[0])
      }
      expect(visibleTitles).toEqual(['E2E Apple Song', 'E2E Middle Song', 'E2E Zebra Song'])
    } finally {
      for (const songPath of songPaths) {
        if (fs.existsSync(songPath)) fs.unlinkSync(songPath)
      }
    }
  })
})
