/**
 * Real File System Access-backed StudioAdapter. All ten storage-shaped ports (Songs, Services,
 * Slides, Media, Themes, People, Announcements, Settings, Scripture, Export — see
 * web-feature-parity.md §5's "Sizing the storage-shaped remainder") are genuinely implemented
 * against the picked folder, not stubs. `live` is real too (see @/utils/liveAudienceWindow) — a
 * plain browser window plus BroadcastChannel, reusing the same SlideContentRenderer.vue every
 * other live-content consumer already uses (shared with the mock adapter too, since it's
 * genuinely storage-independent). `displays`/`externalApps`/`remote`/`canva` stay omitted
 * (optional on StudioAdapter) since they're confirmed impossible in any browser or need a
 * redesign (Canva's OAuth loopback callback) rather than being merely unbuilt.
 *
 * Wired into getAdapter() via src/BootGate.vue, not getAdapter() (adapters/index.ts) itself:
 * constructing this adapter requires an async user gesture (showDirectoryPicker()) first, which
 * getAdapter()'s synchronous, called-everywhere contract can't accommodate on its own.
 */

import type {
  DiagnosticSummary,
  ScripturePassage,
  StudioAdapter,
  SyncStatus,
} from '@/adapters/types'
import { loadKjv } from '@/adapters/mock/scriptureFixtures'
import {
  formatReference,
  getBookNames,
  isValidReference,
  parseReference,
} from '@/utils/scriptureReference'
import { createLiveAudienceWindowPort } from '@/utils/liveAudienceWindow'
import { createWebAnnouncementsPort } from './announcements'
import { createWebMediaPort } from './media'
import { createWebPeoplePort } from './people'
import { createPickedLocalMediaRoot } from './pickedLocalMediaRoot'
import { listApiBibleCatalog, resolveApiBible, resolveEsv } from './scripture'
import { createWebServicesPort } from './services'
import { createWebSettingsPort } from './settings'
import { createWebSlidesPort } from './slides'
import { createWebSongCollectionsPort } from './songCollections'
import { createWebSongsPort } from './songs'
import { createWebThemesPort } from './themes'
import * as sync from './sync'

export function createWebAdapter(root: FileSystemDirectoryHandle): StudioAdapter {
  const settings = createWebSettingsPort(root)
  const songs = createWebSongsPort(root, settings)
  const themes = createWebThemesPort(root, settings)
  const songCollections = createWebSongCollectionsPort(root)
  const services = createWebServicesPort(root, settings, songs)
  const slides = createWebSlidesPort(root, settings)
  const media = createWebMediaPort(root, settings, themes, createPickedLocalMediaRoot())
  const people = createWebPeoplePort(root, settings)
  const announcements = createWebAnnouncementsPort(root, settings)

  return {
    kind: 'web',
    songs,
    services,
    slides,
    media,
    themes,
    songCollections,
    people,
    announcements,
    settings,
    // Storage-independent — the local KJV dataset and reference parsing are already confirmed
    // reusable as-is (web-feature-parity.md §1: "a bundled JSON asset and pure string parsing,
    // nothing localStorage-specific"). ESV/api.bible network calls are confirmed CORS-open (§3)
    // and now wired up for real (see ./scripture.ts, a TS port of the same Rust domain logic
    // src-tauri/src/commands/scripture.rs dispatches to) — same dispatch rules as the Rust
    // resolve_scripture command: ESV needs librarySettings.esvApiKey, any other non-KJV code
    // must be a library-configured api.bible translation and needs librarySettings.apiBibleKey.
    // Both keys are church-wide/synced, not per-machine — see models/settings.ts's doc comments.
    scripture: {
      resolve: async (reference, translationCode): Promise<ScripturePassage> => {
        if (translationCode === 'ESV') {
          const librarySettings = await settings.getLibrarySettings()
          const apiKey = librarySettings.esvApiKey
          if (!apiKey) throw new Error("The ESV API isn't configured for this church.")
          return resolveEsv(reference, apiKey)
        }
        if (translationCode !== 'KJV') {
          const librarySettings = await settings.getLibrarySettings()
          const entry = librarySettings.apiBibleTranslations.find((t) => t.code === translationCode)
          if (entry) {
            const apiKey = librarySettings.apiBibleKey
            if (!apiKey) throw new Error("The api.bible API isn't configured for this church.")
            return resolveApiBible(reference, entry.bibleId, translationCode, apiKey)
          }
        }
        const parsed = parseReference(reference)
        if (!parsed || !isValidReference(parsed))
          throw new Error(`"${reference}" isn't a valid scripture reference.`)
        const kjv = await loadKjv()
        const bookData = kjv[parsed.book]
        const verses: ScripturePassage['verses'] = []
        for (let chapter = parsed.startChapter; chapter <= parsed.endChapter; chapter++) {
          const verseFrom = chapter === parsed.startChapter ? parsed.startVerse : 1
          const verseTo = chapter === parsed.endChapter ? parsed.endVerse : Number.MAX_SAFE_INTEGER
          const chapterData = bookData?.[chapter] ?? {}
          for (const [verseNumber, text] of Object.entries(chapterData)) {
            const number = Number(verseNumber)
            if (number >= verseFrom && number <= verseTo) verses.push({ number, text })
          }
        }
        if (verses.length === 0) {
          throw new Error(`No KJV text found for ${formatReference(parsed)}.`)
        }
        return { reference: formatReference(parsed), translation: translationCode, verses }
      },
      getBookList: async () => getBookNames(),
      listTranslations: async () => {
        const librarySettings = await settings.getLibrarySettings()
        const translations = [{ code: 'KJV', name: 'King James Version' }]
        if (librarySettings.esvApiKey) {
          translations.push({ code: 'ESV', name: 'English Standard Version' })
        }
        if (librarySettings.apiBibleKey) {
          for (const t of librarySettings.apiBibleTranslations) {
            translations.push({ code: t.code, name: t.label })
          }
        }
        return translations
      },
      listApiBibleCatalog: async (apiKey) => {
        const key = apiKey || (await settings.getLibrarySettings()).apiBibleKey
        if (!key) throw new Error("The api.bible API isn't configured for this church.")
        return listApiBibleCatalog(key)
      },
    },
    // A real audience window (see ./live.ts): a plain window.open() plus BroadcastChannel,
    // rendering through the same SlideContentRenderer.vue the Tauri presentation window and
    // Remote Control mirror both use.
    live: createLiveAudienceWindowPort(),
    // displays/externalApps/remote intentionally omitted (optional on StudioAdapter) — confirmed
    // impossible in any browser (web-feature-parity.md §4/§5), not merely unbuilt.
    sync: {
      getStatus: async (): Promise<SyncStatus> => {
        const [conflicts, recovery] = await Promise.all([
          sync.detectConflicts(root),
          sync.detectRecoveryIssues(root),
        ])
        return {
          folderReadable: true,
          syncClientRunning: true,
          conflictCount: conflicts.length,
          recoveryCount: recovery.length,
        }
      },
      listRecoveryIssues: () => sync.detectRecoveryIssues(root),
      recoverFile: (filePath) => sync.recoverFromBackup(root, filePath),
      quarantineFile: (filePath) => sync.quarantineDamagedFile(root, filePath),
      listConflicts: () => sync.detectConflicts(root),
      resolveConflict: (conflictFilePath, keep) =>
        sync.resolveConflict(root, conflictFilePath, keep),
    },
    diagnostics: {
      getSummary: async (): Promise<DiagnosticSummary> => {
        const [
          songCount,
          serviceCount,
          slideCount,
          mediaCount,
          themeCount,
          peopleCount,
          conflicts,
          recovery,
        ] = await Promise.all([
          songs.list().then((list) => list.length),
          services.list().then((list) => list.length),
          slides.list().then((list) => list.length),
          media.list().then((list) => list.length),
          themes.list().then((list) => list.length),
          people.list().then((list) => list.length),
          sync.detectConflicts(root),
          sync.detectRecoveryIssues(root),
        ])
        return {
          generatedAt: new Date().toISOString(),
          appVersion: 'Web build',
          buildProfile: 'development',
          platform: navigator.platform || 'browser',
          architecture: 'browser',
          installationMode: 'web',
          setupComplete: (await settings.getMachineSettings()).hasCompletedSetup,
          libraryReadable: true,
          libraryItems: {
            songs: songCount,
            services: serviceCount,
            slides: slideCount,
            media: mediaCount,
            themes: themeCount,
            people: peopleCount,
          },
          syncConflictCount: conflicts.length,
          recoveryIssueCount: recovery.length,
          displayAssignmentCount: 0,
          remotePortMode: 'unavailable',
          logFileCount: 0,
          logBytes: 0,
        }
      },
      createBundle: async () => {
        return JSON.stringify(
          {
            privacyNotice:
              'Web build diagnostics contain operational summary data only. No local logs are available.',
            summary: {},
            logs: [],
          },
          null,
          2,
        )
      },
    },
    // Storage-independent — identical to the mock adapter's browser-download implementation.
    exports: {
      saveFile: async ({ suggestedName, mimeType, bytes }) => {
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = suggestedName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        return 'saved'
      },
    },
    // No bundled help site to open yet, same as the mock adapter.
    help: {},
  }
}
