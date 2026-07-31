<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useUndoStore } from '@/stores/undo'
import { useSongsStore } from '@/stores/songs'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useThemesStore } from '@/stores/themes'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import { previewExternalAppCommand } from '@/utils/externalAppPreview'
import { buildSampleServices, sampleSongs, sampleThemes, samplePeople, sampleRoleGroups, sampleServiceTemplates, sampleServiceTypes } from '@/utils/sampleData'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ManagedStringList from '@/components/settings/ManagedStringList.vue'
import RoleGroupEditor from '@/components/settings/RoleGroupEditor.vue'
import ServiceTemplateEditor from '@/components/settings/ServiceTemplateEditor.vue'
import type { ApiBibleCatalogEntry, DisplayInfo, DisplayRole, ExternalAppProfile, RemoteDevice } from '@/adapters/types'

const store = useSettingsStore()
const router = useRouter()
const { librarySettings, machineSettings } = storeToRefs(store)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()
const syncStore = useSyncStore()
const songsStore = useSongsStore()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const themesStore = useThemesStore()
const refreshingSync = ref(false)
async function refreshSyncStatus() {
  refreshingSync.value = true
  try {
    await syncStore.load()
  } finally {
    refreshingSync.value = false
  }
}

type Section =
  | 'general'
  | 'display'
  | 'font-sizes'
  | 'service-types'
  | 'collections'
  | 'bible-translations'
  | 'themes'
  | 'roles'
  | 'service-templates'
  | 'sync'
  | 'external-apps'
  | 'remote-control'
  | 'canva'
const activeSection = ref<Section>('general')
const sections: { key: Section; label: string; group: string }[] = [
  { key: 'general', label: 'General', group: 'App' },
  { key: 'sync', label: 'Sync Status', group: 'App' },
  // Display groups everything about how content actually renders on screen — the physical
  // setup (Display Setup), sizing (Font Sizes), visual styling (Themes), and hand-off to other
  // on-screen apps (External Apps/Remote Control) — not just monitor configuration narrowly.
  { key: 'display', label: 'Display Setup', group: 'Display' },
  { key: 'font-sizes', label: 'Font Sizes', group: 'Display' },
  { key: 'themes', label: 'Themes', group: 'Display' },
  // Windows-only (Win32 window hand-off) — the port is entirely absent on the macOS/demo
  // build, unlike Display Setup which still has something to show (real monitors) in mock.
  ...(getAdapter().externalApps ? [{ key: 'external-apps' as const, label: 'External Apps', group: 'Display' }] : []),
  // Needs the bundled local HTTP server (see adapters/types.ts's RemotePort doc comment) —
  // not meaningful in the static/mock demo build even though the port itself exists there.
  ...(getAdapter().kind === 'tauri' ? [{ key: 'remote-control' as const, label: 'Remote Control', group: 'Display' }] : []),
  // Content Library is genuinely just the shared library content itself — song categorization
  // and the scripture translations resolved into services, not anything about how a service
  // is structured or staffed (that's Services & Scheduling below).
  { key: 'collections', label: 'Song Collections', group: 'Content Library' },
  { key: 'bible-translations', label: 'Bible Translations', group: 'Content Library' },
  ...(getAdapter().canva ? [{ key: 'canva' as const, label: 'Canva', group: 'Content Library' }] : []),
  // What a service looks like (its types, its shell/template) and who fills it (roles) — these
  // three were previously scattered across Content Library despite having nothing to do with
  // library content.
  { key: 'service-types', label: 'Service Types', group: 'Services & Scheduling' },
  { key: 'roles', label: 'Roles', group: 'Services & Scheduling' },
  { key: 'service-templates', label: 'Service Templates', group: 'Services & Scheduling' },
]
const groupedSections = computed(() => {
  const groups: { name: string; items: typeof sections }[] = []
  for (const section of sections) {
    let group = groups.find((g) => g.name === section.group)
    if (!group) {
      group = { name: section.group, items: [] }
      groups.push(group)
    }
    group.items.push(section)
  }
  return groups
})

// Registering `watch` after an `await` (inside onMounted's async callback) happens outside
// Vue's synchronous component-setup tracking, so it isn't auto-stopped on unmount — it would
// keep reacting to store.librarySettings/machineSettings mutations from *other* views (e.g.
// the setup wizard) after this one is long gone, wrongly flagging isDirty. Stopping it
// explicitly in onUnmounted is what actually scopes it to this view's lifetime.
let stopSettingsWatch: (() => void) | undefined

onMounted(async () => {
  await store.load()
  isDirty.value = false
  // Registered after the initial load so it only reacts to actual user edits, not the
  // assignment above — same pattern as Song Editor/Service Workspace.
  stopSettingsWatch = watch([librarySettings, machineSettings], () => (isDirty.value = true), { deep: true })
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveSettings
  await loadDisplays()
  await loadExternalApps()
  await loadRemoteDevices()

  // Whether the ESV copyright notice below needs to show is a question of whether ESV is
  // actually resolvable right now (an esvApiKey configured on this machine — see
  // commands::scripture on the Rust side), which can lag one Save behind the draft key typed
  // into the field below.
  try {
    const translations = await getAdapter().scripture.listTranslations()
    esvAvailable.value = translations.some((t) => t.code === 'ESV')
  } catch (e) {
    console.error('Failed to list scripture translations:', e)
  }
})
onUnmounted(() => {
  stopSettingsWatch?.()
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveSettings() {
  if (saving.value) return
  saving.value = true
  try {
    await store.save()
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

// Dark mode applies live for instant feedback (so the toggle isn't disorienting to use),
// but — like every other edit in this view — still needs Save pressed to persist for next
// launch (see App.vue, which reads the saved value at startup).
const theme = useTheme()
const darkMode = computed({
  get: () => machineSettings.value?.darkMode ?? true,
  set: (value: boolean) => {
    if (!machineSettings.value) return
    machineSettings.value.darkMode = value
    theme.change(value ? 'worshipDark' : 'worshipLight')
  },
})

// Display Setup — Windows-only in practice (spec section 17); the port is entirely absent
// on builds where it doesn't apply, feature-detected here rather than assumed present.
const displays = ref<DisplayInfo[]>([])
const roleOptions: { title: string; value: DisplayRole }[] = [
  { title: 'Operator (this window)', value: 'operator' },
  { title: 'Audience Display', value: 'audience' },
  { title: 'Not Used', value: 'not-used' },
]
async function loadDisplays() {
  // Not wired to a real command on the native Tauri backend yet (README's adapter-status
  // note) — falls back to "no displays detected" rather than leaving an unhandled rejection.
  try {
    displays.value = (await getAdapter().displays?.list()) ?? []
  } catch (e) {
    console.error('Failed to list displays:', e)
    displays.value = []
  }
}
// Role assignment is an immediate hardware-config action, not a staged edit like the rest
// of this screen — there's nothing meaningful to "revert" before Save, so it applies (and
// persists) right away, same reasoning as the spec's External Apps "Test Launch" button.
async function assignRole(displayId: string, role: DisplayRole) {
  await getAdapter().displays?.assignRole(displayId, role)
  const display = displays.value.find((d) => d.id === displayId)
  if (display) display.role = role
}
async function identifyDisplay(displayId: string) {
  await getAdapter().displays?.identify(displayId)
}

// External App Profiles (spec section 12) — also Windows-only, feature-detected same as
// displays above. Edited via a modal (design/sketches/external-app-profile.html) rather than
// inline like Theme Editor, since a profile has enough fields (launch config, remote
// controls, window position) to warrant its own focused surface.
const externalAppProfiles = ref<ExternalAppProfile[]>([])
async function loadExternalApps() {
  try {
    externalAppProfiles.value = (await getAdapter().externalApps?.listProfiles()) ?? []
  } catch (e) {
    console.error('Failed to list external app profiles:', e)
    externalAppProfiles.value = []
  }
}
const launchModeOptions: { title: string; value: ExternalAppProfile['launchMode']; hint: string }[] = [
  { title: 'Already Running', value: 'already-running', hint: 'Operator opens it manually before the service' },
  { title: 'Launch Automatically', value: 'launch-automatically', hint: 'Worship Studio opens it when the slide is reached' },
]

const profileDialogOpen = ref(false)
const editingProfile = ref<ExternalAppProfile>()
// Test Launch/Recapture Position both act on the profile as saved on disk (the Rust side
// looks it up by id) — until Save Profile has run at least once, there's nothing for them to
// act on yet, so they stay disabled with a hint rather than silently auto-saving.
const isEditingSavedProfile = computed(() => externalAppProfiles.value.some((p) => p.id === editingProfile.value?.id))

function blankExternalAppProfile(): ExternalAppProfile {
  return {
    id: crypto.randomUUID(),
    name: '',
    launchMode: 'launch-automatically',
    executablePath: '',
    parameterFormat: '',
    remoteControlsEnabled: false,
    nextKey: '',
    prevKey: '',
    windowPosition: undefined,
    updatedAt: '',
    updatedByDevice: '',
  }
}
function openNewExternalAppProfile() {
  editingProfile.value = blankExternalAppProfile()
  testLaunchResult.value = undefined
  profileDialogOpen.value = true
}
function openEditExternalAppProfile(profile: ExternalAppProfile) {
  // toRaw first — profile is the reactive v-for item, and structuredClone can't clone a Vue
  // reactive Proxy directly (throws DataCloneError).
  editingProfile.value = structuredClone(toRaw(profile))
  testLaunchResult.value = undefined
  profileDialogOpen.value = true
}
async function pickExternalAppExecutable() {
  const path = await getAdapter().externalApps?.pickExecutable()
  if (path && editingProfile.value) editingProfile.value.executablePath = path
}
async function saveExternalAppProfile() {
  if (!editingProfile.value) return
  await getAdapter().externalApps?.saveProfile(editingProfile.value)
  profileDialogOpen.value = false
  await loadExternalApps()
}
async function deleteExternalAppProfile(profile: ExternalAppProfile) {
  if (!(await confirmDialog.confirm(`Delete the "${profile.name}" external app profile?`, 'Delete'))) return
  await getAdapter().externalApps?.deleteProfile(profile.id)
  await loadExternalApps()
}

const testingLaunch = ref(false)
const testLaunchResult = ref<{ ok: boolean; message: string }>()
async function testLaunchExternalApp() {
  if (!editingProfile.value) return
  testingLaunch.value = true
  try {
    testLaunchResult.value = await getAdapter().externalApps?.testLaunch(editingProfile.value.id)
  } finally {
    testingLaunch.value = false
  }
}
const capturingPosition = ref(false)
async function recaptureWindowPosition() {
  if (!editingProfile.value) return
  capturingPosition.value = true
  try {
    editingProfile.value.windowPosition = await getAdapter().externalApps?.captureWindowPosition()
  } catch (e) {
    console.error('Failed to capture window position:', e)
  } finally {
    capturingPosition.value = false
  }
}

// Remote Control (spec section 4) — provisioning generates a QR code scoped to one device
// name + access level; the token itself never round-trips back to this screen once handed
// out (see RemoteDeviceSummary on the Rust side), so there's nothing to "edit" afterward,
// only revoke.
const remoteDevices = ref<RemoteDevice[]>([])
const remoteServerInfo = ref<{ lanIp?: string; port: number }>()
async function loadRemoteDevices() {
  try {
    remoteDevices.value = (await getAdapter().remote?.listDevices()) ?? []
    remoteServerInfo.value = await getAdapter().remote?.getServerInfo()
  } catch (e) {
    console.error('Failed to load remote devices:', e)
    remoteDevices.value = []
  }
}
const accessLevelOptions: { title: string; value: RemoteDevice['accessLevel'] }[] = [
  { title: 'View Only', value: 'view-only' },
  { title: 'Advance Only', value: 'advance-only' },
  { title: 'Full Control', value: 'full-control' },
]
function accessLevelLabel(level: RemoteDevice['accessLevel']): string {
  return accessLevelOptions.find((o) => o.value === level)?.title ?? level
}

const provisionDialogOpen = ref(false)
const newDeviceName = ref('')
const newDeviceAccessLevel = ref<RemoteDevice['accessLevel']>('advance-only')
const provisioning = ref(false)
const provisionResult = ref<{ qrDataUrl: string; pairingUrl: string }>()

function openProvisionDialog() {
  newDeviceName.value = ''
  newDeviceAccessLevel.value = 'advance-only'
  provisionResult.value = undefined
  provisionDialogOpen.value = true
}
async function provisionDevice() {
  if (!newDeviceName.value.trim() || provisioning.value) return
  provisioning.value = true
  try {
    provisionResult.value = await getAdapter().remote?.provisionDevice(newDeviceName.value.trim(), newDeviceAccessLevel.value)
    await loadRemoteDevices()
  } catch (e) {
    console.error('Failed to provision remote device:', e)
  } finally {
    provisioning.value = false
  }
}
async function revokeRemoteDevice(device: RemoteDevice) {
  if (!(await confirmDialog.confirm(`Revoke access for "${device.name}"?`, 'Revoke'))) return
  await getAdapter().remote?.revokeDevice(device.id)
  await loadRemoteDevices()
}

// Re-running the wizard doesn't reset hasCompletedSetup — that only matters for whether it
// auto-opens on next launch (App.vue), and this is an explicit, already-past-first-launch visit.
function runSetupWizard() {
  router.push('/setup')
}

const loadingSampleData = ref(false)
const sampleDataLoaded = ref(false)
const clearingData = ref(false)
const dataCleared = ref(false)

/** Deletes every existing song, service, person, and theme — shared by both destructive
 *  actions below (clearing outright, and loading sample data over the top of a clean slate). */
async function deleteAllLibraryContent() {
  await Promise.all([songsStore.load(), servicesStore.load(), peopleStore.load(), themesStore.load()])
  for (const song of songsStore.songs) await songsStore.remove(song.id)
  for (const service of servicesStore.services) await servicesStore.remove(service.id)
  for (const person of peopleStore.people) await peopleStore.remove(person.id)
  for (const theme of themesStore.themes) await themesStore.remove(theme.id)
}

// Sample data is strictly for demoing the app, never for mixing into a real church's library
// — so this *replaces* everything rather than adding alongside it: every existing song,
// service, person, and theme is deleted first. That's exactly why the confirmation below
// spells out what's being destroyed instead of using a generic "are you sure?".
async function loadSampleData() {
  if (
    !(await confirmDialog.confirm(
      'This permanently deletes ALL existing songs, services, people, and themes in this library, and replaces them with demo content. This cannot be undone — only use this on a library you don\'t need (e.g. exploring the app for the first time), never on a real church\'s data.',
      'Delete Everything & Load Sample Data',
    ))
  ) {
    return
  }
  loadingSampleData.value = true
  sampleDataLoaded.value = false
  dataCleared.value = false
  try {
    await deleteAllLibraryContent()

    for (const song of sampleSongs) await songsStore.save(song)
    for (const theme of sampleThemes) await themesStore.save(theme)
    for (const person of samplePeople) await peopleStore.save(person)
    for (const service of buildSampleServices()) await servicesStore.save(service)

    if (librarySettings.value) {
      librarySettings.value.serviceTypes = [...sampleServiceTypes]
      librarySettings.value.roleGroups = structuredClone(sampleRoleGroups)
      librarySettings.value.serviceTemplates = structuredClone(sampleServiceTemplates)
      librarySettings.value.collections = ['Hymns of Grace', 'Worship Hymnal']
      await store.save()
    }
    sampleDataLoaded.value = true
  } finally {
    loadingSampleData.value = false
  }
}

// Deliberately separate from loadSampleData — a church wanting to wipe demo content (or start
// over) before going live shouldn't have to load a fresh batch of sample data just to clear
// the old one out.
async function clearExistingData() {
  if (
    !(await confirmDialog.confirm(
      'This permanently deletes ALL songs, services, people, and themes in this library. This cannot be undone — make sure this library is not currently in use before doing this.',
      'Delete Everything',
    ))
  ) {
    return
  }
  clearingData.value = true
  sampleDataLoaded.value = false
  try {
    await deleteAllLibraryContent()
    dataCleared.value = true
  } finally {
    clearingData.value = false
  }
}

const pickingLibraryFolder = ref(false)
async function pickLibraryFolder() {
  pickingLibraryFolder.value = true
  try {
    const folder = await getAdapter().settings.pickLibraryFolder()
    if (folder && machineSettings.value) machineSettings.value.libraryPath = folder
  } finally {
    pickingLibraryFolder.value = false
  }
}

// Bible Translations — KJV is bundled (always resolvable, no config). ESV and api.bible
// editions (e.g. NIV) each need their own API key, entered below and stored per-machine in
// MachineSettings (never synced — see models/settings.ts) since a key is only meaningful on
// the machine it's configured on. `availableTranslationEntries` below is built from exactly
// the same rules commands::scripture::list_scripture_translations uses on the Rust side, so
// this list can never show something as "available" that the real picker wouldn't also offer.
const ESV_COPYRIGHT_NOTICE =
  'Scripture quotations marked (ESV) are from the ESV® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. www.esv.org'
const esvAvailable = ref(false)

const apiBibleCatalog = ref<ApiBibleCatalogEntry[]>([])
const loadingApiBibleCatalog = ref(false)
const pickedCatalogEntry = ref<ApiBibleCatalogEntry>()
let catalogLoadedForKey = ''

async function loadApiBibleCatalog() {
  const key = machineSettings.value?.apiBibleKey
  // Pass the draft key directly rather than relying on the Rust side re-reading
  // machine-settings.json — that file only has last Save's value, so without this the catalog
  // would silently fail to load until Save was pressed at least once.
  if (!key || catalogLoadedForKey === key || loadingApiBibleCatalog.value) return
  loadingApiBibleCatalog.value = true
  try {
    const catalog = await getAdapter().scripture.listApiBibleCatalog(key)
    // Defensive: api.bible's own id is the only field guaranteed unique — several editions
    // share an identical name/abbreviation (see catalogItemTitle below), so de-dupe on id
    // rather than trusting the response (or an overlapping re-fetch) to never repeat one.
    const seen = new Set<string>()
    apiBibleCatalog.value = catalog.filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    catalogLoadedForKey = key
  } catch (e) {
    console.error('Failed to list the api.bible catalog:', e)
  } finally {
    loadingApiBibleCatalog.value = false
  }
}

// Several api.bible editions share an identical name/abbreviation (e.g. four "World English
// Bible" entries — Protestant/Catholic/Orthodox/Ecumenical) — description is the only field
// that tells them apart, so it's appended whenever present rather than only showing the name.
function catalogItemTitle(entry: ApiBibleCatalogEntry): string {
  const base = `${entry.name} (${entry.abbreviation})`
  return entry.description ? `${base} — ${entry.description}` : base
}

const addTranslationError = ref('')
function addApiBibleTranslation() {
  if (!librarySettings.value || !pickedCatalogEntry.value) return
  const entry = pickedCatalogEntry.value
  addTranslationError.value = ''
  if (librarySettings.value.apiBibleTranslations.some((t) => t.bibleId === entry.id)) {
    addTranslationError.value = `${entry.name} is already added.`
    return
  }
  // api.bible abbreviations often carry a trailing edition year (e.g. "NIV11") — strip it for
  // a cleaner picker/live-slide code, falling back to the raw abbreviation if that leaves nothing.
  const code = entry.abbreviation.replace(/\d+$/, '').toUpperCase() || entry.abbreviation.toUpperCase()
  if (librarySettings.value.apiBibleTranslations.some((t) => t.code === code)) {
    addTranslationError.value = `"${code}" is already used by another translation — remove it first.`
    return
  }
  librarySettings.value.apiBibleTranslations.push({ code, label: entry.name, bibleId: entry.id })
  if (!librarySettings.value.defaultTranslationCode) librarySettings.value.defaultTranslationCode = code
  pickedCatalogEntry.value = undefined
}

async function removeApiBibleTranslation(code: string) {
  if (!librarySettings.value) return
  const index = librarySettings.value.apiBibleTranslations.findIndex((t) => t.code === code)
  if (index === -1) return
  const target = librarySettings.value.apiBibleTranslations[index]
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  if (!librarySettings.value) return
  const [removed] = librarySettings.value.apiBibleTranslations.splice(index, 1)
  const wasDefault = librarySettings.value.defaultTranslationCode === code
  if (wasDefault) librarySettings.value.defaultTranslationCode = 'KJV'
  undoStore.push(`Removed "${removed.label}"`, () => {
    if (!librarySettings.value) return
    librarySettings.value.apiBibleTranslations.splice(index, 0, removed)
    if (wasDefault) librarySettings.value.defaultTranslationCode = removed.code
  })
}

interface AvailableTranslationEntry {
  code: string
  name: string
  removable: boolean
  needsKey: boolean
}
const availableTranslationEntries = computed<AvailableTranslationEntry[]>(() => {
  const entries: AvailableTranslationEntry[] = [
    { code: 'KJV', name: 'King James Version', removable: false, needsKey: false },
  ]
  if (esvAvailable.value) {
    entries.push({ code: 'ESV', name: 'English Standard Version', removable: false, needsKey: false })
  }
  const apiBibleKeyConfigured = !!machineSettings.value?.apiBibleKey
  for (const t of librarySettings.value?.apiBibleTranslations ?? []) {
    entries.push({ code: t.code, name: t.label, removable: true, needsKey: !apiBibleKeyConfigured })
  }
  return entries
})
</script>

<template>
  <div v-if="librarySettings && machineSettings" class="settings-layout">
    <div class="settings-nav">
      <template v-for="group in groupedSections" :key="group.name">
        <div class="text-overline font-weight-bold text-primary px-3 pt-3">{{ group.name }}</div>
        <v-list density="compact" nav>
          <v-list-item
            v-for="section in group.items"
            :key="section.key"
            :active="activeSection === section.key"
            rounded="lg"
            @click="activeSection = section.key"
          >
            {{ section.label }}
          </v-list-item>
        </v-list>
      </template>
    </div>

    <div class="settings-content">
      <template v-if="activeSection === 'general'">
        <h2 class="text-h6 mb-4">General</h2>
        <v-text-field
          v-model="machineSettings.thisComputerName"
          label="This Computer's Name"
          hint="Shown on files this machine saves, so conflicting edits can be told apart."
          persistent-hint
          variant="outlined"
          density="comfortable"
          class="mb-6"
          style="max-width: 360px"
        />
        <v-switch v-model="darkMode" label="Dark mode" color="primary" hide-details class="mb-6" />

        <div class="d-flex align-center ga-3 mb-2" style="max-width: 560px">
          <div class="flex-grow-1">
            <div class="font-weight-bold">Library Sync Folder</div>
            <div class="text-caption text-medium-emphasis">{{ machineSettings.libraryPath }}</div>
          </div>
          <v-btn variant="flat" color="secondary" :loading="pickingLibraryFolder" @click="pickLibraryFolder">
            Change…
          </v-btn>
        </div>

        <v-btn variant="text" color="primary" prepend-icon="mdi-magic-staff" class="mt-4" @click="runSetupWizard">
          Run First-Time Setup Wizard
        </v-btn>
        <br />
        <v-btn
          variant="text"
          color="primary"
          prepend-icon="mdi-database-import-outline"
          class="mt-2"
          :loading="loadingSampleData"
          @click="loadSampleData"
        >
          Load Sample Data
        </v-btn>
        <div v-if="sampleDataLoaded" class="text-caption text-medium-emphasis mt-1">
          Sample songs, services, people, and themes added — check Home to see them.
        </div>
        <br />
        <v-btn
          variant="text"
          color="error"
          prepend-icon="mdi-delete-forever-outline"
          class="mt-2"
          :loading="clearingData"
          @click="clearExistingData"
        >
          Clear Existing Data
        </v-btn>
        <div v-if="dataCleared" class="text-caption text-medium-emphasis mt-1">
          All songs, services, people, and themes have been deleted.
        </div>
      </template>

      <template v-else-if="activeSection === 'sync'">
        <h2 class="text-h6 mb-4">Sync Status</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Checks that the library folder is readable, whether Dropbox appears to be running, and for any
          conflicted-copy files a sync may have left behind.
        </p>
        <v-btn variant="outlined" class="mb-4" :loading="refreshingSync" @click="refreshSyncStatus">Check Now</v-btn>

        <div v-if="syncStore.status" style="max-width: 480px">
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon
              :icon="syncStore.status.folderReadable ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="syncStore.status.folderReadable ? 'success' : 'error'"
              size="small"
            />
            <span class="text-body-2">Library folder {{ syncStore.status.folderReadable ? 'readable' : 'not readable' }}</span>
          </div>
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon
              :icon="syncStore.status.syncClientRunning ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="syncStore.status.syncClientRunning ? 'success' : 'warning'"
              size="small"
            />
            <span class="text-body-2">
              Dropbox {{ syncStore.status.syncClientRunning ? 'appears to be running' : "doesn't appear to be running" }}
            </span>
          </div>
          <div v-if="syncStore.status.lastLibraryChangeAt" class="text-caption text-medium-emphasis mb-4">
            Last library change: {{ new Date(syncStore.status.lastLibraryChangeAt).toLocaleString() }}
          </div>

          <v-btn
            v-if="syncStore.status.conflictCount > 0"
            variant="flat"
            color="warning"
            prepend-icon="mdi-alert"
            to="/sync-conflicts"
          >
            Resolve {{ syncStore.status.conflictCount }} Conflict{{ syncStore.status.conflictCount === 1 ? '' : 's' }}
          </v-btn>
          <p v-else class="text-medium-emphasis text-body-2">No sync conflicts right now.</p>
        </div>
      </template>

      <template v-else-if="activeSection === 'display'">
        <h2 class="text-h6 mb-4">Display Setup</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Assign each connected display a role. Changes here apply immediately.
        </p>
        <v-alert v-if="needsSingleMonitorFallback(displays)" type="info" variant="tonal" class="mb-4">
          Only one display detected — the operator view and audience output can't be shown on separate
          screens yet. Everything uses this display until a second monitor is connected.
        </v-alert>
        <p v-if="displays.length === 0" class="text-medium-emphasis text-body-2">No displays detected.</p>
        <div v-for="display in displays" :key="display.id" class="d-flex align-center ga-3 mb-3" style="max-width: 560px">
          <div class="flex-grow-1">
            <div class="font-weight-bold">{{ display.name }}</div>
            <div class="text-caption text-medium-emphasis">{{ display.resolution }}</div>
          </div>
          <v-select
            :model-value="display.role"
            :items="roleOptions"
            label="Role"
            variant="outlined"
            density="compact"
            style="width: 220px"
            hide-details
            :disabled="needsSingleMonitorFallback(displays)"
            @update:model-value="(role: DisplayRole) => assignRole(display.id, role)"
          />
          <v-btn variant="flat" color="secondary" @click="identifyDisplay(display.id)">Identify</v-btn>
        </div>
      </template>

      <template v-else-if="activeSection === 'external-apps'">
        <h2 class="text-h6 mb-4">External Apps</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Profiles for handing a service item off to another app (PowerPoint, VLC, etc.) — focusing its window,
          remembering where it sits, and optionally forwarding Next/Prev keystrokes.
        </p>

        <v-list v-if="externalAppProfiles.length > 0" density="comfortable" class="mb-4" style="max-width: 560px">
          <v-list-item v-for="profile in externalAppProfiles" :key="profile.id" rounded="lg" class="mb-1" border>
            <template #prepend>
              <v-icon icon="mdi-application-outline" class="mr-3" />
            </template>
            <v-list-item-title class="font-weight-bold">{{ profile.name || '(Unnamed)' }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ profile.launchMode === 'already-running' ? 'Already Running' : 'Launch Automatically' }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" @click.stop="openEditExternalAppProfile(profile)" />
              <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error" @click.stop="deleteExternalAppProfile(profile)" />
            </template>
          </v-list-item>
        </v-list>
        <p v-else class="text-medium-emphasis text-body-2 mb-4">No external app profiles configured yet.</p>

        <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="openNewExternalAppProfile">Add Profile</v-btn>

        <v-dialog v-model="profileDialogOpen" max-width="640">
          <v-card v-if="editingProfile">
            <v-card-title>External App Profile{{ editingProfile.name ? ` — ${editingProfile.name}` : '' }}</v-card-title>
            <v-card-text>
              <v-text-field v-model="editingProfile.name" label="Name" variant="outlined" density="comfortable" class="mb-4" />

              <div class="text-caption text-medium-emphasis font-weight-bold text-uppercase mb-2">Launch Mode</div>
              <v-btn-toggle v-model="editingProfile.launchMode" mandatory density="comfortable" class="mb-4 d-flex" style="width: 100%">
                <v-btn
                  v-for="option in launchModeOptions"
                  :key="option.value"
                  :value="option.value"
                  class="flex-grow-1"
                  style="height: auto"
                >
                  <div class="text-left py-1">
                    <div class="text-body-2 font-weight-bold">{{ option.title }}</div>
                    <div class="text-caption text-medium-emphasis" style="white-space: normal">{{ option.hint }}</div>
                  </div>
                </v-btn>
              </v-btn-toggle>

              <v-text-field
                v-model="editingProfile.executablePath"
                label="Executable"
                variant="outlined"
                density="comfortable"
                hint="Used to launch the app and/or recognize its already-running process."
                persistent-hint
                class="mb-4"
              >
                <template #append>
                  <v-btn variant="outlined" @click="pickExternalAppExecutable">Browse…</v-btn>
                </template>
              </v-text-field>

              <template v-if="editingProfile.launchMode === 'launch-automatically'">
                <v-text-field
                  v-model="editingProfile.parameterFormat"
                  label="Parameter Format"
                  variant="outlined"
                  density="comfortable"
                  hint="{file} is replaced with the file chosen when this app is added to a service."
                  persistent-hint
                  class="mb-1"
                />
                <div class="param-preview mb-3">
                  Will run: {{ previewExternalAppCommand(editingProfile.executablePath, editingProfile.parameterFormat) }}
                </div>

                <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
                  Worship Studio checks the executable and chosen file both exist when this item is added to a
                  service — not just when the slide is reached — so a missing file is caught during prep, not
                  mid-service.
                </v-alert>
              </template>

              <div>
                <v-btn
                  variant="outlined"
                  color="primary"
                  size="small"
                  :loading="testingLaunch"
                  :disabled="!isEditingSavedProfile"
                  @click="testLaunchExternalApp"
                >
                  Test Launch
                </v-btn>
                <span v-if="!isEditingSavedProfile" class="text-caption text-medium-emphasis ml-2">Save this profile first</span>
              </div>
              <v-alert
                v-if="testLaunchResult"
                :type="testLaunchResult.ok ? 'success' : 'error'"
                variant="tonal"
                density="compact"
                class="mt-3"
              >
                {{ testLaunchResult.message }}
              </v-alert>

              <v-divider class="my-5" />

              <div class="d-flex align-center justify-space-between mb-3">
                <div>
                  <div class="font-weight-bold">Basic Remote Controls</div>
                  <div class="text-caption text-medium-emphasis">
                    Let Next/Prev and the remote control also drive this app, if it supports simple commands
                  </div>
                </div>
                <v-switch v-model="editingProfile.remoteControlsEnabled" color="primary" hide-details />
              </div>
              <template v-if="editingProfile.remoteControlsEnabled">
                <v-text-field
                  v-model="editingProfile.nextKey"
                  label="Next slide key"
                  placeholder="e.g. Right Arrow"
                  variant="outlined"
                  density="compact"
                  class="mb-2"
                />
                <v-text-field
                  v-model="editingProfile.prevKey"
                  label="Previous slide key"
                  placeholder="e.g. Left Arrow"
                  variant="outlined"
                  density="compact"
                  class="mb-1"
                />
                <div class="text-caption text-medium-emphasis mb-2">
                  Sent as a keystroke to the app's window when Next/Prev is pressed while this item is live. Leave
                  blank if the app doesn't support this.
                </div>
              </template>

              <v-divider class="my-5" />

              <div class="d-flex align-center justify-space-between">
                <div>
                  <div class="font-weight-bold">Window Position</div>
                  <div class="text-caption text-medium-emphasis">
                    {{
                      editingProfile.windowPosition
                        ? `Captured — ${editingProfile.windowPosition.width}×${editingProfile.windowPosition.height} on ${editingProfile.windowPosition.monitorId}`
                        : 'Not captured yet'
                    }}
                  </div>
                </div>
                <v-btn
                  variant="flat"
                  color="secondary"
                  size="small"
                  :loading="capturingPosition"
                  :disabled="!isEditingSavedProfile"
                  @click="recaptureWindowPosition"
                >
                  Recapture Position
                </v-btn>
              </div>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="profileDialogOpen = false">Cancel</v-btn>
              <v-btn variant="flat" color="primary" @click="saveExternalAppProfile">Save Profile</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </template>

      <template v-else-if="activeSection === 'remote-control'">
        <h2 class="text-h6 mb-4">Remote Control</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Control the live presentation from a phone or tablet on the same network. Pair a device once — it
          stays authorized until revoked here.
        </p>
        <p v-if="remoteServerInfo && !remoteServerInfo.lanIp" class="text-warning text-body-2 mb-4">
          Couldn't detect a network address for this computer — check that it's connected to the church's
          network, then reopen this screen.
        </p>

        <v-list v-if="remoteDevices.length > 0" density="comfortable" class="mb-4" style="max-width: 560px">
          <v-list-item v-for="device in remoteDevices" :key="device.id" rounded="lg" class="mb-1" border>
            <template #prepend><v-icon icon="mdi-cellphone" class="mr-3" /></template>
            <v-list-item-title class="font-weight-bold">{{ device.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ accessLevelLabel(device.accessLevel) }}</v-list-item-subtitle>
            <template #append>
              <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error" @click.stop="revokeRemoteDevice(device)" />
            </template>
          </v-list-item>
        </v-list>
        <p v-else class="text-medium-emphasis text-body-2 mb-4">No devices paired yet.</p>

        <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="openProvisionDialog">Pair a Device</v-btn>

        <v-dialog v-model="provisionDialogOpen" max-width="480">
          <v-card>
            <v-card-title>Pair a Device</v-card-title>
            <v-card-text>
              <template v-if="!provisionResult">
                <v-text-field
                  v-model="newDeviceName"
                  label="Device Name"
                  placeholder="e.g. John's iPhone"
                  variant="outlined"
                  density="comfortable"
                  autofocus
                  class="mb-2"
                />
                <v-select
                  v-model="newDeviceAccessLevel"
                  :items="accessLevelOptions"
                  label="Access Level"
                  variant="outlined"
                  density="comfortable"
                />
                <div class="text-caption text-medium-emphasis mb-2">
                  <div><strong>View Only</strong> — mirrors the presentation screen, no controls.</div>
                  <div><strong>Advance Only</strong> — mirror plus Previous/Next.</div>
                  <div><strong>Full Control</strong> — mirror, Previous/Next, and Start/Stop Presenting.</div>
                </div>
              </template>
              <template v-else>
                <div class="text-center mb-3">
                  <img :src="provisionResult.qrDataUrl" alt="Pairing QR code" style="width: 220px; height: 220px" />
                </div>
                <p class="text-body-2 text-center mb-2">
                  Scan this with "{{ newDeviceName }}"'s camera, or open this link on it directly:
                </p>
                <p class="text-caption text-medium-emphasis text-center" style="word-break: break-all">
                  {{ provisionResult.pairingUrl }}
                </p>
              </template>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <template v-if="!provisionResult">
                <v-btn variant="text" @click="provisionDialogOpen = false">Cancel</v-btn>
                <v-btn variant="flat" color="primary" :loading="provisioning" :disabled="!newDeviceName.trim()" @click="provisionDevice">
                  Generate QR Code
                </v-btn>
              </template>
              <v-btn v-else variant="flat" color="primary" @click="provisionDialogOpen = false">Done</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </template>

      <template v-else-if="activeSection === 'service-types'">
        <h2 class="text-h6 mb-4">Service Types</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The choices offered on Create Service's Type field.
        </p>
        <ManagedStringList v-model="librarySettings.serviceTypes" add-label="Add a service type…" />
      </template>

      <template v-else-if="activeSection === 'collections'">
        <h2 class="text-h6 mb-4">Song Collections</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Named songbooks/collections (e.g. "Hymns of Grace") a song can belong to, with its own number.
        </p>
        <ManagedStringList v-model="librarySettings.collections" add-label="Add a collection…" />
      </template>

      <template v-else-if="activeSection === 'bible-translations'">
        <h2 class="text-h6 mb-4">Bible Translations</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          King James Version is bundled and always available. ESV and api.bible editions (e.g. NIV) each
          need a free API key, entered below — keys are per-machine and never sync, so this machine's key
          must be entered here even if another machine already has one.
        </p>

        <h3 class="text-subtitle-2 mb-2">ESV — api.esv.org</h3>
        <v-text-field
          v-model="machineSettings.esvApiKey"
          label="ESV API key"
          type="password"
          variant="outlined"
          density="compact"
          autocomplete="off"
          hint="Free account at api.esv.org (Bible Translations settings)."
          persistent-hint
          style="max-width: 420px"
          class="mb-2"
        />
        <v-alert v-if="esvAvailable" type="success" variant="tonal" density="compact" class="mb-6" style="max-width: 560px">
          {{ ESV_COPYRIGHT_NOTICE }}
        </v-alert>
        <v-alert
          v-else-if="machineSettings.esvApiKey"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-6"
          style="max-width: 560px"
        >
          Save Settings to verify this key.
        </v-alert>
        <p v-else class="text-medium-emphasis text-body-2 mb-6">Not configured on this machine.</p>

        <h3 class="text-subtitle-2 mb-2">api.bible — NIV and other editions</h3>
        <v-text-field
          v-model="machineSettings.apiBibleKey"
          label="api.bible API key"
          type="password"
          variant="outlined"
          density="compact"
          autocomplete="off"
          hint="Free account at scripture.api.bible."
          persistent-hint
          style="max-width: 420px"
          class="mb-2"
        />
        <div v-if="machineSettings.apiBibleKey" class="mb-6">
          <div class="d-flex flex-wrap align-end ga-3 mb-2">
            <v-autocomplete
              v-model="pickedCatalogEntry"
              :items="apiBibleCatalog"
              :loading="loadingApiBibleCatalog"
              :item-title="catalogItemTitle"
              item-value="id"
              return-object
              label="Add a translation…"
              variant="outlined"
              density="compact"
              style="width: 380px"
              @update:focused="(focused: boolean) => focused && loadApiBibleCatalog()"
            />
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              :disabled="!pickedCatalogEntry"
              @click="addApiBibleTranslation"
            >
              Add
            </v-btn>
          </div>
          <p v-if="addTranslationError" class="text-caption text-error">{{ addTranslationError }}</p>
        </div>
        <p v-else class="text-medium-emphasis text-body-2 mb-6">Not configured on this machine.</p>

        <h3 class="text-subtitle-2 mb-2">Available Translations</h3>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The default is used unless a passage is switched to another translation live.
        </p>
        <v-radio-group v-model="librarySettings.defaultTranslationCode" hide-details class="mb-4">
          <div
            v-for="entry in availableTranslationEntries"
            :key="entry.code"
            class="d-flex align-center ga-3 mb-2"
            style="max-width: 560px"
          >
            <v-radio :value="entry.code" />
            <div class="flex-grow-1">
              <div class="font-weight-bold">{{ entry.name }} ({{ entry.code }})</div>
              <div v-if="entry.needsKey" class="text-caption text-warning">Needs the api.bible key above</div>
            </div>
            <v-btn
              v-if="entry.removable"
              icon="mdi-trash-can-outline"
              variant="flat"
              color="error"
              size="small"
              @click="removeApiBibleTranslation(entry.code)"
            />
          </div>
        </v-radio-group>
      </template>

      <template v-else-if="activeSection === 'canva'">
        <h2 class="text-h6 mb-4">Canva</h2>
        <p class="text-medium-emphasis text-body-2 mb-4" style="max-width: 680px">
          Optional local integration for creating and editing slide designs in Canva. These
          credentials stay on this computer and never sync. Canva tools remain completely hidden
          in the slide editor until both values are saved.
        </p>
        <v-alert type="info" variant="tonal" density="compact" class="mb-4" style="max-width: 680px">
          In the Canva Developer Portal, authorize
          <code>http://127.0.0.1:47823/canva/callback</code> and enable
          <code>design:meta:read</code>, <code>design:content:read</code>, and
          <code>design:content:write</code>.
        </v-alert>
        <v-text-field
          v-model="machineSettings.canvaClientId"
          label="Canva client ID"
          variant="outlined"
          density="compact"
          autocomplete="off"
          style="max-width: 520px"
          class="mb-2"
        />
        <v-text-field
          v-model="machineSettings.canvaClientSecret"
          label="Canva client secret"
          type="password"
          variant="outlined"
          density="compact"
          autocomplete="off"
          style="max-width: 520px"
          hint="Stored only in this machine's app-data settings."
          persistent-hint
        />
      </template>

      <template v-else-if="activeSection === 'font-sizes'">
        <h2 class="text-h6 mb-4">Font Sizes</h2>
        <p class="text-medium-emphasis text-body-2 mb-6">
          How large text auto-fits on the audience display, per content type.
        </p>

        <h3 class="text-subtitle-2 mb-2">Scripture</h3>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Scripture text auto-fits as large as possible within this range. A passage that still doesn't fit at the
          minimum size splits across slides at verse boundaries instead of shrinking further.
        </p>
        <div class="d-flex ga-3 mb-6" style="max-width: 420px">
          <v-text-field
            v-model.number="librarySettings.scriptureMinFontSizePx"
            label="Minimum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
          <v-text-field
            v-model.number="librarySettings.scriptureMaxFontSizePx"
            label="Maximum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
        </div>

        <h3 class="text-subtitle-2 mb-2">Song Lyrics</h3>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Each part (Verse, Chorus, etc.) is already its own slide — no splitting across slides. A line only wraps
          if it truly doesn't fit even at the minimum size, and only ever breaks at a comma or semicolon, never
          mid-word.
        </p>
        <div class="d-flex ga-3" style="max-width: 420px">
          <v-text-field
            v-model.number="librarySettings.songMinFontSizePx"
            label="Minimum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
          <v-text-field
            v-model.number="librarySettings.songMaxFontSizePx"
            label="Maximum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
        </div>

        <h3 class="text-subtitle-2 mb-2">Header &amp; Footer</h3>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The reference/title above the text (e.g. "John 3:16-17") and the translation/sub-label below it (e.g.
          "ESV") — a fixed position and size, unlike the auto-fit text above them.
        </p>
        <div class="d-flex ga-3" style="max-width: 420px">
          <v-text-field
            v-model.number="librarySettings.slideHeaderFontSizePx"
            label="Header size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
          <v-text-field
            v-model.number="librarySettings.slideFooterFontSizePx"
            label="Footer size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
        </div>

        <h3 class="text-subtitle-2 mb-2">Wayfinding Display</h3>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The reference-only scripture display's surrounding book names and centered reference — the reference and
          nearest book approach the maximum size, the farthest book shown uses the minimum, with sizes in between
          scaled by distance. Unlike scripture/song text above, there's no auto-shrink safety net, so very large
          sizes can overflow a long reference.
        </p>
        <div class="d-flex ga-3" style="max-width: 420px">
          <v-text-field
            v-model.number="librarySettings.wayfindingMinFontSizePx"
            label="Minimum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
          <v-text-field
            v-model.number="librarySettings.wayfindingMaxFontSizePx"
            label="Maximum size (px)"
            type="number"
            variant="outlined"
            density="compact"
            min="1"
          />
        </div>
      </template>

      <template v-else-if="activeSection === 'themes'">
        <h2 class="text-h6 mb-4">Themes</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Background, font, and text-color presets for songs, scripture, announcements, and welcome/closing
          slides — pulling backgrounds from Branding colors or the Media Library.
        </p>
        <v-btn variant="flat" color="primary" prepend-icon="mdi-palette-outline" to="/library/themes">
          Open Theme Editor
        </v-btn>
      </template>

      <template v-else-if="activeSection === 'roles'">
        <h2 class="text-h6 mb-4">Roles</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The roles offered on each service's Assignments page (Piano, Sound Booth, Greeters, Preacher, etc.),
          organized into categories.
        </p>
        <RoleGroupEditor v-model="librarySettings.roleGroups" />
      </template>

      <template v-else-if="activeSection === 'service-templates'">
        <h2 class="text-h6 mb-4">Service Templates</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The shell of a typical service, in order — songs, scripture, sermon, bulletin notes, and
          role-only assignments (e.g. 2 Greeters). Seeds a new service's items and Assignments once
          when it's created; editing a template never changes services already created.
        </p>
        <ServiceTemplateEditor
          v-model="librarySettings.serviceTemplates"
          :role-groups="librarySettings.roleGroups"
          :service-types="librarySettings.serviceTypes"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  align-items: start;
}
.settings-nav {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: calc(100vh - 49px);
}
.settings-content {
  padding: 24px 32px;
  max-width: 720px;
}
.param-preview {
  font-family: monospace;
  font-size: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
