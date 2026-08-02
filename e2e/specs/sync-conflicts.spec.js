import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

describe('Sync Conflict Resolution', () => {
  it('shows a conflict, resolves it, and it stops appearing', async () => {
    // Fabricates a real Dropbox-style "conflicted copy" file next to an original song file —
    // there's no in-app way to create one (it only ever originates from the sync client
    // itself), so this test creates both the original and the conflicted copy directly on
    // disk and cleans them up after. The isolated E2E app-data directory (see
    // helpers/appDataDir.js) starts empty on every run, so the original can no longer be
    // borrowed from the library the way it once could against the real profile.
    const libraryDir = path.join(appDataDir, 'Library')
    const songsDir = path.join(libraryDir, 'songs')
    fs.mkdirSync(songsDir, { recursive: true })

    const originalId = 'song-e2e-sync-conflict'
    const originalFile = `${originalId}.json`
    const original = {
      id: originalId,
      title: 'E2E Sync Conflict Song',
      author: 'Original Author',
      collections: [],
      tags: [],
      blocks: [{ id: 'v1', label: 'Verse 1', text: 'E2E fixture verse.' }],
      defaultArrangement: { sequence: ['v1'] },
      usage: { usesPastYear: 0 },
      updatedAt: '2026-07-25T16:00:00Z',
      updatedByDevice: 'e2e',
    }
    const originalPath = path.join(songsDir, originalFile)
    fs.writeFileSync(originalPath, JSON.stringify(original, null, 2))

    const conflictData = {
      ...original,
      author: 'Modified by Pastor Mac',
      updatedAt: '2026-07-25T16:02:00Z',
      updatedByDevice: "Pastor's Mac",
    }
    const stem = originalFile.replace(/\.json$/, '')
    const conflictFilename = `${stem} (Pastor's Mac's conflicted copy 2026-07-25).json`
    const conflictPath = path.join(songsDir, conflictFilename)
    fs.writeFileSync(conflictPath, JSON.stringify(conflictData, null, 2))

    try {
      // First launch on a fresh (or pre-existing-but-never-flagged) profile redirects to the
      // setup wizard (App.vue) — see smoke.spec.js's identical guard.
      const skipLink = await $('button*=Skip setup')
      if (await skipLink.isExisting()) await skipLink.click()

      // Reached via Settings > Sync Status > "Check Now" rather than the app-bar badge — the
      // badge only loads once at app startup (see App.vue), which would race this test's own
      // fixture-file creation above depending on exactly when that one-time load happens.
      // "Check Now" is a deliberate, on-demand re-check with no such race.
      const settingsNav = await $('a[href="/settings"]')
      await settingsNav.waitForExist({ timeout: 15000 })
      await settingsNav.click()

      const syncSection = await $('.v-list-item*=Library & Sync')
      await syncSection.waitForExist({ timeout: 10000 })
      await syncSection.click()

      const checkNowBtn = await $('button*=Check Now')
      await checkNowBtn.waitForClickable({ timeout: 10000 })
      await checkNowBtn.click()

      const resolveBtn = await $('a*=Review 1 Library Issue')
      await resolveBtn.waitForExist({ timeout: 10000 })
      await resolveBtn.click()

      const heading = await $('h1*=Library Health')
      await heading.waitForExist({ timeout: 10000 })

      // Scoped to .conflict-card — the success banner shown after resolving also contains the
      // song title ("... now uses the version from e2e."), which an unscoped query would
      // match instead once the real card is gone.
      const conflictCard = await $('.conflict-card')
      await expect(conflictCard).toBeExisting()
      await expect(await conflictCard.getText()).toContain(original.title)

      // Only the field that actually differs (author) should be listed in the comparison.
      const changedField = await $('.comparison-row strong')
      await expect(changedField).toHaveText('Author')

      // "Keep This Computer" keeps the original (this test's own fixture) version and discards
      // the conflicted copy — "Keep {otherDevice}" is the alternative for the synced copy.
      const keepBtn = await $('button*=Keep This Computer')
      await keepBtn.waitForClickable({ timeout: 10000 })
      await keepBtn.click()

      // resolveConflict() confirms before actually resolving — the confirm button's label is
      // "Keep {device} Version" using the fixture's own updatedByDevice ("e2e").
      const confirmKeepBtn = await $('button*=Keep e2e Version')
      await confirmKeepBtn.waitForClickable({ timeout: 10000 })
      await confirmKeepBtn.click()

      // Self-clearing: resolving removes the conflicted-copy artifact, so the list entry
      // disappears. This was the only issue in the library, so the empty state reflects a
      // just-finished review rather than "always been healthy".
      await conflictCard.waitForExist({ timeout: 10000, reverse: true })
      const reviewCompleteText = await $('h2*=Library review complete')
      await expect(reviewCompleteText).toBeExisting()
    } finally {
      // Resolving through the UI already deletes the conflict file on the success path —
      // this is just a safety net if an assertion fails partway through.
      if (fs.existsSync(conflictPath)) fs.unlinkSync(conflictPath)
      if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath)
    }
  })
})
