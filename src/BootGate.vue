<script setup lang="ts">
/**
 * Root component mounted by main.ts instead of App.vue directly. App.vue calls getAdapter()
 * synchronously at <script setup> module scope, so the adapter must already be resolved before
 * App.vue is even instantiated — this component exists to do that resolution first, showing a
 * chooser/resume UI only when it's actually needed, and rendering the real App.vue unchanged
 * once ready.
 *
 * Tauri resolves instantly, no UI shown. Every other web deploy — including the public GitHub
 * Pages build, deliberately not special-cased — shows the real "Open Your Library Folder" / "Try
 * the Demo" chooser, since a real usable web build hosted for free on Pages was the actual point,
 * not a fake pitch deck. The one exception: a `?demo=1` URL param skips straight to the mock
 * adapter with no chooser at all, for the docs landing page's dedicated "Try the Web Demo" link
 * (docs/index.md) to keep that a true one-click experience.
 *
 * Two "Connect Dropbox"/"Connect OneDrive" chooser options build the tablet (PWA) adapter instead
 * — for platforms (any tablet browser) where showDirectoryPicker() doesn't exist at all, syncing
 * directly against a cloud provider's API rather than a real picked folder (see adapters/tablet/,
 * whose CloudSyncProvider abstraction is what lets this file treat both providers identically
 * below via authFor()). This is also where the OAuth redirect lands on its way back for either
 * provider (a full top-level redirect, not a popup — see beginCloudConnect's own comment for
 * why), handled before anything else in onMounted so it takes priority over every other
 * resolution path.
 *
 * A device joins by choosing its provider, pasting the church's app key/client ID, signing in, and
 * (on OneDrive) picking the library folder from a list. An earlier QR/connect-code flow was removed
 * once the folder picker made it a way to transfer a single GUID — see
 * notes/tablet-onboarding-and-account-model.md for that decision and the iOS/WebKit findings behind
 * it, which are worth reading before anyone proposes scanning a QR again.
 */
import { computed, onMounted, ref } from 'vue'
import App from '@/App.vue'
import { getAdapter, isTauri, setAdapterInstance } from '@/adapters'
import type { SyncProgress } from '@/adapters/types'
import { createMockAdapter } from '@/adapters/mock'
import { createWebAdapter } from '@/adapters/web'
import {
  clearStoredLibraryHandle,
  loadStoredLibraryHandle,
  storeLibraryHandle,
} from '@/adapters/web/handlePersistence'
import { createTabletAdapter } from '@/adapters/tablet'
import { getOpfsRoot } from '@/adapters/tablet/opfs'
import { createWebSettingsPort } from '@/adapters/web/settings'
import { usePwaInstall } from '@/composables/usePwaInstall'
import { formatSyncProgressLabel } from '@/utils/syncProgress'
import { estimateSecondsRemaining, formatSecondsRemaining, progressPercent } from '@/utils/syncEta'
import {
  authFor,
  beginCloudOAuthRedirect,
  CLOUD_OAUTH_PENDING_KEY,
  type CloudProviderId,
  type PendingCloudAuth,
} from '@/utils/cloudOAuthRedirect'
import * as onedriveAuth from '@/adapters/tablet/providers/onedriveAuth'
import {
  listChildFolders,
  listLibraryFolderChoices,
  looksLikeLibrary,
  type OneDriveFolderEntry,
} from '@/adapters/tablet/providers/onedriveLibraryRoot'
import { suggestDeviceNameForThisBrowser } from '@/utils/deviceName'
import logoDark from '@/assets/logo-dark.png'

const pwaInstall = usePwaInstall()

type Phase =
  | 'resolving'
  | 'chooser'
  | 'resuming'
  | 'cloud-connect'
  | 'connecting-cloud'
  | 'choose-folder'
  | 'initial-sync'
  | 'ready'

const phase = ref<Phase>('resolving')
const errorText = ref('')
const pendingHandle = ref<FileSystemDirectoryHandle>()
const fsaSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const initialSyncLabel = ref('')
// The raw progress, not just its label: the batch total is known upfront (see SyncProgress), so the
// first pull can show real progress rather than an indeterminate spinner that says nothing about
// whether 20 files remain or 2000.
const initialSyncProgress = ref<SyncProgress>()
const initialSyncStartedAt = ref(0)

const initialSyncPercent = computed(() =>
  progressPercent(initialSyncProgress.value?.completed ?? 0, initialSyncProgress.value?.total ?? 0),
)
const initialSyncRemaining = computed(() => {
  const progress = initialSyncProgress.value
  if (!progress || !initialSyncStartedAt.value) return ''
  const seconds = estimateSecondsRemaining(
    progress.completed,
    progress.total,
    Date.now() - initialSyncStartedAt.value,
  )
  return seconds === undefined ? '' : formatSecondsRemaining(seconds)
})

const connectProvider = ref<CloudProviderId>('dropbox')
const cloudClientIdInput = ref('')
const cloudLibraryFolderPathInput = ref('')
const connectingCloud = ref(false)

/** What this device stamps on everything it saves (`updatedByDevice`), and what
 *  SyncConflictsView shows when two devices disagree. Desktop borrows the OS hostname; a browser
 *  has no equivalent, so without asking here a tablet would stamp `''` forever — see
 *  utils/deviceName.ts and notes/setup-wizard-join-plan.md.
 *
 *  Held across the provider's OAuth redirect in localStorage rather than in PendingCloudAuth: the
 *  redirect returns to this same origin, and the scanned-QR path skips this form entirely and so
 *  has no name to carry anyway. */
const PENDING_DEVICE_NAME_KEY = 'worship-studio.pending-device-name'
const deviceNameInput = ref(suggestDeviceNameForThisBrowser())

function stashPendingDeviceName(name: string) {
  try {
    localStorage.setItem(PENDING_DEVICE_NAME_KEY, name)
  } catch {
    // Private-mode storage failures just mean finishTabletBoot falls back to the suggestion.
  }
}

function takePendingDeviceName(): string {
  try {
    const stored = localStorage.getItem(PENDING_DEVICE_NAME_KEY)
    localStorage.removeItem(PENDING_DEVICE_NAME_KEY)
    return stored?.trim() ?? ''
  } catch {
    return ''
  }
}

/** Builds the tablet adapter, caches the provider/client ID/library path locally (MachineSettings
 *  — localStorage-backed, not OPFS, so this is instant and needs no cloud round trip) so a later
 *  reload on this device boots straight back in without asking again, then activates it. */
async function finishTabletBoot(
  provider: CloudProviderId,
  clientId: string,
  libraryFolderPath: string,
  /** OneDrive's picked folder. Absent for Dropbox, and for OneDrive connections made before the
   *  picker existed — those still resolve by path. */
  picked?: { driveId: string; itemId: string },
  tabletMediaMaxCachedFileSizeMb?: number,
) {
  const adapter = await createTabletAdapter({
    provider,
    clientId,
    libraryFolderPath,
    libraryDriveId: picked?.driveId,
    libraryItemId: picked?.itemId,
    tabletMediaMaxCachedFileSizeMb,
  })
  const machineSettings = await adapter.settings.getMachineSettings()
  // A name typed on the connect form wins. It used to come *after* the stored value, which was
  // harmless while the stored default was blank — but the web adapter now seeds it with a
  // suggestion, so the stored value is never empty and the typed name was silently discarded.
  // The form is prefilled with the stored name (see onMounted), so "whatever the field says" is
  // always the operator's own answer, and a plain reload with no form still keeps what it had.
  const thisComputerName =
    takePendingDeviceName() ||
    machineSettings.thisComputerName.trim() ||
    suggestDeviceNameForThisBrowser()
  await adapter.settings.saveMachineSettings({
    ...machineSettings,
    thisComputerName,
    tabletCloudProvider: provider,
    tabletCloudClientId: clientId,
    tabletCloudLibraryFolderPath: libraryFolderPath,
    tabletCloudLibraryDriveId: picked?.driveId,
    tabletCloudLibraryItemId: picked?.itemId,
    // A tablet joins (or occasionally sets up) a shared cloud library, not a per-device blank
    // slate — App.vue's own first-run redirect otherwise fires here every time based on this
    // device's own never-used-before state, which is meaningless for a device joining a library
    // someone else already fully configured (the desktop-oriented wizard steps — display roles,
    // OpenSong file imports — mostly don't even apply to a tablet either; several are already
    // disabled for adapter.kind === 'tablet' in SetupWizardView.vue). Church branding/service
    // types remain reachable any time from Settings, wizard or not.
    hasCompletedSetup: true,
  })
  setAdapterInstance(adapter)

  // The very first sync on a brand-new device pulls the entire shared library — potentially
  // hundreds of files — before anything reads it. Letting the operator wander into pages that
  // race that initial pull (Songs/Media/etc. enumerating the same OPFS folders the sync is still
  // populating) is exactly what looked like "most pages won't navigate" in practice. A device
  // that has synced before (lastSyncedAt already set) skips this and boots straight in, same as
  // today — only the one-time initial pull is worth blocking on.
  const status = await adapter.sync.getStatus()
  if (!status.lastSyncedAt) {
    phase.value = 'initial-sync'
    initialSyncLabel.value = ''
    initialSyncProgress.value = undefined
    initialSyncStartedAt.value = Date.now()
    const pollHandle = window.setInterval(async () => {
      const progress = await adapter.sync.getProgress?.()
      initialSyncProgress.value = progress
      initialSyncLabel.value = formatSyncProgressLabel(progress)
    }, 400)
    try {
      await adapter.sync.runSync?.()
    } catch (error) {
      // A failed first sync (e.g. a transient network blip) shouldn't strand the operator on
      // this screen forever — they still get into the app below, same as if this device had
      // simply not synced yet. The in-app sync indicator (App.vue's app-bar) already surfaces an
      // ongoing "not synced"/needs-reconnect state for them to retry from there.
      console.error('Initial tablet sync failed:', error)
    } finally {
      window.clearInterval(pollHandle)
    }
  }
  phase.value = 'ready'
}

async function beginCloudConnect() {
  errorText.value = ''
  const clientId = cloudClientIdInput.value.trim()
  if (!clientId) {
    errorText.value =
      connectProvider.value === 'onedrive'
        ? 'Enter the Microsoft app client ID first.'
        : 'Enter the Dropbox app key first.'
    return
  }
  connectingCloud.value = true
  stashPendingDeviceName(deviceNameInput.value.trim())
  try {
    await beginCloudOAuthRedirect(
      connectProvider.value,
      clientId,
      cloudLibraryFolderPathInput.value.trim(),
    )
  } catch (error) {
    connectingCloud.value = false
    errorText.value = error instanceof Error ? error.message : "Couldn't start connecting."
  }
}

/** Folder picker, shown after a OneDrive sign-in. Replaces asking anyone to type a path: a shared
 *  library sits at a different path for every person it is shared with, so there is no single
 *  correct string to type — and picking yields the drive/item ids the provider actually addresses
 *  by, which survive the folder being renamed or moved. */
const pendingClientId = ref('')
const folderChoices = ref<OneDriveFolderEntry[]>([])
const folderTrail = ref<OneDriveFolderEntry[]>([])
const loadingFolders = ref(false)
const openingFolder = ref(false)
const folderPickerWarning = ref('')

async function withGraphToken<T>(run: (token: string) => Promise<T>): Promise<T | undefined> {
  const token = await onedriveAuth.getValidAccessToken(pendingClientId.value)
  if (!token) {
    errorText.value = 'The OneDrive sign-in expired before a folder was chosen. Please try again.'
    phase.value = 'chooser'
    return undefined
  }
  return run(token)
}

async function openFolderPicker() {
  phase.value = 'choose-folder'
  errorText.value = ''
  folderPickerWarning.value = ''
  folderTrail.value = []
  await loadFolderChoices()
}

async function loadFolderChoices() {
  loadingFolders.value = true
  try {
    const current = folderTrail.value[folderTrail.value.length - 1]
    const entries = await withGraphToken((token) =>
      current
        ? listChildFolders(token, current.driveId, current.itemId)
        : listLibraryFolderChoices(token),
    )
    folderChoices.value = entries ?? []
  } catch (error) {
    errorText.value =
      error instanceof Error ? error.message : "Couldn't list your OneDrive folders."
    folderChoices.value = []
  } finally {
    loadingFolders.value = false
  }
}

async function openFolder(entry: OneDriveFolderEntry) {
  folderTrail.value.push(entry)
  folderPickerWarning.value = ''
  await loadFolderChoices()
}

async function goUpFolder(index: number) {
  folderTrail.value = folderTrail.value.slice(0, index)
  folderPickerWarning.value = ''
  await loadFolderChoices()
}

/** Confirms the folder the operator is standing in. Warns rather than blocks when it holds no
 *  library — the same call the Setup Wizard makes, and for the same reason: a folder mid-sync can
 *  legitimately look empty, but the likelier cause is the wrong folder. */
async function useCurrentFolder(confirmedEmpty = false) {
  const current = folderTrail.value[folderTrail.value.length - 1]
  if (!current) return
  openingFolder.value = true
  try {
    if (!confirmedEmpty) {
      const isLibrary = await withGraphToken((token) =>
        looksLikeLibrary(token, current.driveId, current.itemId),
      )
      if (isLibrary === false) {
        folderPickerWarning.value = `"${current.name}" doesn't look like a Worship Studio library — there's no library-settings.json in it. Choose a different folder, or continue to start a new library here.`
        return
      }
    }
    await finishTabletBoot('onedrive', pendingClientId.value, folderPathLabel.value, {
      driveId: current.driveId,
      itemId: current.itemId,
    })
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "Couldn't open that folder."
  } finally {
    openingFolder.value = false
  }
}

/** Only for display and for the legacy path field — addressing uses the ids. */
const folderPathLabel = computed(() => folderTrail.value.map((entry) => entry.name).join('/'))

async function handleCloudRedirect(params: URLSearchParams) {
  phase.value = 'connecting-cloud'
  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  // Clean the URL immediately regardless of outcome, so refreshing this page never re-processes
  // (and re-fails, since these codes are single-use) the same code.
  window.history.replaceState({}, '', window.location.pathname)

  const pendingRaw = sessionStorage.getItem(CLOUD_OAUTH_PENDING_KEY)
  sessionStorage.removeItem(CLOUD_OAUTH_PENDING_KEY)
  const pending = pendingRaw ? (JSON.parse(pendingRaw) as PendingCloudAuth) : undefined
  if (!pending) {
    errorText.value =
      'The sign-in session expired, or was opened in a different tab. Please try connecting again.'
    phase.value = 'chooser'
    return
  }
  if (pending.state !== state) {
    errorText.value = "The sign-in response couldn't be verified. Please try again."
    phase.value = 'chooser'
    return
  }

  try {
    await authFor(pending.provider).exchangeCodeForTokens({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      code,
      codeVerifier: pending.codeVerifier,
    })
    // OneDrive picks its folder *after* sign-in — the account has to be known before its folders
    // can be listed, and a shared library has no path that is meaningful to type anyway (it sits
    // somewhere different for every person it is shared with). Dropbox still uses the path from
    // the connect form, since its shared folders mount inside the member's own tree.
    if (pending.provider === 'onedrive') {
      pendingClientId.value = pending.clientId
      await openFolderPicker()
      return
    }
    await finishTabletBoot(pending.provider, pending.clientId, pending.libraryFolderPath)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "Couldn't finish connecting."
    phase.value = 'chooser'
  }
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  if (params.has('code') && params.has('state')) {
    await handleCloudRedirect(params)
    return
  }

  if (isTauri()) {
    // Unchanged existing behavior — getAdapter() itself still knows how to resolve this, this
    // just makes sure it happens before App.vue reads it.
    setAdapterInstance(getAdapter())
    phase.value = 'ready'
    return
  }

  if (params.has('demo')) {
    setAdapterInstance(createMockAdapter())
    phase.value = 'ready'
    return
  }

  const stored = await loadStoredLibraryHandle().catch(() => undefined)
  if (stored) {
    const granted = await stored.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
    if (granted === 'granted') {
      setAdapterInstance(createWebAdapter(stored))
      phase.value = 'ready'
      return
    }
    pendingHandle.value = stored
    phase.value = 'resuming'
    return
  }

  // A tablet that's already connected, returning on an ordinary reload (not an OAuth redirect
  // this time) — boot straight back in rather than showing the chooser again.
  const opfsRoot = await getOpfsRoot().catch(() => undefined)
  const cachedMachineSettings = await (opfsRoot
    ? createWebSettingsPort(opfsRoot).getMachineSettings()
    : undefined)
  const cachedName = cachedMachineSettings?.thisComputerName?.trim()
  if (cachedName) deviceNameInput.value = cachedName
  const cachedProvider = cachedMachineSettings?.tabletCloudProvider
  const cachedClientId = cachedMachineSettings?.tabletCloudClientId
  if (cachedProvider && cachedClientId) {
    const alreadyConnected = await authFor(cachedProvider)
      .isConnected()
      .catch(() => false)
    if (alreadyConnected) {
      const driveId = cachedMachineSettings?.tabletCloudLibraryDriveId
      const itemId = cachedMachineSettings?.tabletCloudLibraryItemId
      await finishTabletBoot(
        cachedProvider,
        cachedClientId,
        cachedMachineSettings?.tabletCloudLibraryFolderPath ?? '',
        driveId && itemId ? { driveId, itemId } : undefined,
        cachedMachineSettings?.tabletMediaMaxCachedFileSizeMb,
      )
      return
    }
  }

  phase.value = 'chooser'
})

async function chooseDemo() {
  setAdapterInstance(createMockAdapter())
  phase.value = 'ready'
}

async function chooseFolder() {
  errorText.value = ''
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await storeLibraryHandle(handle)
    setAdapterInstance(createWebAdapter(handle))
    phase.value = 'ready'
  } catch (error) {
    // AbortError: the user cancelled the native picker — not a real failure, just stay put.
    if ((error as DOMException)?.name !== 'AbortError') {
      errorText.value = 'Could not open that folder. Please try again.'
    }
  }
}

async function resumeAccess() {
  errorText.value = ''
  const handle = pendingHandle.value
  if (!handle) return
  const granted = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
  if (granted === 'granted') {
    setAdapterInstance(createWebAdapter(handle))
    phase.value = 'ready'
    return
  }
  errorText.value = 'Access was not granted. You can pick a folder again below.'
}

async function pickDifferentFolder() {
  await clearStoredLibraryHandle().catch(() => {})
  pendingHandle.value = undefined
  errorText.value = ''
  phase.value = 'chooser'
}

function showCloudConnectForm(provider: CloudProviderId) {
  errorText.value = ''
  connectProvider.value = provider
  phase.value = 'cloud-connect'
}
</script>

<template>
  <App v-if="phase === 'ready'" />
  <div v-else class="boot-gate">
    <v-card class="boot-card" elevation="8">
      <v-card-text class="boot-card-content">
        <img :src="logoDark" alt="Worship Studio" class="boot-logo" />

        <template v-if="phase === 'resolving'">
          <p class="boot-status">Loading…</p>
        </template>

        <!-- Two genuinely different first runs. A tablet has no folder to open — showDirectoryPicker
             does not exist there — so rather than offering it disabled with an apology, that whole
             route is hidden and connecting to the church's cloud library becomes the main event.
             A desktop browser gets the folder first, with cloud connect alongside it. -->
        <template v-else-if="phase === 'chooser'">
          <template v-if="fsaSupported">
            <p class="boot-lead">
              Open your church's library folder to prepare services, or connect to it in the cloud.
            </p>
            <v-btn color="primary" size="large" block @click="chooseFolder">
              Open Your Library Folder
            </v-btn>

            <div class="boot-or"><span>or connect a cloud library</span></div>

            <v-btn variant="outlined" size="large" block @click="showCloudConnectForm('onedrive')">
              Connect OneDrive
            </v-btn>
            <v-btn
              variant="outlined"
              size="large"
              block
              class="mt-2"
              @click="showCloudConnectForm('dropbox')"
            >
              Connect Dropbox
            </v-btn>
          </template>

          <template v-else>
            <p class="boot-lead">Connect this device to your church's library.</p>

            <!-- Install first, and say so before offering the connection: on iOS a browser tab and
                 the installed app are separate storage, so connecting here and then installing
                 means doing it twice. -->
            <div v-if="!pwaInstall.isStandalone.value" class="boot-install-first">
              <div class="boot-install-heading">
                <v-icon icon="mdi-cellphone-arrow-down" size="20" />
                <strong>Install the app first</strong>
              </div>
              <p v-if="pwaInstall.isIos.value">
                Tap the Share button, then <strong>Add to Home Screen</strong>. Open Worship Studio
                from your home screen and connect there — a browser tab and the installed app keep
                separate data, so connecting here would only have to be done again.
              </p>
              <p v-else>
                Install Worship Studio to your home screen, then open it from there and connect —
                the installed app keeps its own data.
              </p>
              <v-btn
                v-if="pwaInstall.canInstall.value"
                variant="flat"
                color="primary"
                size="small"
                class="mt-1"
                prepend-icon="mdi-cellphone-arrow-down"
                @click="pwaInstall.promptInstall"
              >
                Install as an App
              </v-btn>
            </div>

            <p class="boot-note">
              You'll need your church's app ID. Anyone already connected can find it under Settings
              &gt; Library &amp; Sync &gt; Add Another Device.
            </p>
            <v-btn
              color="primary"
              size="large"
              block
              class="mt-2"
              @click="showCloudConnectForm('onedrive')"
            >
              Connect OneDrive
            </v-btn>
            <v-btn
              variant="outlined"
              size="large"
              block
              class="mt-2"
              @click="showCloudConnectForm('dropbox')"
            >
              Connect Dropbox
            </v-btn>
          </template>

          <v-divider class="my-3" />

          <v-btn variant="text" size="large" block @click="chooseDemo"> Try the Demo </v-btn>

          <!-- Already installed, or a desktop browser: the install affordance is either irrelevant
               or a small convenience, so it sits at the bottom rather than leading. -->
          <v-btn
            v-if="pwaInstall.canInstall.value && fsaSupported"
            variant="tonal"
            size="small"
            block
            class="mt-3"
            prepend-icon="mdi-cellphone-arrow-down"
            @click="pwaInstall.promptInstall"
          >
            Install as an App
          </v-btn>
        </template>

        <template v-else-if="phase === 'resuming'">
          <p class="boot-lead">Resume access to your library folder to continue.</p>
          <v-btn color="primary" size="large" block @click="resumeAccess">Resume Access</v-btn>
          <v-btn variant="text" size="large" block class="mt-2" @click="pickDifferentFolder">
            Pick a Different Folder
          </v-btn>
        </template>

        <template v-else-if="phase === 'cloud-connect'">
          <p class="boot-lead">
            Connect to your church's {{ connectProvider === 'onedrive' ? 'OneDrive' : 'Dropbox' }}
            account to sync this device's library.
          </p>
          <v-text-field
            v-model="cloudClientIdInput"
            :label="connectProvider === 'onedrive' ? 'Microsoft app client ID' : 'Dropbox app key'"
            variant="outlined"
            density="compact"
            autocomplete="off"
            hint="One per church, not one per device. Copy it from any connected device under Settings > Library &amp; Sync > Add Another Device, or from whoever registered the app."
            persistent-hint
            class="mb-3"
          />
          <!-- OneDrive picks its folder from a list after sign-in instead: a shared library sits at
               a different path for every person, so there is no correct string to type here. -->
          <v-text-field
            v-if="connectProvider !== 'onedrive'"
            v-model="cloudLibraryFolderPathInput"
            label="Library folder path (optional)"
            variant="outlined"
            density="compact"
            autocomplete="off"
            placeholder="/Church/WorshipStudio/Library"
            hint="The folder holding the library. Keep it a real folder rather than the account root, so it can be shared with other people later."
            persistent-hint
            class="mb-3"
          />
          <v-text-field
            v-model="deviceNameInput"
            label="Name for this device"
            variant="outlined"
            density="compact"
            autocomplete="off"
            placeholder="Sanctuary iPad"
            hint="Shown when this device's changes conflict with another's. Give each device its own name."
            persistent-hint
            class="mb-3"
          />
          <v-btn
            color="primary"
            size="large"
            block
            :loading="connectingCloud"
            @click="beginCloudConnect"
          >
            Connect {{ connectProvider === 'onedrive' ? 'OneDrive' : 'Dropbox' }}
          </v-btn>
          <p v-if="connectProvider === 'onedrive'" class="boot-note mt-2">
            You'll sign in, then pick the library folder from a list — nothing else to type.
          </p>
          <v-btn variant="text" size="large" block class="mt-2" @click="phase = 'chooser'">
            Back
          </v-btn>
        </template>

        <template v-else-if="phase === 'connecting-cloud'">
          <p class="boot-status">Finishing sign-in…</p>
        </template>

        <template v-else-if="phase === 'choose-folder'">
          <p class="boot-lead">
            Choose your church's library folder. One shared with you is listed by its own name and
            marked "Shared with you" — open a folder to look inside it.
          </p>

          <nav class="folder-crumbs" aria-label="Folder path">
            <button type="button" :disabled="loadingFolders" @click="goUpFolder(0)">
              OneDrive
            </button>
            <template v-for="(crumb, index) in folderTrail" :key="crumb.itemId">
              <span aria-hidden="true">›</span>
              <button
                type="button"
                :disabled="loadingFolders || index === folderTrail.length - 1"
                @click="goUpFolder(index + 1)"
              >
                {{ crumb.name }}
              </button>
            </template>
          </nav>

          <v-alert v-if="folderPickerWarning" type="warning" variant="tonal" class="mb-3">
            {{ folderPickerWarning }}
          </v-alert>

          <div v-if="loadingFolders" class="folder-loading">
            <v-progress-circular indeterminate color="primary" size="26" />
          </div>
          <p v-else-if="!folderChoices.length" class="boot-note">
            No folders here.{{ folderTrail.length ? ' Go back up to choose a different one.' : '' }}
          </p>
          <ul v-else class="folder-list">
            <li v-for="entry in folderChoices" :key="entry.driveId + entry.itemId">
              <button type="button" :disabled="openingFolder" @click="openFolder(entry)">
                <v-icon
                  :icon="entry.shared ? 'mdi-folder-account-outline' : 'mdi-folder-outline'"
                  size="20"
                />
                <span>{{ entry.name }}</span>
                <small v-if="entry.shared">Shared with you</small>
                <v-icon icon="mdi-chevron-right" size="18" />
              </button>
            </li>
          </ul>

          <v-btn
            v-if="folderTrail.length"
            color="primary"
            size="large"
            block
            class="mt-3"
            :loading="openingFolder"
            @click="useCurrentFolder(Boolean(folderPickerWarning))"
          >
            {{
              folderPickerWarning
                ? 'Use It Anyway'
                : `Use "${folderTrail[folderTrail.length - 1]!.name}"`
            }}
          </v-btn>
        </template>

        <template v-else-if="phase === 'initial-sync'">
          <p class="boot-status">Downloading your church's library…</p>
          <!-- Determinate as soon as the batch total is known — the spinner it replaced could not
               distinguish 20 files left from 2000. Falls back to indeterminate for the moment
               before the first poll returns, when there is genuinely nothing to report. -->
          <v-progress-linear
            v-if="initialSyncProgress?.total"
            :model-value="initialSyncPercent"
            color="primary"
            height="8"
            rounded
            class="my-1"
          />
          <v-progress-circular
            v-else
            indeterminate
            color="primary"
            size="32"
            class="boot-spinner mb-2"
          />
          <p v-if="initialSyncLabel" class="boot-note">{{ initialSyncLabel }}</p>
          <p v-if="initialSyncRemaining" class="boot-note">{{ initialSyncRemaining }}</p>
          <p class="boot-note">This only happens once on this device.</p>
        </template>

        <p v-if="errorText" class="boot-error" role="alert">{{ errorText }}</p>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.boot-gate {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  padding: 16px;
  /* Scrolls rather than clips. `align-items: center` would centre a card taller than the viewport
     by overflowing it equally top and bottom, putting the top out of reach with no way to scroll
     to it — reachable on a phone in landscape, and likelier now the tablet route carries install
     guidance as well as two connect buttons. `margin: auto` on the child centres when there is
     room and lets the container scroll when there is not. */
  overflow-y: auto;
}
.boot-card {
  width: 100%;
  max-width: 420px;
  margin: auto;
}

/* A labelled rule, so the cloud option reads as a genuine alternative rather than a lesser
   afterthought — it is how the first device in a church gets set up. */
.boot-or {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.74rem;
}
.boot-or::before,
.boot-or::after {
  flex: 1;
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.16);
  content: '';
}

/* Instructions, so left-aligned — the card centres everything else, which reads fine for a line or
   two but badly for a sequence of steps. */
.boot-install-first {
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.08);
  text-align: left;
}
.boot-install-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.85rem;
}
.boot-install-first p {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  opacity: 0.8;
}
.boot-card-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 32px 28px;
  text-align: center;
}
.boot-logo {
  align-self: center;
  width: min(70%, 260px);
  height: auto;
  margin-bottom: 8px;
}
/* These are raw <button>s and nothing in this app resets them, so without this they render with
   the browser's default grey button face — which read as chunky chips rather than list rows. */
.folder-crumbs button,
.folder-list button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.folder-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 0.76rem;
}
.folder-crumbs button {
  padding: 2px 4px;
  border-radius: 5px;
  color: rgb(var(--v-theme-primary));
}
.folder-crumbs button:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.1);
}
.folder-crumbs button:disabled {
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: default;
}
.folder-crumbs span {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.folder-loading {
  display: grid;
  padding: 24px 0;
  place-items: center;
}
.folder-list {
  max-height: 40vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  list-style: none;
}
.folder-list li + li {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.folder-list button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  text-align: left;
}
.folder-list button:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.08);
}
.folder-list button > span {
  overflow: hidden;
  flex: 1;
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Muted and secondary — a folder's name is what someone scans for, not its origin. */
.folder-list small {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.66rem;
}
.folder-list .v-icon:first-child {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.folder-list .v-icon:last-child {
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.boot-lead {
  margin-bottom: 8px;
  opacity: 0.85;
}
.boot-status {
  opacity: 0.7;
}
/* The card is a flex column, so `text-align: center` on it never moved this — a flex item with a
   fixed size aligns to the start unless told otherwise. */
.boot-spinner {
  align-self: center;
}
.boot-note {
  margin-top: -4px;
  font-size: 0.8rem;
  opacity: 0.65;
}
.boot-error {
  margin-top: 4px;
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}
</style>
