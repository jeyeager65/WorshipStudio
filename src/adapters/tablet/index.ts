/**
 * StudioAdapter for the tablet (PWA) build — an OPFS-backed local cache kept in sync with the
 * church's library directly over a cloud provider's API (cloudSync.ts, driven through whichever
 * providers/*.ts implementation this device connected with), rather than through a real picked
 * folder (adapters/web/, needs showDirectoryPicker — unavailable on any tablet browser) or the
 * desktop app itself. See notes/completion-audit.md for the design discussion this was built
 * from.
 *
 * Every storage-shaped port (songs/services/slides/media/themes/people/announcements/diagnostics)
 * is now real, reusing the *unmodified* web/*.ts implementations against the dirty-tracking-
 * wrapped OPFS root — the same mechanical-reuse strategy the web adapter itself is built on,
 * since every one of those ports only ever depends on the plain FileSystemDirectoryHandle
 * interface. Media's local-only side gets its own OPFS subfolder (localMediaRoot.ts) built off
 * the *raw*, untracked root, so 'local' items structurally cannot leak into a push.
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
import { createWebAnnouncementsPort } from '@/adapters/web/announcements'
import { createWebMediaPort } from '@/adapters/web/media'
import { createWebPeoplePort } from '@/adapters/web/people'
import { listApiBibleCatalog, resolveApiBible, resolveEsv } from '@/adapters/web/scripture'
import { createWebServicesPort } from '@/adapters/web/services'
import { createWebSettingsPort } from '@/adapters/web/settings'
import { createWebSlidesPort } from '@/adapters/web/slides'
import { createWebSongsPort } from '@/adapters/web/songs'
import { createWebThemesPort } from '@/adapters/web/themes'
import * as sync from '@/adapters/web/sync'
import { createCloudSync } from './cloudSync'
import { wrapWithDirtyTracking } from './dirtyTrackingRoot'
import { createTabletLocalMediaRoot } from './localMediaRoot'
import { getOpfsRoot } from './opfs'
import { createDropboxProvider } from './providers/dropbox'
import { createOneDriveProvider } from './providers/onedrive'
import type { CloudSyncProvider } from './providers/types'
import { syncStore } from './syncStore'

const DEFAULT_MAX_CACHED_FILE_SIZE_MB = 200

export interface TabletAdapterConfig {
  provider: 'dropbox' | 'onedrive'
  /** The provider's app key (Dropbox) or client ID (OneDrive) — see providers/dropbox.ts /
   *  providers/onedrive.ts for what each expects. */
  clientId: string
  /** Path (relative to the connected account's root) where the library lives. */
  libraryFolderPath: string
  tabletMediaMaxCachedFileSizeMb?: number
}

function createProvider(config: TabletAdapterConfig): CloudSyncProvider {
  if (config.provider === 'onedrive') {
    return createOneDriveProvider({ clientId: config.clientId, libraryFolderPath: config.libraryFolderPath })
  }
  return createDropboxProvider({ appKey: config.clientId, libraryFolderPath: config.libraryFolderPath })
}

export async function createTabletAdapter(config: TabletAdapterConfig): Promise<StudioAdapter> {
  const rawRoot = await getOpfsRoot()
  // Every operator-facing port below is built against this wrapped root, not rawRoot directly —
  // that's what lets cloudSync.ts find out what changed locally since the last push without
  // any of those ports needing to know sync exists at all. cloudSync.ts itself is handed
  // rawRoot instead (see that file's own doc comment for why: applying a pulled remote change,
  // or writing a conflict artifact, must never itself register as a local edit needing push).
  const trackedRoot = wrapWithDirtyTracking(rawRoot, (path, kind) => {
    void syncStore.setDirty(path, { deleted: kind === 'remove', attempts: 0, nextRetryAt: 0 })
  })

  const settings = createWebSettingsPort(trackedRoot)
  const songs = createWebSongsPort(trackedRoot, settings)
  const themes = createWebThemesPort(trackedRoot, settings)
  const services = createWebServicesPort(trackedRoot, settings, songs)
  const slides = createWebSlidesPort(trackedRoot, settings)
  const media = createWebMediaPort(trackedRoot, settings, themes, createTabletLocalMediaRoot(rawRoot))
  const people = createWebPeoplePort(trackedRoot, settings)
  const announcements = createWebAnnouncementsPort(trackedRoot, settings)

  const cloudSync = createCloudSync({
    provider: createProvider(config),
    root: rawRoot,
    maxCachedFileSizeBytes:
      (config.tabletMediaMaxCachedFileSizeMb ?? DEFAULT_MAX_CACHED_FILE_SIZE_MB) * 1024 * 1024,
  })

  return {
    kind: 'tablet',
    songs,
    services,
    slides,
    media,
    themes,
    people,
    announcements,
    settings,
    // Identical to adapters/web/index.ts's scripture port — storage-independent (KJV lookup and
    // reference parsing are pure; ESV/api.bible are plain network calls), so it's reused
    // unmodified rather than reimplemented, same dispatch rules as Rust's resolve_scripture.
    scripture: {
      resolve: async (reference, translationCode): Promise<ScripturePassage> => {
        if (translationCode === 'ESV') {
          const machineSettings = await settings.getMachineSettings()
          const apiKey = machineSettings.esvApiKey
          if (!apiKey) throw new Error("The ESV API isn't configured on this machine.")
          return resolveEsv(reference, apiKey)
        }
        if (translationCode !== 'KJV') {
          const librarySettings = await settings.getLibrarySettings()
          const entry = librarySettings.apiBibleTranslations.find((t) => t.code === translationCode)
          if (entry) {
            const machineSettings = await settings.getMachineSettings()
            const apiKey = machineSettings.apiBibleKey
            if (!apiKey) throw new Error("The api.bible API isn't configured on this machine.")
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
        const [machineSettings, librarySettings] = await Promise.all([
          settings.getMachineSettings(),
          settings.getLibrarySettings(),
        ])
        const translations = [{ code: 'KJV', name: 'King James Version' }]
        if (machineSettings.esvApiKey) {
          translations.push({ code: 'ESV', name: 'English Standard Version' })
        }
        if (machineSettings.apiBibleKey) {
          for (const t of librarySettings.apiBibleTranslations) {
            translations.push({ code: t.code, name: t.label })
          }
        }
        return translations
      },
      listApiBibleCatalog: async (apiKey) => {
        const key = apiKey || (await settings.getMachineSettings()).apiBibleKey
        if (!key) throw new Error("The api.bible API isn't configured on this machine.")
        return listApiBibleCatalog(key)
      },
    },
    // Identical to adapters/web/index.ts's live port — a plain window.open() + BroadcastChannel,
    // genuinely storage-independent.
    live: createLiveAudienceWindowPort(),
    sync: {
      getStatus: async (): Promise<SyncStatus> => {
        const [conflicts, recovery, cloudStatus] = await Promise.all([
          sync.detectConflicts(trackedRoot),
          sync.detectRecoveryIssues(trackedRoot),
          cloudSync.getSyncStatus(),
        ])
        return {
          folderReadable: true,
          syncClientRunning: true,
          conflictCount: conflicts.length,
          recoveryCount: recovery.length,
          lastSyncedAt: cloudStatus.lastSyncedAt,
          pendingPushCount: cloudStatus.pendingPushCount,
          needsReconnect: cloudStatus.needsReconnect,
        }
      },
      listRecoveryIssues: () => sync.detectRecoveryIssues(trackedRoot),
      recoverFile: (filePath) => sync.recoverFromBackup(trackedRoot, filePath),
      quarantineFile: (filePath) => sync.quarantineDamagedFile(trackedRoot, filePath),
      listConflicts: () => sync.detectConflicts(trackedRoot),
      // Deliberately rawRoot, not trackedRoot: rewriting the original file (on 'theirs') and
      // removing the conflict artifact are both handled precisely by cloudSync.resolveConflict
      // below (it already knows the exact remote rev involved) — going through the dirty-tracked
      // root here would just fire a second, imprecise dirty marking on top of that.
      resolveConflict: async (conflictFilePath, keep) => {
        await sync.resolveConflict(rawRoot, conflictFilePath, keep)
        await cloudSync.resolveConflict(conflictFilePath, keep)
      },
      runSync: () => cloudSync.runSync(),
      getProgress: () => cloudSync.getProgress(),
    },
    // Identical shape to adapters/web/index.ts's diagnostics port, plus the cloud-sync-specific
    // counts sync.getStatus() above already surfaces separately.
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
          sync.detectConflicts(trackedRoot),
          sync.detectRecoveryIssues(trackedRoot),
        ])
        return {
          generatedAt: new Date().toISOString(),
          appVersion: 'Tablet build',
          buildProfile: 'development',
          platform: navigator.platform || 'browser',
          architecture: 'browser',
          installationMode: 'tablet',
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
              'Tablet build diagnostics contain operational summary data only. No local logs are available.',
            summary: {},
            logs: [],
          },
          null,
          2,
        )
      },
    },
    // Identical to adapters/web/index.ts's exports port — a plain browser download, genuinely
    // storage-independent.
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
    help: {},
  }
}
