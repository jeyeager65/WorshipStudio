<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import type { CloudSyncClientStatus } from '@/adapters/types'
import type { DataLocation } from '@/models/settings'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { useSongsStore } from '@/stores/songs'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import { useServiceTemplatesStore } from '@/stores/serviceTemplates'
import { useSlidesStore } from '@/stores/slides'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { clearStoredLibraryHandle } from '@/adapters/web/handlePersistence'
import {
  disconnect as disconnectDropbox,
  isConnected as isDropboxConnected,
} from '@/adapters/tablet/providers/dropboxAuth'
import {
  disconnect as disconnectOneDrive,
  isConnected as isOneDriveConnected,
} from '@/adapters/tablet/providers/onedriveAuth'
import { formatSyncProgressLabel } from '@/utils/syncProgress'
import {
  buildSampleServices,
  sampleSongs,
  sampleThemes,
  samplePeople,
  sampleCollections,
  sampleRoleGroups,
  sampleRoles,
  sampleServiceTemplates,
  sampleServiceTypes,
} from '@/utils/sampleData'
import { buildSampleAnnouncements } from '@/utils/sampleAnnouncements'
import { buildSampleSlides } from '@/utils/sampleSlides'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const store = useSettingsStore()
const { machineSettings, libraryCredentials } = storeToRefs(store)
const syncStore = useSyncStore()
const songsStore = useSongsStore()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const themesStore = useThemesStore()
const mediaStore = useMediaStore()
const songCollectionsStore = useSongCollectionsStore()
const serviceTypesStore = useServiceTypesStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()
const serviceTemplatesStore = useServiceTemplatesStore()
const slidesStore = useSlidesStore()
const announcementsStore = useAnnouncementsStore()
const confirmDialog = useConfirmDialogStore()

// Every Data Tools action below persists immediately on its own (direct store/adapter calls,
// not the Settings page's own Save button) and has no reasonable "undo" back to a half-deleted
// state — so each one tells the parent to re-baseline the page's undo/save-dirty tracking
// against the now-current, already-saved state, rather than leaving a stale "unsaved changes"
// prompt (or a misleading Undo entry) behind for something that already happened for real.
const emit = defineEmits<{ 'bulk-data-change': [] }>()
// Whether this is the currently-selected Settings section — see the cloud-sync-client-status
// watcher below for why this component needs to know, even though it (like every other section)
// stays mounted via v-show the whole time Settings is open (SettingsView.vue).
const props = defineProps<{ active?: boolean }>()

// This one page now covers every adapter kind's idea of "where the library lives" — a real
// folder (tauri/web) or a cloud provider connection (tablet, over whichever of
// adapters/tablet/providers/*.ts this device connected through). Data tools works identically
// for tablet now too — the songs/services/media/... ports it acts through are real there
// (adapters/tablet/index.ts, Phase 4 of the design).
const adapterKind = getAdapter().kind
const isCloudConnected = adapterKind === 'tablet'
const cloudProvider = computed(() => machineSettings.value?.tabletCloudProvider ?? 'dropbox')
const cloudProviderLabel = computed(() =>
  cloudProvider.value === 'onedrive' ? 'OneDrive' : 'Dropbox',
)

const syncProgressLabel = computed(() => formatSyncProgressLabel(syncStore.progress))

const cloudConnected = ref(false)
const disconnectingCloud = ref(false)
const cloudActionError = ref('')
onMounted(async () => {
  if (!isCloudConnected) return
  cloudConnected.value = await (cloudProvider.value === 'onedrive'
    ? isOneDriveConnected()
    : isDropboxConnected())
})

// Lazy, this page's own concern — see CloudSyncClientStatus's doc comment (adapters/types.ts)
// for why this isn't part of the eager syncStore.load() every other field on this page comes
// from: the Tauri adapter's real detection spawns a `tasklist` subprocess, cheap once warm but
// genuinely slow (multi-second) on a fresh launch, and this is the only place it's ever shown.
// Deferred further still, to this section's own first *selection* rather than just Settings'
// first mount: every section mounts together via v-show (see SettingsView.vue's own comment on
// that), so an onMounted here fired this same multi-second cost no matter which section an
// operator actually opened Settings to first — confirmed as the cause of a reported "About page
// takes 2-5 seconds to appear" delay, since About's own mount was paying this section's cost too.
const cloudSyncClientStatus = ref<CloudSyncClientStatus>()
let cloudSyncClientStatusRequested = false
async function loadCloudSyncClientStatus() {
  if (isCloudConnected) return
  cloudSyncClientStatus.value = await getAdapter().sync.getCloudSyncClientStatus()
}
watch(
  () => props.active,
  (active) => {
    if (!active || cloudSyncClientStatusRequested) return
    cloudSyncClientStatusRequested = true
    void loadCloudSyncClientStatus()
  },
  { immediate: true },
)

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
    await (cloudProvider.value === 'onedrive' ? disconnectOneDrive() : disconnectDropbox()).catch(
      () => {},
    )
  } else if (adapterKind === 'web') {
    await clearStoredLibraryHandle().catch(() => {})
  }
  window.location.reload()
}

// A one-tap recovery for ProviderReauthRequiredError (syncStore.status.needsReconnect) that
// doesn't require Disconnect first — reuses this device's already-stored client ID/library path
// (machineSettings, this device's own cached copy of what it connected with) rather
// than making the operator re-enter anything. On a real device, confirmed this alone is often
// enough to clear a false "needs reconnect" (the underlying browser session was still signed in
// the whole time; only OneDrive's own silent hidden-iframe reauth attempt had failed, not the
// connection itself — see cloudSync.ts's own doc comment on needsReconnect). The actual redirect
// logic now lives in useSyncStore (reconnectCloud/reconnectingCloud/reconnectError), shared with
// App.vue's app-wide banner so both surfaces track one in-flight attempt, not two.
async function reconnectCloud() {
  const clientId = machineSettings.value?.tabletCloudClientId
  if (!clientId) return
  await syncStore.reconnectCloud(
    cloudProvider.value,
    clientId,
    machineSettings.value?.tabletCloudLibraryFolderPath ?? '',
  )
  if (syncStore.reconnectError) cloudActionError.value = syncStore.reconnectError
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
    await Promise.all([syncStore.load(), loadCloudSyncClientStatus()])
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
// A sync could have pulled changes to any of these from another device — without this, they'd
// stay stale in memory until a full app reload, since a store that's already loaded once never
// re-fetches on its own (LandingView.vue's onMounted, for example, only calls load() the first
// time: `if (!store.loaded)`). Confirmed on a real device: services deleted elsewhere kept
// showing in Browse after a successful Clear & Re-sync, until the whole app was reloaded.
// Deliberately excludes librarySettings/machineSettings/credentials and the service-types/
// song-collections lists — all three are also this exact page's own editable settingsDocument
// (SettingsView.vue), and reloading them out from under an in-progress unsaved edit here would
// silently clobber it (the same hazard the live-refresh discussion in
// notes/setup-wizard-decisions-plan.md flagged for exactly this reason).
async function reloadContentAfterSync() {
  await Promise.all([
    songsStore.load(),
    servicesStore.load(),
    peopleStore.load(),
    themesStore.load(),
    mediaStore.load(),
    slidesStore.load(),
    announcementsStore.load(),
    roleGroupsStore.load(),
    rolesStore.load(),
    serviceTemplatesStore.load(),
  ])
}

async function syncNow() {
  syncActionError.value = ''
  try {
    await syncStore.runSync()
    await reloadContentAfterSync()
  } catch (error) {
    syncActionError.value = error instanceof Error ? error.message : 'Sync failed.'
  }
}

// A lighter recovery lever than Clear & Re-sync below — re-checks against the cloud (including
// cleaning up anything deleted elsewhere that an ordinary sync might have missed) without
// discarding anything local, so it doesn't need Clear & Re-sync's explicit confirmation: nothing
// this device hasn't already pushed is ever at risk.
async function reconcileNow() {
  syncActionError.value = ''
  try {
    await syncStore.reconcile()
    await reloadContentAfterSync()
  } catch (error) {
    syncActionError.value = error instanceof Error ? error.message : 'Reconcile failed.'
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
    await reloadContentAfterSync()
  } catch (error) {
    syncActionError.value = error instanceof Error ? error.message : 'Reset failed.'
  }
}

/**
 * The church's cloud app registration id — a Microsoft Entra client ID, or a Dropbox app key. Every
 * device needs it before it can talk to the provider's API at all, and it is the *only* value that
 * still has to be transferred by hand: a OneDrive library folder is now picked from a list rather
 * than typed (see BootGate.vue), and it is not a secret (PKCE public clients have none — see
 * LibraryCredentials.dropboxIntegration's own doc comment), so it is fine to email.
 *
 * Stored church-wide in LibraryCredentials rather than read from this device's own connection, so
 * a *desktop* can show it too. That matters: the desktop is where someone is most likely to be
 * sitting when they need to send it, and it reaches the library as a plain synced folder without
 * needing any app id itself. Those fields had been defined but never read or written by anything
 * until now — see notes/tablet-onboarding-and-account-model.md.
 */
const oneDriveClientId = computed({
  get: () => libraryCredentials.value?.oneDriveIntegration.clientId ?? '',
  set: (value: string) => {
    if (libraryCredentials.value) libraryCredentials.value.oneDriveIntegration.clientId = value
  },
})
const dropboxAppKey = computed({
  get: () => libraryCredentials.value?.dropboxIntegration.appKey ?? '',
  set: (value: string) => {
    if (libraryCredentials.value) libraryCredentials.value.dropboxIntegration.appKey = value
  },
})

/** This tablet connected with an app id that was never recorded church-wide — offer to adopt it
 *  rather than making someone dig it out of the provider's console to type back in. */
const localAppIdToAdopt = computed(() => {
  const local = machineSettings.value?.tabletCloudClientId
  if (!isCloudConnected || !local) return ''
  const stored = cloudProvider.value === 'onedrive' ? oneDriveClientId.value : dropboxAppKey.value
  return stored.trim() ? '' : local
})
function adoptLocalAppId() {
  if (!localAppIdToAdopt.value) return
  if (cloudProvider.value === 'onedrive') oneDriveClientId.value = localAppIdToAdopt.value
  else dropboxAppKey.value = localAppIdToAdopt.value
}

const copiedAppId = ref('')
async function copyAppId(value: string) {
  await navigator.clipboard.writeText(value)
  copiedAppId.value = value
  setTimeout(() => (copiedAppId.value = ''), 2000)
}

const tabletMediaMaxCachedFileSizeMb = computed<number | null>({
  get: () => machineSettings.value?.tabletMediaMaxCachedFileSizeMb ?? null,
  set: (value) => {
    if (machineSettings.value)
      machineSettings.value.tabletMediaMaxCachedFileSizeMb = value ?? undefined
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
    roleGroupsStore.load(),
    rolesStore.load(),
    serviceTemplatesStore.load(),
    announcementsStore.load(),
    slidesStore.load(),
  ])
  for (const song of songsStore.songs) await songsStore.remove(song.id)
  for (const service of servicesStore.services) await servicesStore.remove(service.id)
  for (const person of peopleStore.people) await peopleStore.remove(person.id)
  for (const theme of themesStore.themes) await themesStore.remove(theme.id)
  for (const collection of songCollectionsStore.collections)
    await songCollectionsStore.remove(collection.id)
  for (const serviceType of serviceTypesStore.serviceTypes)
    await serviceTypesStore.remove(serviceType.id)
  // Templates and roles before groups — a role with a dangling groupId is a smaller, more
  // graceful glitch than the other way around wouldn't be different anyway (every store is
  // re-loaded fresh right after), but this keeps the intermediate state consistent while it's
  // happening.
  for (const template of serviceTemplatesStore.serviceTemplates)
    await serviceTemplatesStore.remove(template.id)
  for (const role of rolesStore.roles) await rolesStore.remove(role.id)
  for (const group of roleGroupsStore.roleGroups) await roleGroupsStore.remove(group.id)
  // Announcements are library content like everything above. They were left out originally, which
  // meant a "clear everything" left them behind — visible the moment sample data started shipping
  // announcements, and wrong for a real church clearing before going live too.
  for (const announcement of announcementsStore.announcements)
    await announcementsStore.remove(announcement.id)
  for (const slide of slidesStore.slides) await slidesStore.remove(slide.id)
}

/** Real content worth protecting — deleteAllLibraryContent() also clears service types, but
 *  those aren't counted here: a genuinely fresh library always has the 3 default service types
 *  auto-seeded (same defaults a brand-new install has always started with — see
 *  commands::service_types::seed_defaults_if_needed), so counting them would make every fresh
 *  library look "non-empty" and defeat the lighter plain-confirm prompt below. Media is counted even
 *  though Load Sample Data never touches it (only Clear Existing Data does, see
 *  clearExistingData()) — sharing this check across both just means Load Sample Data's
 *  confirmation errs stricter than strictly necessary when only media exists, never looser.
 *  Slides/announcements aren't included since neither destructive action touches them. */
async function hasExistingLibraryContent(): Promise<boolean> {
  await Promise.all([
    songsStore.load(),
    servicesStore.load(),
    peopleStore.load(),
    themesStore.load(),
    songCollectionsStore.load(),
    // Unlike service types, roles/role groups/service templates have no auto-seeded defaults
    // on a genuinely fresh library (there's no reasonable default for church-specific role/
    // template names) — safe to count here without the same "always looks non-empty" problem.
    roleGroupsStore.load(),
    rolesStore.load(),
    serviceTemplatesStore.load(),
    mediaStore.load(),
  ])
  return (
    songsStore.songs.length > 0 ||
    servicesStore.services.length > 0 ||
    peopleStore.people.length > 0 ||
    themesStore.themes.length > 0 ||
    songCollectionsStore.collections.length > 0 ||
    roleGroupsStore.roleGroups.length > 0 ||
    rolesStore.roles.length > 0 ||
    serviceTemplatesStore.serviceTemplates.length > 0 ||
    mediaStore.items.length > 0
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
    for (const group of sampleRoleGroups) await roleGroupsStore.save(group)
    for (const role of sampleRoles) await rolesStore.save(role)
    for (const template of sampleServiceTemplates) await serviceTemplatesStore.save(template)
    for (const service of buildSampleServices()) await servicesStore.save(service)
    for (const announcement of buildSampleAnnouncements())
      await announcementsStore.save(announcement)
    for (const slide of buildSampleSlides()) await slidesStore.save(slide)
    // After deleteAllLibraryContent(), not before — it deletes every existing theme (including
    // any stock-background starter themes from an earlier import), so importing first would
    // just have them wiped out again a moment later.
    stockBackgroundsAdded.value = await importStockBackgroundsInto()

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
// deletable records like songs/services/people/themes. Unlike loadSampleData(), this also
// clears media — Clear Existing Data means "start over", and leftover media (including its
// backing image/video files) would otherwise silently survive a wipe that claims to delete
// everything. Also deletes the settings-list files' own .backup siblings (see
// clearSettingsListBackups's own doc comment) — each remove() above only ever shrinks those
// files, never deletes them, so their backup would otherwise keep holding the pre-clear content
// indefinitely.
/** The old wording said only "in this library," which reads as *this device's copy* — and said
 *  nothing about the deletion travelling. It does: on a tablet each remove writes a tombstone the
 *  next sync pushes to the cloud, and on a desktop whose library folder sits inside OneDrive or
 *  Dropbox that provider's own client pushes it. In practically every real deployment this clears
 *  the church's library on every device, which is the shape of a wipe this project has already
 *  suffered once. Worth spelling out where the blast radius is actually large. */
function clearExistingDataWarning(): string {
  const base =
    'This permanently deletes ALL songs, services, people, themes, media, slides, announcements, service types, collections, role categories, and service templates in this library. This cannot be undone — make sure this library is not currently in use before doing this.'
  if (!librarySyncsToOtherDevices.value) return base
  return `${base}\n\nThis library is shared. Deleting here also deletes it on every other device that syncs it — including phones, tablets, and other computers — as soon as they sync.`
}

async function clearExistingData() {
  if (!(await confirmDestructiveAction(clearExistingDataWarning(), 'Delete Everything'))) {
    return
  }
  clearingData.value = true
  sampleDataLoaded.value = false
  try {
    await deleteAllLibraryContent()
    await mediaStore.load()
    for (const item of mediaStore.items) await mediaStore.remove(item.id)
    await getAdapter().settings.clearSettingsListBackups()
    dataCleared.value = true
    emit('bulk-data-change')
  } finally {
    clearingData.value = false
  }
}

/** Whether deleting content here would reach other people's devices.
 *
 *  Always true on a tablet, which is cloud-connected by definition. On desktop there is no way to
 *  *know* — the app just sees a filesystem path and some other program does the syncing — so this
 *  matches the folder names the common clients use. It will miss an unusual setup (a network share,
 *  a less common client), which is why this only ever adds a warning: a false negative leaves the
 *  original wording, and a false positive costs nothing but a more cautious sentence. */
const CLOUD_SYNCED_FOLDER = /[\\/](?:onedrive|dropbox|google ?drive|icloud|box|pcloud|nextcloud)/i
const librarySyncsToOtherDevices = computed(() => {
  if (isCloudConnected) return true
  return CLOUD_SYNCED_FOLDER.test(machineSettings.value?.libraryPath ?? '')
})

const pickingLibraryFolder = ref(false)
const libraryPathIsRelative = computed(() => {
  const path = machineSettings.value?.libraryPath.trim() ?? ''
  return !!path && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path)
})

async function usePortableLibraryFolder() {
  if (
    !(await confirmDialog.confirm(
      'Switch to a portable library folder? This replaces the path above with a relative ' +
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

// Unlike the library path field above, this doesn't bind into machineSettings/the page's own
// Save button — the Local root can't be recorded inside machine-settings.json itself (that file
// lives inside the folder this points to, see SettingsPort.getDataLocation's own doc comment), so
// it has its own separate load/save round trip and its own Save action here.
const dataLocation = ref<DataLocation>()
const localRootPathDraft = ref('')
onMounted(async () => {
  if (adapterKind !== 'tauri') return
  dataLocation.value = await getAdapter().settings.getDataLocation?.()
  localRootPathDraft.value = dataLocation.value?.localRootPath ?? ''
})

const pickingDataLocationFolder = ref(false)
async function pickDataLocationFolder() {
  pickingDataLocationFolder.value = true
  try {
    const folder = await getAdapter().settings.pickDataLocationFolder?.()
    if (folder) localRootPathDraft.value = folder
  } finally {
    pickingDataLocationFolder.value = false
  }
}

const savingDataLocation = ref(false)
const dataLocationSaved = ref(false)
async function saveDataLocationPath() {
  savingDataLocation.value = true
  dataLocationSaved.value = false
  try {
    await getAdapter().settings.saveDataLocation?.(localRootPathDraft.value)
    dataLocation.value = await getAdapter().settings.getDataLocation?.()
    localRootPathDraft.value = dataLocation.value?.localRootPath ?? ''
    dataLocationSaved.value = true
  } finally {
    savingDataLocation.value = false
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
              For running Worship Studio from a USB drive or portable install with its own library,
              not a Dropbox/OneDrive-synced folder. Sets a relative "./Library" path next to the
              executable instead of the absolute path above.
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
      v-if="adapterKind === 'tauri' && dataLocation && !dataLocation.isPortable"
      title="Local data folder"
      description="Where this computer's settings, paired devices, Canva sign-in, and Local-only media are stored. Never synced. Left blank, it defaults to Worship Studio's own app-data folder."
      icon="mdi-folder-outline"
    >
      <div class="path-setting">
        <v-text-field
          v-model="localRootPathDraft"
          label="Local data path"
          placeholder="D:\\WorshipStudio\\Local"
          variant="outlined"
          density="compact"
          :hint="`Absolute path on this computer. Never synced. Currently: ${dataLocation.resolvedPath}`"
          persistent-hint
          class="library-path-field"
        />
        <div class="path-setting-actions">
          <v-btn
            variant="outlined"
            prepend-icon="mdi-folder-open-outline"
            :loading="pickingDataLocationFolder"
            @click="pickDataLocationFolder"
          >
            Browse…
          </v-btn>
          <v-btn
            variant="tonal"
            color="primary"
            :loading="savingDataLocation"
            @click="saveDataLocationPath"
          >
            Save Local Data Folder
          </v-btn>
        </div>
      </div>
      <div v-if="dataLocationSaved" class="text-caption text-medium-emphasis mt-2">
        Saved. Files already at the previous location aren't moved automatically.
      </div>
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
          <strong>{{
            cloudConnected ? `Connected to ${cloudProviderLabel}` : 'Not connected'
          }}</strong>
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

      <v-alert v-if="cloudActionError" type="error" variant="tonal" density="compact" class="mt-3">
        {{ cloudActionError }}
      </v-alert>
    </SettingsPanel>

    <SettingsPanel
      title="Add Another Device"
      description="What a phone or tablet needs before it can join this library."
      icon="mdi-cellphone-link"
    >
      <p class="text-caption text-medium-emphasis mb-3">
        On the new device, open Worship Studio, choose your cloud provider, and paste the matching
        ID below. It then signs in and picks the library folder from a list — nothing else has to be
        typed. The ID isn't a secret, so it's fine to email or text.
      </p>

      <v-alert v-if="localAppIdToAdopt" type="info" variant="tonal" density="compact" class="mb-3">
        <div class="d-flex align-center ga-3 flex-wrap">
          <span
            >This device connected with an ID that isn't recorded here yet. Save it so other devices
            (and this church's computers) can see it.</span
          >
          <v-btn size="small" variant="flat" color="primary" @click="adoptLocalAppId">
            Use This Device's ID
          </v-btn>
        </div>
      </v-alert>

      <div class="app-id-row">
        <v-text-field
          v-model="oneDriveClientId"
          label="Microsoft app client ID (OneDrive)"
          variant="outlined"
          density="compact"
          autocomplete="off"
          hide-details
        />
        <v-btn
          variant="tonal"
          prepend-icon="mdi-content-copy"
          :disabled="!oneDriveClientId.trim()"
          @click="copyAppId(oneDriveClientId)"
        >
          {{ copiedAppId === oneDriveClientId ? 'Copied' : 'Copy' }}
        </v-btn>
      </div>

      <div class="app-id-row mt-3">
        <v-text-field
          v-model="dropboxAppKey"
          label="Dropbox app key"
          variant="outlined"
          density="compact"
          autocomplete="off"
          hide-details
        />
        <v-btn
          variant="tonal"
          prepend-icon="mdi-content-copy"
          :disabled="!dropboxAppKey.trim()"
          @click="copyAppId(dropboxAppKey)"
        >
          {{ copiedAppId === dropboxAppKey ? 'Copied' : 'Copy' }}
        </v-btn>
      </div>

      <p class="text-caption text-medium-emphasis mt-3">
        These come from your church's own app registration with Microsoft or Dropbox — one per
        church, not one per device.
      </p>
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
        <v-btn
          v-else
          variant="text"
          size="small"
          :loading="refreshingSync"
          @click="refreshSyncStatus"
        >
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
          <div v-if="cloudSyncClientStatus" class="d-flex align-center ga-2 mb-2">
            <v-icon
              :icon="cloudSyncClientStatus.running ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="cloudSyncClientStatus.running ? 'success' : 'warning'"
              size="small"
            />
            <span class="text-body-2">
              {{ cloudSyncClientStatus.name ?? 'A cloud sync app' }}
              {{
                cloudSyncClientStatus.running
                  ? 'appears to be running'
                  : "doesn't appear to be running"
              }}
            </span>
          </div>
        </template>
        <template v-else>
          <div
            v-if="syncStore.status.needsReconnect"
            class="d-flex align-center ga-2 mb-2 flex-wrap"
          >
            <v-icon icon="mdi-alert-circle" color="warning" size="small" />
            <span class="text-body-2"
              >This device needs to reconnect to {{ cloudProviderLabel }}.</span
            >
            <v-btn
              variant="tonal"
              color="warning"
              size="small"
              :loading="syncStore.reconnectingCloud"
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
            size="small"
            prepend-icon="mdi-cloud-search-outline"
            :loading="syncStore.syncing"
            :disabled="syncStore.syncing"
            @click="reconcileNow"
          >
            Reconcile With {{ cloudProviderLabel }}
          </v-btn>
          <p class="text-caption text-medium-emphasis mt-2 mb-4">
            Re-checks against {{ cloudProviderLabel }} for anything an ordinary sync might have
            missed — including a file deleted elsewhere that's still showing here. Nothing local is
            discarded; use this before reaching for Clear & Re-sync below.
          </p>
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
        Sample songs, services, people, announcements, slides, and themes added — check Home to
        see them.
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
        All songs, services, people, themes, media, service types, collections, role categories, and
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
.app-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 640px;
}
.app-id-row .v-text-field {
  flex: 1;
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
  .app-id-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
