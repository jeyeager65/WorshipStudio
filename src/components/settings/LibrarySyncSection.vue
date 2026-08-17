<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { useSongsStore } from '@/stores/songs'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { clearStoredLibraryHandle } from '@/adapters/web/handlePersistence'
import { disconnect as disconnectDropbox, isConnected as isDropboxConnected } from '@/adapters/tablet/providers/dropboxAuth'
import { disconnect as disconnectOneDrive, isConnected as isOneDriveConnected } from '@/adapters/tablet/providers/onedriveAuth'
import { generateQrCodeDataUrl } from '@/utils/qrCode'
import { buildConnectCode } from '@/utils/connectCode'
import { formatSyncProgressLabel } from '@/utils/syncProgress'
import { beginCloudOAuthRedirect } from '@/utils/cloudOAuthRedirect'
import {
  buildSampleServices,
  sampleSongs,
  sampleThemes,
  samplePeople,
  sampleCollections,
  sampleRoleGroups,
  sampleServiceTemplates,
  sampleServiceTypes,
} from '@/utils/sampleData'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const store = useSettingsStore()
const { librarySettings, machineSettings } = storeToRefs(store)
const syncStore = useSyncStore()
const songsStore = useSongsStore()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const themesStore = useThemesStore()
const mediaStore = useMediaStore()
const songCollectionsStore = useSongCollectionsStore()
const serviceTypesStore = useServiceTypesStore()
const confirmDialog = useConfirmDialogStore()

// Every Data Tools action below persists immediately on its own (direct store/adapter calls,
// not the Settings page's own Save button) and has no reasonable "undo" back to a half-deleted
// state — so each one tells the parent to re-baseline the page's undo/save-dirty tracking
// against the now-current, already-saved state, rather than leaving a stale "unsaved changes"
// prompt (or a misleading Undo entry) behind for something that already happened for real.
const emit = defineEmits<{ 'bulk-data-change': [] }>()

// This one page now covers every adapter kind's idea of "where the library lives" — a real
// folder (tauri/web) or a cloud provider connection (tablet, over whichever of
// adapters/tablet/providers/*.ts this device connected through). Data tools works identically
// for tablet now too — the songs/services/media/... ports it acts through are real there
// (adapters/tablet/index.ts, Phase 4 of the design).
const adapterKind = getAdapter().kind
const isCloudConnected = adapterKind === 'tablet'
const cloudProvider = computed(() => machineSettings.value?.tabletCloudProvider ?? 'dropbox')
const cloudProviderLabel = computed(() => (cloudProvider.value === 'onedrive' ? 'OneDrive' : 'Dropbox'))

const syncProgressLabel = computed(() => formatSyncProgressLabel(syncStore.progress))

const cloudConnected = ref(false)
const disconnectingCloud = ref(false)
const cloudActionError = ref('')
onMounted(async () => {
  if (!isCloudConnected) return
  cloudConnected.value = await (cloudProvider.value === 'onedrive' ? isOneDriveConnected() : isDropboxConnected())
})

// The app key/client ID this device connected with isn't editable here: it's bound to the OAuth
// tokens already held for that specific app registration (pasting in a different one without
// redoing sign-in would just break the connection), and the library folder path is baked into
// this device's already-running sync cursor (adapters/tablet/cloudSync.ts) — changing it needs a
// fresh cursor, not just a reload. "Switch..." below (disconnect + back through the chooser) is
// the supported way to change any of it.
async function switchConnectionMethod() {
  if (
    !(await confirmDialog.confirm(
      "Switch how this device connects to the library? You'll be taken back to the setup screen to choose again.",
      'Continue',
    ))
  )
    return
  if (adapterKind === 'tablet') {
    await (cloudProvider.value === 'onedrive' ? disconnectOneDrive() : disconnectDropbox()).catch(() => {})
  } else if (adapterKind === 'web') {
    await clearStoredLibraryHandle().catch(() => {})
  }
  window.location.reload()
}

// A one-tap recovery for ProviderReauthRequiredError (syncStore.status.needsReconnect) that
// doesn't require Disconnect first — reuses this device's already-stored client ID/library path
// (machineSettings, the same values "Add Another Device" QR-codes for a second device) rather
// than making the operator re-enter anything. This is a full top-level redirect to the
// provider's own sign-in page, same mechanism as BootGate.vue's first-connect flow
// (beginCloudOAuthRedirect, cloudOAuthRedirect.ts) — and on a real device, confirmed this alone
// is often enough to clear a false "needs reconnect" (the underlying browser session was still
// signed in the whole time; only OneDrive's own silent hidden-iframe reauth attempt had failed,
// not the connection itself — see cloudSync.ts's own doc comment on needsReconnect).
const reconnectingCloud = ref(false)
async function reconnectCloud() {
  const clientId = machineSettings.value?.tabletCloudClientId
  if (!clientId) return
  reconnectingCloud.value = true
  cloudActionError.value = ''
  try {
    await beginCloudOAuthRedirect(
      cloudProvider.value,
      clientId,
      machineSettings.value?.tabletCloudLibraryFolderPath ?? '',
    )
  } catch (error) {
    cloudActionError.value = error instanceof Error ? error.message : "Couldn't start reconnecting."
    reconnectingCloud.value = false
  }
}

async function disconnectCloud() {
  if (
    !(await confirmDialog.confirm(
      `Disconnect this device from ${cloudProviderLabel.value}? You'll need to reconnect to use Worship Studio on this device afterward. Nothing already synced is affected.`,
      'Disconnect',
    ))
  )
    return
  disconnectingCloud.value = true
  cloudActionError.value = ''
  try {
    await (cloudProvider.value === 'onedrive' ? disconnectOneDrive() : disconnectDropbox())
    window.location.reload()
  } catch (error) {
    cloudActionError.value = error instanceof Error ? error.message : 'Could not disconnect.'
    disconnectingCloud.value = false
  }
}

const refreshingSync = ref(false)
async function refreshSyncStatus() {
  refreshingSync.value = true
  try {
    await syncStore.load()
  } finally {
    refreshingSync.value = false
  }
}

// Its own error ref, separate from cloudActionError (Cloud connection panel's disconnect()) —
// they used to share one, which meant a Sync Now/Clear & Re-sync failure rendered in the Cloud
// connection panel above (wherever that alert happened to sit), nowhere near the button that
// actually triggered it. This one renders in Sync health, next to syncNow/clearAndResync.
const syncActionError = ref('')

// syncStore.runSync() (not the adapter directly) so this button shares the exact same `syncing`
// flag useTabletSync.ts's automatic triggers set — App.vue's app-bar indicator reflects either
// one, and status.lastSyncedAt/pendingPushCount always refresh afterward, success or failure.
async function syncNow() {
  syncActionError.value = ''
  try {
    await syncStore.runSync()
  } catch (error) {
    syncActionError.value = error instanceof Error ? error.message : 'Sync failed.'
  }
}

// A deliberate "discard this device's local cache and trust the cloud" lever — real recovery
// tool if this device's cache ever ends up in a bad state, not an everyday action, hence the
// explicit confirmation spelling out exactly what's discarded (unpushed edits) versus what isn't
// (nothing changes on the cloud itself; every other device is unaffected).
async function clearAndResync() {
  if (
    !(await confirmDialog.confirm(
      "This re-downloads the entire library fresh from the cloud, overwriting this device's local copy of everything. Any change made on this device that hasn't finished pushing yet will be lost — nothing on the cloud or on any other device is affected. Use this if this device's local copy seems broken.",
      'Clear & Re-sync This Device',
    ))
  )
    return
  syncActionError.value = ''
  try {
    await syncStore.resetAndResync()
  } catch (error) {
    syncActionError.value = error instanceof Error ? error.message : 'Reset failed.'
  }
}

// A short block of plain text (see connectCode.ts's own doc comment for why it's deliberately not
// a link) that pre-fills and immediately starts BootGate.vue's connect flow on another device once
// pasted there. The app key/client ID isn't a secret (see LibrarySettings.dropboxIntegration's own
// doc comment — PKCE public clients don't have one), so carrying it in plain text is the same
// reasoning Remote Control's own pairing link/QR already relies on. This is what turns "type in a
// raw app key" from a per-device chore into a one-time setup task done only for the very first
// device.
const addDeviceCode = computed(() => {
  const clientId = machineSettings.value?.tabletCloudClientId
  if (!isCloudConnected || !clientId) return ''
  return buildConnectCode({
    provider: cloudProvider.value,
    clientId,
    libraryFolderPath: machineSettings.value?.tabletCloudLibraryFolderPath ?? '',
  })
})
// The QR image encodes a real URL wrapping the same code, not the plain text directly — confirmed
// on a real device that scanning plain text just prompts "Search the web for ...", with no copy
// option at all. A real https:// link, by contrast, gets iOS's camera to reliably offer "Open in
// Safari" (its one genuinely solid QR heuristic). BootGate.vue's own `connectCode` param handling
// deliberately doesn't auto-connect anything from that Safari tab — it just re-displays this exact
// code with a Copy button under our own control, sidestepping Apple's flaky text-recognition UI
// entirely. The text field below still shows the plain code directly for copying without a camera.
const addDeviceQrUrl = computed(() => {
  if (!addDeviceCode.value) return ''
  const params = new URLSearchParams()
  params.set('connectCode', addDeviceCode.value)
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`
})
const addDeviceQr = ref('')
watch(
  addDeviceQrUrl,
  async (url) => {
    addDeviceQr.value = url ? await generateQrCodeDataUrl(url) : ''
  },
  { immediate: true },
)
// The inline QR is sized to sit next to the code field, too small to scan reliably at a glance —
// clicking/tapping it shows the same image full-size in a dialog instead of needing a second,
// separately-generated large rendering.
const addDeviceQrDialog = ref(false)
const addDeviceCodeCopied = ref(false)
async function copyAddDeviceCode() {
  await navigator.clipboard.writeText(addDeviceCode.value)
  addDeviceCodeCopied.value = true
  setTimeout(() => (addDeviceCodeCopied.value = false), 2000)
}
function selectAddDeviceCode(event: FocusEvent) {
  ;(event.target as HTMLInputElement)?.select()
}

const tabletMediaMaxCachedFileSizeMb = computed<number | null>({
  get: () => machineSettings.value?.tabletMediaMaxCachedFileSizeMb ?? null,
  set: (value) => {
    if (machineSettings.value) machineSettings.value.tabletMediaMaxCachedFileSizeMb = value ?? undefined
  },
})

const loadingSampleData = ref(false)
const sampleDataLoaded = ref(false)
const clearingData = ref(false)
const dataCleared = ref(false)
const addingStockBackgrounds = ref(false)
const stockBackgroundsAdded = ref<{ mediaAdded: number; themesAdded: number }>()
const stockBackgroundsError = ref('')
const importingOpenSong = ref(false)
const openSongImportedCount = ref<number>()

// Moved here from the Song Library page itself — this is a one-time (or occasional) bulk
// library action, same category as Load Sample Data/Add Stock Backgrounds, not something that
// needs its own permanent toolbar button on the page operators use every week.
async function importOpenSong() {
  importingOpenSong.value = true
  openSongImportedCount.value = undefined
  try {
    const imported = await songsStore.importFromOpenSong()
    openSongImportedCount.value = imported.length
    emit('bulk-data-change')
  } finally {
    importingOpenSong.value = false
  }
}

// Shared by the standalone "Add Stock Backgrounds" button below and by loadSampleData(), which
// includes the same stock backgrounds as part of a one-click demo library rather than making
// that a separate action to remember. Only ever adds whichever of the 6 stock images/2 starter
// themes aren't already present (fixed ids make it idempotent) — safe to call unconditionally.
async function importStockBackgroundsInto() {
  const result = await getAdapter().media.importStockBackgrounds()
  // The Media and Themes stores may already be loaded (from an earlier visit to either library
  // this session) with no way to know new items just appeared on disk underneath them —
  // without this, the new backgrounds/themes are real and saved, just invisible until
  // something else happens to reload one of these two stores (e.g. a full page reload).
  await Promise.all([mediaStore.load(), themesStore.load()])
  return result
}

// Non-destructive and re-runnable any time — unlike Load Sample Data/Clear Existing Data,
// this only ever adds whichever of the 6 stock images/2 starter themes aren't already present
// (fixed ids make it idempotent), so it needs no confirmation dialog.
async function addStockBackgrounds() {
  addingStockBackgrounds.value = true
  stockBackgroundsError.value = ''
  try {
    stockBackgroundsAdded.value = await importStockBackgroundsInto()
    emit('bulk-data-change')
  } catch (error) {
    stockBackgroundsError.value =
      error instanceof Error ? error.message : 'Stock backgrounds could not be added.'
  } finally {
    addingStockBackgrounds.value = false
  }
}

/** Deletes every existing song, service, person, theme, and song collection — shared by both
 *  destructive actions below (clearing outright, and loading sample data over the top of a
 *  clean slate). */
async function deleteAllLibraryContent() {
  await Promise.all([
    songsStore.load(),
    servicesStore.load(),
    peopleStore.load(),
    themesStore.load(),
    songCollectionsStore.load(),
    serviceTypesStore.load(),
  ])
  for (const song of songsStore.songs) await songsStore.remove(song.id)
  for (const service of servicesStore.services) await servicesStore.remove(service.id)
  for (const person of peopleStore.people) await peopleStore.remove(person.id)
  for (const theme of themesStore.themes) await themesStore.remove(theme.id)
  for (const collection of songCollectionsStore.collections)
    await songCollectionsStore.remove(collection.id)
  for (const serviceType of serviceTypesStore.serviceTypes)
    await serviceTypesStore.remove(serviceType.id)
}

/** Real content worth protecting — deleteAllLibraryContent() also clears service types, but
 *  those aren't counted here: a genuinely fresh library always has the 3 default service types
 *  auto-seeded (same defaults a brand-new install has always started with — see
 *  commands::service_types::migrate_if_needed), so counting them would make every fresh library
 *  look "non-empty" and defeat the lighter plain-confirm prompt below. Slides/media/
 *  announcements aren't included since those two actions don't touch them either. */
async function hasExistingLibraryContent(): Promise<boolean> {
  await Promise.all([
    songsStore.load(),
    servicesStore.load(),
    peopleStore.load(),
    themesStore.load(),
    songCollectionsStore.load(),
  ])
  return (
    songsStore.songs.length > 0 ||
    servicesStore.services.length > 0 ||
    peopleStore.people.length > 0 ||
    themesStore.themes.length > 0 ||
    songCollectionsStore.collections.length > 0
  )
}

/** Load Sample Data and Clear Existing Data both destroy every song/service/person/theme with
 *  no way back — a plain confirm dialog already proved misclickable in practice on a real
 *  church's library. Once there's anything real to lose, this requires typing DELETE instead of
 *  just clicking through; an already-empty library (the safe way to preview sample data: point
 *  the library path at a blank folder first, see LibrarySyncSection's own path field above)
 *  keeps the lighter plain-confirm prompt, since there's nothing at stake yet. */
async function confirmDestructiveAction(message: string, label: string): Promise<boolean> {
  const hasContent = await hasExistingLibraryContent()
  return hasContent
    ? confirmDialog.confirmWithPhrase(message, 'DELETE', label)
    : confirmDialog.confirm(message, label)
}

// Sample data is strictly for demoing the app, never for mixing into a real church's library
// — so this *replaces* everything rather than adding alongside it: every existing song,
// service, person, and theme is deleted first. That's exactly why the confirmation below
// spells out what's being destroyed instead of using a generic "are you sure?".
async function loadSampleData() {
  if (
    !(await confirmDestructiveAction(
      "This permanently deletes ALL existing songs, services, people, and themes in this library, and replaces them with demo content. This cannot be undone — only use this on a library you don't need (e.g. exploring the app for the first time), never on a real church's data.",
      'Delete Everything & Load Sample Data',
    ))
  ) {
    return
  }
  loadingSampleData.value = true
  sampleDataLoaded.value = false
  dataCleared.value = false
  stockBackgroundsError.value = ''
  try {
    await deleteAllLibraryContent()

    for (const song of sampleSongs) await songsStore.save(song)
    for (const theme of sampleThemes) await themesStore.save(theme)
    for (const person of samplePeople) await peopleStore.save(person)
    for (const collection of sampleCollections) await songCollectionsStore.save(collection)
    for (const serviceType of sampleServiceTypes) await serviceTypesStore.save(serviceType)
    for (const service of buildSampleServices()) await servicesStore.save(service)
    // After deleteAllLibraryContent(), not before — it deletes every existing theme (including
    // any stock-background starter themes from an earlier import), so importing first would
    // just have them wiped out again a moment later.
    stockBackgroundsAdded.value = await importStockBackgroundsInto()

    if (librarySettings.value) {
      librarySettings.value.roleGroups = structuredClone(sampleRoleGroups)
      librarySettings.value.serviceTemplates = structuredClone(sampleServiceTemplates)
      await store.save()
    }
    sampleDataLoaded.value = true
    emit('bulk-data-change')
  } finally {
    loadingSampleData.value = false
  }
}

// Deliberately separate from loadSampleData — a church wanting to wipe demo content (or start
// over) before going live shouldn't have to load a fresh batch of sample data just to clear
// the old one out. Also resets the library-wide settings lists (service types, collections,
// role categories, service templates) — otherwise "delete everything" would leave stale
// categories/roles/templates behind since those live on LibrarySettings, not as their own
// deletable records like songs/services/people/themes.
async function clearExistingData() {
  if (
    !(await confirmDestructiveAction(
      'This permanently deletes ALL songs, services, people, themes, service types, collections, role categories, and service templates in this library. This cannot be undone — make sure this library is not currently in use before doing this.',
      'Delete Everything',
    ))
  ) {
    return
  }
  clearingData.value = true
  sampleDataLoaded.value = false
  try {
    await deleteAllLibraryContent()
    if (librarySettings.value) {
      librarySettings.value.roleGroups = []
      librarySettings.value.serviceTemplates = []
      await store.save()
    }
    dataCleared.value = true
    emit('bulk-data-change')
  } finally {
    clearingData.value = false
  }
}

const pickingLibraryFolder = ref(false)
const libraryPathIsRelative = computed(() => {
  const path = machineSettings.value?.libraryPath.trim() ?? ''
  return !!path && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path)
})

async function usePortableLibraryFolder() {
  if (
    !(await confirmDialog.confirm(
      "Switch to a portable library folder? This replaces the path above with a relative " +
        "'./Library' folder next to the Worship Studio executable — for running the app from a " +
        'USB drive or portable install with its own library, not a Dropbox/OneDrive-synced ' +
        "folder like the one currently set. You'll still need to click Save to apply it.",
      'Use Portable Folder',
    ))
  )
    return
  if (machineSettings.value) machineSettings.value.libraryPath = './Library'
}

async function pickLibraryFolder() {
  pickingLibraryFolder.value = true
  try {
    const folder = await getAdapter().settings.pickLibraryFolder()
    if (folder && machineSettings.value) machineSettings.value.libraryPath = folder
  } finally {
    pickingLibraryFolder.value = false
  }
}
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      v-if="adapterKind !== 'tablet'"
      title="Library folder"
      description="The shared location containing services, songs, people, themes, and settings."
      icon="mdi-folder-sync-outline"
    >
      <div class="path-setting">
        <v-text-field
          v-model="machineSettings!.libraryPath"
          label="Library path"
          placeholder="C:\\WorshipStudio\\Library or ./Library"
          variant="outlined"
          density="compact"
          :hint="
            libraryPathIsRelative
              ? 'Relative to the folder containing the Worship Studio executable.'
              : 'Absolute path on this computer.'
          "
          persistent-hint
          class="library-path-field"
        />
        <div class="path-setting-actions">
          <v-btn
            variant="outlined"
            prepend-icon="mdi-folder-open-outline"
            :loading="pickingLibraryFolder"
            @click="pickLibraryFolder"
          >
            Browse…
          </v-btn>
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-usb-flash-drive-outline"
            @click="usePortableLibraryFolder"
          >
            Use Portable Folder
            <v-tooltip activator="parent" location="bottom" max-width="280">
              For running Worship Studio from a USB drive or portable install with its own
              library, not a Dropbox/OneDrive-synced folder. Sets a relative "./Library" path
              next to the executable instead of the absolute path above.
            </v-tooltip>
          </v-btn>
        </div>
      </div>
      <v-btn
        v-if="adapterKind === 'web'"
        variant="text"
        size="small"
        class="mt-3"
        prepend-icon="mdi-cloud-sync-outline"
        @click="switchConnectionMethod"
      >
        Connect Dropbox or OneDrive Instead
      </v-btn>
    </SettingsPanel>

    <SettingsPanel
      v-if="isCloudConnected"
      title="Cloud connection"
      :description="`This device syncs directly with your church's ${cloudProviderLabel} account.`"
      icon="mdi-cloud-sync-outline"
    >
      <div class="cloud-connection-status">
        <span class="cloud-connection-icon">
          <v-icon :icon="cloudConnected ? 'mdi-check-circle-outline' : 'mdi-link-off'" size="22" />
        </span>
        <div>
          <strong>{{ cloudConnected ? `Connected to ${cloudProviderLabel}` : 'Not connected' }}</strong>
          <small>OAuth tokens are stored only on this device.</small>
        </div>
        <v-btn
          variant="outlined"
          color="error"
          :loading="disconnectingCloud"
          @click="disconnectCloud"
        >
          Disconnect This Device
        </v-btn>
      </div>
      <v-btn
        variant="text"
        size="small"
        class="mt-3"
        prepend-icon="mdi-swap-horizontal"
        @click="switchConnectionMethod"
      >
        Switch Provider or Folder
      </v-btn>

      <v-divider class="my-4" />

      <v-number-input
        v-model="tabletMediaMaxCachedFileSizeMb"
        label="Skip caching media files larger than (MB)"
        variant="outlined"
        density="compact"
        control-variant="stacked"
        :min="1"
        hint="Files at or above this size are never downloaded to this device — still listed, just not previewable here."
        persistent-hint
        class="settings-form-field"
      />

      <v-divider class="my-4" />

      <div class="mb-2">
        <strong class="text-body-2">Add Another Device</strong>
        <p class="text-caption text-medium-emphasis mb-2">
          On the new device, scan this QR code with its regular camera app — it opens a page with
          a Copy Code button (or just copy the code below directly) — then paste it into Worship
          Studio's setup screen there. It's the same {{ cloudProviderLabel }} connection as this
          device, no typing required.
        </p>
        <div class="add-device-row">
          <button
            v-if="addDeviceQr"
            type="button"
            class="add-device-qr-button"
            @click="addDeviceQrDialog = true"
          >
            <img :src="addDeviceQr" alt="Connect a new device QR code" class="add-device-qr" />
            <span class="text-caption text-medium-emphasis">Tap to enlarge</span>
          </button>
          <div class="add-device-link">
            <v-textarea
              :model-value="addDeviceCode"
              label="Connect code"
              variant="outlined"
              density="compact"
              rows="3"
              readonly
              hide-details
              @focus="selectAddDeviceCode"
            />
            <v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copyAddDeviceCode">
              {{ addDeviceCodeCopied ? 'Copied' : 'Copy Code' }}
            </v-btn>
          </div>
        </div>
      </div>

      <v-dialog v-model="addDeviceQrDialog" max-width="420">
        <v-card>
          <v-card-title>Connect a New Device</v-card-title>
          <v-card-text class="add-device-qr-dialog-body">
            <img
              v-if="addDeviceQr"
              :src="addDeviceQr"
              alt="Connect a new device QR code"
              class="add-device-qr-large"
            />
            <p class="text-body-2 text-medium-emphasis">
              Scan this with the new device's regular camera app — it opens a page with a Copy
              Code button — then paste it into Worship Studio's setup screen there. No typing
              required.
            </p>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="addDeviceQrDialog = false">Close</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-alert v-if="cloudActionError" type="error" variant="tonal" density="compact" class="mt-3">
        {{ cloudActionError }}
      </v-alert>
    </SettingsPanel>

    <SettingsPanel
      title="Sync health"
      description="Folder access, sync availability, and conflicted-copy files."
      icon="mdi-cloud-check-outline"
    >
      <template #action>
        <v-btn
          v-if="isCloudConnected"
          variant="text"
          size="small"
          color="primary"
          :loading="syncStore.syncing"
          prepend-icon="mdi-sync"
          @click="syncNow"
        >
          Sync Now
        </v-btn>
        <v-btn v-else variant="text" size="small" :loading="refreshingSync" @click="refreshSyncStatus">
          Check Now
        </v-btn>
      </template>

      <div v-if="syncStore.status" class="status-list">
        <template v-if="!isCloudConnected">
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon
              :icon="syncStore.status.folderReadable ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="syncStore.status.folderReadable ? 'success' : 'error'"
              size="small"
            />
            <span class="text-body-2"
              >Library folder
              {{ syncStore.status.folderReadable ? 'readable' : 'not readable' }}</span
            >
          </div>
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon
              :icon="syncStore.status.syncClientRunning ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="syncStore.status.syncClientRunning ? 'success' : 'warning'"
              size="small"
            />
            <span class="text-body-2">
              {{ syncStore.status.syncClientName ?? 'A cloud sync app' }}
              {{
                syncStore.status.syncClientRunning
                  ? 'appears to be running'
                  : "doesn't appear to be running"
              }}
            </span>
          </div>
        </template>
        <template v-else>
          <div v-if="syncStore.status.needsReconnect" class="d-flex align-center ga-2 mb-2 flex-wrap">
            <v-icon icon="mdi-alert-circle" color="warning" size="small" />
            <span class="text-body-2"
              >This device needs to reconnect to {{ cloudProviderLabel }}.</span
            >
            <v-btn
              variant="tonal"
              color="warning"
              size="small"
              :loading="reconnectingCloud"
              prepend-icon="mdi-refresh"
              @click="reconnectCloud"
            >
              Reconnect
            </v-btn>
          </div>
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon icon="mdi-sync" color="success" size="small" />
            <span class="text-body-2">
              {{
                syncStore.status.lastSyncedAt
                  ? `Last synced ${new Date(syncStore.status.lastSyncedAt).toLocaleString()}`
                  : 'Not synced yet'
              }}
              <template v-if="syncStore.status.pendingPushCount">
                — {{ syncStore.status.pendingPushCount }} change{{
                  syncStore.status.pendingPushCount === 1 ? '' : 's'
                }}
                waiting to push
              </template>
            </span>
          </div>
          <div v-if="syncStore.syncing && syncProgressLabel" class="d-flex align-center ga-2 mb-2">
            <v-progress-circular indeterminate size="16" width="2" color="primary" />
            <span class="text-body-2 text-medium-emphasis">{{ syncProgressLabel }}</span>
          </div>
        </template>
        <div
          v-if="syncStore.status.lastLibraryChangeAt"
          class="text-caption text-medium-emphasis mb-4"
        >
          Last library change:
          {{ new Date(syncStore.status.lastLibraryChangeAt).toLocaleString() }}
        </div>

        <v-btn
          v-if="syncStore.status.conflictCount > 0 || syncStore.status.recoveryCount > 0"
          variant="flat"
          :color="syncStore.status.recoveryCount > 0 ? 'error' : 'warning'"
          prepend-icon="mdi-database-alert-outline"
          to="/sync-conflicts"
        >
          Review
          {{ syncStore.status.recoveryCount + syncStore.status.conflictCount }} Library Issue{{
            syncStore.status.recoveryCount + syncStore.status.conflictCount === 1 ? '' : 's'
          }}
        </v-btn>
        <p v-else class="text-medium-emphasis text-body-2">
          No damaged files or sync conflicts right now.
        </p>

        <template v-if="isCloudConnected">
          <v-divider class="my-4" />
          <v-btn
            variant="outlined"
            color="error"
            size="small"
            prepend-icon="mdi-delete-clock-outline"
            :loading="syncStore.syncing"
            :disabled="syncStore.syncing"
            @click="clearAndResync"
          >
            Clear & Re-sync This Device
          </v-btn>
          <p class="text-caption text-medium-emphasis mt-2">
            Re-downloads everything fresh from {{ cloudProviderLabel }}, overwriting this device's
            local copy. Use this if this device's copy of the library seems broken — the cloud and
            every other device are unaffected.
          </p>
        </template>

        <v-alert v-if="syncActionError" type="error" variant="tonal" density="compact" class="mt-3">
          {{ syncActionError }}
        </v-alert>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Data tools"
      description="Demo and maintenance actions for the selected library folder."
      icon="mdi-database-cog-outline"
      tone="danger"
    >
      <div class="data-tools-group">
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="mdi-database-import-outline"
          :loading="loadingSampleData"
          @click="loadSampleData"
        >
          Load Sample Data
        </v-btn>
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="mdi-image-plus-outline"
          :loading="addingStockBackgrounds"
          @click="addStockBackgrounds"
        >
          Add Stock Backgrounds
        </v-btn>
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="mdi-file-import"
          :loading="importingOpenSong"
          @click="importOpenSong"
        >
          Import OpenSong
        </v-btn>
      </div>
      <v-divider class="my-4" />
      <div class="data-tools-group">
        <v-btn
          variant="outlined"
          color="error"
          prepend-icon="mdi-delete-forever-outline"
          :loading="clearingData"
          @click="clearExistingData"
        >
          Clear Existing Data
        </v-btn>
      </div>
      <div v-if="sampleDataLoaded" class="text-caption text-medium-emphasis mt-2">
        Sample songs, services, people, and themes added — check Home to see them.
      </div>
      <div v-if="stockBackgroundsAdded" class="text-caption text-medium-emphasis mt-2">
        {{ stockBackgroundsAdded.mediaAdded }} background image{{
          stockBackgroundsAdded.mediaAdded === 1 ? '' : 's'
        }}
        and {{ stockBackgroundsAdded.themesAdded }} theme{{
          stockBackgroundsAdded.themesAdded === 1 ? '' : 's'
        }}
        added (already-present ones were skipped).
      </div>
      <div
        v-if="openSongImportedCount !== undefined"
        class="text-caption text-medium-emphasis mt-2"
      >
        {{ openSongImportedCount }} song{{ openSongImportedCount === 1 ? '' : 's' }} imported from
        OpenSong.
      </div>
      <v-alert
        v-if="stockBackgroundsError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-2"
        closable
        @click:close="stockBackgroundsError = ''"
      >
        {{ stockBackgroundsError }}
      </v-alert>
      <div v-if="dataCleared" class="text-caption text-medium-emphasis mt-2">
        All songs, services, people, themes, service types, collections, role categories, and
        service templates have been deleted.
      </div>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.data-tools-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.path-setting {
  display: grid;
  max-width: 760px;
  grid-template-columns: minmax(280px, 1fr) auto;
  align-items: start;
  gap: 12px;
}
.path-setting-actions {
  display: flex;
  gap: 8px;
  padding-top: 2px;
}
.settings-form-field {
  max-width: 420px;
}
.status-list {
  max-width: 620px;
}
.cloud-connection-status {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  max-width: 760px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
}
.cloud-connection-status > div {
  display: grid;
  gap: 2px;
}
.cloud-connection-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.13);
  color: rgb(var(--v-theme-primary));
}
.cloud-connection-status small {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}
.add-device-row {
  display: grid;
  grid-template-columns: auto minmax(280px, 1fr);
  align-items: start;
  gap: 16px;
  max-width: 760px;
}
.add-device-qr-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: none;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.add-device-qr-button:hover,
.add-device-qr-button:focus-visible {
  border-color: rgb(var(--v-theme-primary));
}
.add-device-qr {
  width: 128px;
  height: 128px;
  border-radius: 6px;
  background: #fff;
  padding: 6px;
}
.add-device-link {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-top: 8px;
}
.add-device-link .v-textarea {
  flex: 1;
}
.add-device-qr-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.add-device-qr-large {
  width: min(320px, 100%);
  height: min(320px, 100%);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}
@media (max-width: 700px) {
  .path-setting {
    align-items: stretch;
    grid-template-columns: 1fr;
  }
  .path-setting-actions {
    flex-wrap: wrap;
  }
  .cloud-connection-status {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .cloud-connection-status .v-btn {
    grid-column: 1 / -1;
  }
  .add-device-row {
    grid-template-columns: 1fr;
    justify-items: center;
  }
}
</style>
