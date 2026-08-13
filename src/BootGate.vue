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
 * resolution path — and where a scanned `?connectCode=` link lands (see the `connectCode` param
 * handling below and connectCode.ts's own doc comment for why the QR still carries a real URL —
 * reliable for both iOS's and Android's camera to open). What happens next differs by platform:
 * iOS always opens that link in a plain Safari tab (no way to route it into an already-installed
 * PWA), a separate storage partition from the installed app, so it only shows a copy-code landing
 * page rather than risk auto-connecting into storage the installed app will never see; Android's
 * link capturing often routes it straight into the already-installed PWA instead (confirmed on a
 * real device), where there's no such risk, so it connects directly with no copy/paste needed.
 * "Add Another Device" (LibrarySyncSection.vue) is this flow's other end: the connect code a
 * second device pastes here, or scans as that URL, to skip typing its app key/client ID by hand.
 */
import { onMounted, ref } from 'vue'
import App from '@/App.vue'
import { getAdapter, isTauri, setAdapterInstance } from '@/adapters'
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
import { parseConnectCode, type ConnectCode } from '@/utils/connectCode'
import {
  authFor,
  beginCloudOAuthRedirect,
  CLOUD_OAUTH_PENDING_KEY,
  type CloudProviderId,
  type PendingCloudAuth,
} from '@/utils/cloudOAuthRedirect'
import logoDark from '@/assets/logo-dark.png'

const pwaInstall = usePwaInstall()

type Phase =
  | 'resolving'
  | 'chooser'
  | 'resuming'
  | 'show-connect-code'
  | 'cloud-connect'
  | 'connecting-cloud'
  | 'initial-sync'
  | 'ready'

const phase = ref<Phase>('resolving')
const errorText = ref('')
const pendingHandle = ref<FileSystemDirectoryHandle>()
const fsaSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const initialSyncLabel = ref('')

const connectProvider = ref<CloudProviderId>('dropbox')
const cloudClientIdInput = ref('')
const cloudLibraryFolderPathInput = ref('')
const connectingCloud = ref(false)

/** Builds the tablet adapter, caches the provider/client ID/library path locally (MachineSettings
 *  — localStorage-backed, not OPFS, so this is instant and needs no cloud round trip) so a later
 *  reload on this device boots straight back in without asking again, then activates it. */
async function finishTabletBoot(
  provider: CloudProviderId,
  clientId: string,
  libraryFolderPath: string,
  tabletMediaMaxCachedFileSizeMb?: number,
) {
  const adapter = await createTabletAdapter({
    provider,
    clientId,
    libraryFolderPath,
    tabletMediaMaxCachedFileSizeMb,
  })
  const machineSettings = await adapter.settings.getMachineSettings()
  await adapter.settings.saveMachineSettings({
    ...machineSettings,
    tabletCloudProvider: provider,
    tabletCloudClientId: clientId,
    tabletCloudLibraryFolderPath: libraryFolderPath,
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
    const pollHandle = window.setInterval(async () => {
      initialSyncLabel.value = formatSyncProgressLabel(await adapter.sync.getProgress?.())
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
    await finishTabletBoot(pending.provider, pending.clientId, pending.libraryFolderPath)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "Couldn't finish connecting."
    phase.value = 'chooser'
  }
}

// A connect code pasted from another already-connected device's Settings page ("Add Another
// Device") — pre-fills and immediately starts the connect flow so this device never needs the
// app key/client ID typed in by hand.
async function applyConnectCode(code: ConnectCode): Promise<void> {
  connectProvider.value = code.provider
  cloudClientIdInput.value = code.clientId
  cloudLibraryFolderPathInput.value = code.libraryFolderPath
  phase.value = 'cloud-connect'
  if (cloudClientIdInput.value) await beginCloudConnect()
}

const connectCodeInput = ref('')

/** parseConnectCode rejects anything that isn't actually one of this app's own connect codes (a
 *  Remote Control pairing code pasted by mistake, random text) — surfaced right here rather than
 *  deeper in the connect flow, and the operator can just fix the paste and try again. */
async function submitConnectCode(): Promise<void> {
  const code = parseConnectCode(connectCodeInput.value)
  if (!code) {
    errorText.value = "That doesn't look like a Worship Studio connect code. Check the paste and try again."
    return
  }
  errorText.value = ''
  await applyConnectCode(code)
}

// Reached via a scanned `?connectCode=` URL. iOS can't route a tapped/scanned link into an
// already-installed PWA at all — it's always a plain Safari tab there, with a completely separate
// storage partition from the installed app, so auto-connecting from that tab would just complete
// the OAuth+sync flow into storage the installed app will never see (the exact double-sync problem
// the connect-code approach exists to avoid). Android is different — its OS-level link capturing
// often DOES route the link straight into the already-installed PWA, confirmed on a real device —
// so in that case there's no separate-storage risk at all, and making the operator copy a code
// only to paste it right back into the very same app they're already standing in is pure friction
// with no safety benefit. pwaInstall.isStandalone (set in that composable's own onMounted, which
// runs before this one — see usePwaInstall.ts) is what tells the two cases apart: apply directly
// when already standalone, otherwise fall back to the copy-code landing page below for whatever
// browser tab this turned out to be.
const connectCodeToShow = ref('')
const connectCodeToShowCopied = ref(false)
async function copyConnectCodeToShow() {
  await navigator.clipboard.writeText(connectCodeToShow.value)
  connectCodeToShowCopied.value = true
  setTimeout(() => (connectCodeToShowCopied.value = false), 2000)
}
function selectConnectCodeToShow(event: FocusEvent) {
  ;(event.target as HTMLInputElement)?.select()
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  if (params.has('code') && params.has('state')) {
    await handleCloudRedirect(params)
    return
  }

  if (params.has('connectCode')) {
    window.history.replaceState({}, '', window.location.pathname)
    const raw = params.get('connectCode') ?? ''
    const code = parseConnectCode(raw)
    if (!code) {
      errorText.value = 'That connect code looks invalid. Ask the other device to show it again.'
      phase.value = 'chooser'
    } else if (pwaInstall.isStandalone.value) {
      await applyConnectCode(code)
    } else {
      connectCodeToShow.value = raw
      phase.value = 'show-connect-code'
    }
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
  const cachedProvider = cachedMachineSettings?.tabletCloudProvider
  const cachedClientId = cachedMachineSettings?.tabletCloudClientId
  if (cachedProvider && cachedClientId) {
    const alreadyConnected = await authFor(cachedProvider)
      .isConnected()
      .catch(() => false)
    if (alreadyConnected) {
      await finishTabletBoot(
        cachedProvider,
        cachedClientId,
        cachedMachineSettings?.tabletCloudLibraryFolderPath ?? '',
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

// "Connect Dropbox"/"Connect OneDrive" (typed app key/client ID) is now truly a one-time,
// once-per-church setup step — every device after the first should use Scan to Connect instead,
// so the manual form is demoted behind this disclosure rather than shown by default.
const showAdvancedConnect = ref(false)
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

        <template v-else-if="phase === 'chooser'">
          <p class="boot-lead">
            Open your church's library folder to prepare services, or try the demo with sample data.
          </p>
          <v-btn color="primary" size="large" block :disabled="!fsaSupported" @click="chooseFolder">
            Open Your Library Folder
          </v-btn>
          <p v-if="!fsaSupported" class="boot-note">
            This browser doesn't support opening a real folder — try Chrome or Edge. You can still
            try the demo below.
          </p>

          <v-divider class="my-2" />

          <p class="boot-lead">
            On a tablet or phone — join your church's library, already synced on another device.
          </p>
          <p class="boot-note">
            On the already-connected device, go to Settings &gt; Library &amp; Sync &gt; Add
            Another Device. Scan that QR code with your camera app (not this one) — it opens a
            page with a Copy Code button — or just copy the code shown there directly.
          </p>
          <v-textarea
            v-model="connectCodeInput"
            label="Paste connect code"
            variant="outlined"
            density="compact"
            rows="3"
            auto-grow
            hide-details
            class="mb-2"
          />
          <v-btn
            color="primary"
            size="large"
            block
            :disabled="!connectCodeInput.trim()"
            @click="submitConnectCode"
          >
            Connect
          </v-btn>
          <p v-if="!pwaInstall.isStandalone.value" class="boot-note">
            For the smoothest experience, install this as an app first (below), then come back
            and paste the code.
          </p>

          <v-btn variant="text" size="large" block class="mt-2" @click="chooseDemo">
            Try the Demo
          </v-btn>

          <v-btn
            v-if="pwaInstall.canInstall.value"
            variant="tonal"
            size="small"
            block
            class="mt-3"
            prepend-icon="mdi-cellphone-arrow-down"
            @click="pwaInstall.promptInstall"
          >
            Install as an App
          </v-btn>
          <p v-else-if="pwaInstall.isIos.value" class="boot-note mt-3">
            On an iPhone/iPad: tap Share, then "Add to Home Screen" to install this as an app.
          </p>

          <v-btn
            variant="text"
            size="small"
            block
            class="mt-3"
            @click="showAdvancedConnect = !showAdvancedConnect"
          >
            {{ showAdvancedConnect ? 'Hide Advanced Options' : 'Advanced: First Device Setup' }}
          </v-btn>
          <template v-if="showAdvancedConnect">
            <p class="boot-note">
              Only needed once per church, to connect the very first device — every device after
              that should use Scan to Connect above instead.
            </p>
            <v-btn
              variant="outlined"
              size="large"
              block
              class="mt-2"
              @click="showCloudConnectForm('dropbox')"
            >
              Connect Dropbox
            </v-btn>
            <v-btn
              variant="outlined"
              size="large"
              block
              class="mt-2"
              @click="showCloudConnectForm('onedrive')"
            >
              Connect OneDrive
            </v-btn>
          </template>
        </template>

        <template v-else-if="phase === 'resuming'">
          <p class="boot-lead">Resume access to your library folder to continue.</p>
          <v-btn color="primary" size="large" block @click="resumeAccess">Resume Access</v-btn>
          <v-btn variant="text" size="large" block class="mt-2" @click="pickDifferentFolder">
            Pick a Different Folder
          </v-btn>
        </template>

        <template v-else-if="phase === 'show-connect-code'">
          <p class="boot-lead">
            Copy this connect code, then open Worship Studio — install it as an app first if you
            haven't (Share &gt; Add to Home Screen) — and paste the code there to finish
            connecting this device.
          </p>
          <v-textarea
            :model-value="connectCodeToShow"
            label="Connect code"
            variant="outlined"
            density="compact"
            rows="3"
            readonly
            hide-details
            class="mb-2"
            @focus="selectConnectCodeToShow"
          />
          <v-btn
            color="primary"
            size="large"
            block
            prepend-icon="mdi-content-copy"
            @click="copyConnectCodeToShow"
          >
            {{ connectCodeToShowCopied ? 'Copied' : 'Copy Code' }}
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
            hint="Needed once per church, not once per device — ask whoever registered the app, or (on any device that's already connected) go to Settings and use Add Another Device to skip typing this in."
            persistent-hint
            class="mb-3"
          />
          <v-text-field
            v-model="cloudLibraryFolderPathInput"
            label="Library folder path (optional)"
            variant="outlined"
            density="compact"
            autocomplete="off"
            placeholder="/Church/WorshipStudio Library"
            hint="Leave blank if the library lives at the root of the account."
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
          <v-btn variant="text" size="large" block class="mt-2" @click="phase = 'chooser'">
            Back
          </v-btn>
        </template>

        <template v-else-if="phase === 'connecting-cloud'">
          <p class="boot-status">Finishing sign-in…</p>
        </template>

        <template v-else-if="phase === 'initial-sync'">
          <p class="boot-status">Downloading your church's library…</p>
          <v-progress-circular indeterminate color="primary" size="32" class="mb-2" />
          <p v-if="initialSyncLabel" class="boot-note">{{ initialSyncLabel }}</p>
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
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.boot-card {
  width: 100%;
  max-width: 420px;
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
.boot-lead {
  margin-bottom: 8px;
  opacity: 0.85;
}
.boot-status {
  opacity: 0.7;
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
