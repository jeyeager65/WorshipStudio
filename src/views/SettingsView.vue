<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
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
import {
  buildSampleServices,
  sampleSongs,
  sampleThemes,
  samplePeople,
  sampleRoleGroups,
  sampleServiceTemplates,
  sampleServiceTypes,
} from '@/utils/sampleData'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ManagedStringList from '@/components/settings/ManagedStringList.vue'
import SettingsPageHeader from '@/components/settings/SettingsPageHeader.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'
import type {
  ApiBibleCatalogEntry,
  DisplayInfo,
  DisplayRole,
  ExternalAppProfile,
  RemoteDevice,
} from '@/adapters/types'
import { personDisplayName } from '@/models/library'

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
// The folder shown in the draft settings can change before Save. Keep the last persisted path
// separately so saving unrelated settings does not produce a reload prompt, while a real
// library switch does—even after the reactive settings object has already been edited.
const savedLibraryPath = ref('')
const savedRemoteControlPort = ref<number>()
const savedRemoteControlHostname = ref<string>()
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
  | 'appearance'
  | 'branding'
  | 'display'
  | 'font-sizes'
  | 'service-types'
  | 'collections'
  | 'bible-translations'
  | 'sync'
  | 'external-apps'
  | 'remote-control'
  | 'canva'
  | 'about'
const activeSection = ref<Section>('general')
const sections: { key: Section; label: string; group: string }[] = [
  { key: 'general', label: 'This Computer', group: 'Application' },
  { key: 'sync', label: 'Library & Sync', group: 'Application' },
  { key: 'about', label: 'About', group: 'Application' },
  // Display groups the physical setup, sizing, and hand-off to other on-screen apps. Reusable
  // presentation themes are library content and live in the primary navigation instead.
  { key: 'appearance', label: 'Appearance', group: 'Appearance & Displays' },
  { key: 'branding', label: 'Branding', group: 'Appearance & Displays' },
  { key: 'display', label: 'Display Setup', group: 'Appearance & Displays' },
  { key: 'font-sizes', label: 'Text Sizing', group: 'Appearance & Displays' },
  // Windows-only (Win32 window hand-off) — the port is entirely absent on the macOS/demo
  // build, unlike Display Setup which still has something to show (real monitors) in mock.
  ...(getAdapter().externalApps
    ? [{ key: 'external-apps' as const, label: 'External Apps', group: 'Appearance & Displays' }]
    : []),
  // Needs the bundled local HTTP server (see adapters/types.ts's RemotePort doc comment) —
  // not meaningful in the static/mock demo build even though the port itself exists there.
  ...(getAdapter().kind === 'tauri'
    ? [{ key: 'remote-control' as const, label: 'Remote Control', group: 'Appearance & Displays' }]
    : []),
  // Content Library is genuinely just the shared library content itself — song categorization
  // and the scripture translations resolved into services, not anything about how a service
  // is structured or staffed (that's Services & Scheduling below).
  { key: 'collections', label: 'Song Collections', group: 'Content Library' },
  { key: 'bible-translations', label: 'Bible Translations', group: 'Content Library' },
  ...(getAdapter().canva
    ? [{ key: 'canva' as const, label: 'Canva', group: 'Content Library' }]
    : []),
  // Service types are configuration used by the primary Service Templates feature. Roles have
  // their own core management page because they are also used by people and assignments.
  { key: 'service-types', label: 'Service Types', group: 'Service Planning' },
]
const sectionIcons: Record<Section, string> = {
  general: 'mdi-laptop',
  sync: 'mdi-folder-sync-outline',
  about: 'mdi-information-outline',
  appearance: 'mdi-theme-light-dark',
  branding: 'mdi-palette-swatch-outline',
  display: 'mdi-monitor-multiple',
  'font-sizes': 'mdi-format-size',
  'external-apps': 'mdi-open-in-new',
  'remote-control': 'mdi-cellphone-link',
  collections: 'mdi-bookshelf',
  'bible-translations': 'mdi-book-cross',
  canva: 'mdi-palette-swatch-outline',
  'service-types': 'mdi-calendar-multiple',
}
const sectionDescriptions: Record<Section, string> = {
  general: 'Identify this workstation and rerun the guided setup when its role changes.',
  sync: 'Choose where this computer keeps the shared library and monitor synchronization health.',
  about: 'Version details, project resources, releases, and support links.',
  appearance: 'Control how the Worship Studio operator interface looks on this computer.',
  branding: 'Set the church identity used across reports, themes, and exported documents.',
  display: 'Assign connected monitors to operator and audience responsibilities.',
  'font-sizes': 'Set the typography ranges used when content is fitted to audience slides.',
  'external-apps': 'Configure reliable handoffs to PowerPoint, VLC, and other presentation tools.',
  'remote-control': 'Pair phones and tablets that can monitor or control the live presentation.',
  collections: 'Manage the songbooks and collections available when cataloging songs.',
  'bible-translations': 'Choose scripture editions and configure the services that provide them.',
  canva: 'Connect this computer to Canva for creating and importing slide designs.',
  'service-types': 'Manage the service-type choices offered when a service is created.',
}
const activeSectionInfo = computed(() => {
  const section =
    sections.find((candidate) => candidate.key === activeSection.value) ?? sections[0]!
  return {
    ...section,
    icon: sectionIcons[section.key],
    description: sectionDescriptions[section.key],
  }
})
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

function selectSettingsSection(section: Section) {
  activeSection.value = section
}

// Registering `watch` after an `await` (inside onMounted's async callback) happens outside
// Vue's synchronous component-setup tracking, so it isn't auto-stopped on unmount — it would
// keep reacting to store.librarySettings/machineSettings mutations from *other* views (e.g.
// the setup wizard) after this one is long gone, wrongly flagging isDirty. Stopping it
// explicitly in onUnmounted is what actually scopes it to this view's lifetime.
let stopSettingsWatch: (() => void) | undefined

onMounted(async () => {
  await store.load()
  savedLibraryPath.value = machineSettings.value?.libraryPath ?? ''
  savedRemoteControlPort.value = machineSettings.value?.remoteControlPort
  savedRemoteControlHostname.value = machineSettings.value?.remoteControlHostname
  isDirty.value = false
  // Registered after the initial load so it only reacts to actual user edits, not the
  // assignment above — same pattern as Song Editor/Service Workspace.
  stopSettingsWatch = watch([librarySettings, machineSettings], () => (isDirty.value = true), {
    deep: true,
  })
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveSettings
  await loadDisplays()
  await loadExternalApps()
  await Promise.all([peopleStore.load(), loadRemoteDevices()])

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
  const libraryPathChanged =
    !!machineSettings.value && machineSettings.value.libraryPath !== savedLibraryPath.value
  const remotePortChanged =
    machineSettings.value?.remoteControlPort !== savedRemoteControlPort.value
  const remoteHostnameChanged =
    machineSettings.value?.remoteControlHostname !== savedRemoteControlHostname.value
  const remoteConnectionChanged = remotePortChanged || remoteHostnameChanged
  saving.value = true
  try {
    await store.save()
    savedLibraryPath.value = machineSettings.value?.libraryPath ?? savedLibraryPath.value
    savedRemoteControlPort.value = machineSettings.value?.remoteControlPort
    savedRemoteControlHostname.value = machineSettings.value?.remoteControlHostname
    isDirty.value = false
    if (
      (libraryPathChanged || remoteConnectionChanged) &&
      (await confirmDialog.confirm(
        libraryPathChanged && remoteConnectionChanged
          ? 'The library folder and Remote Control connection settings have changed. Reload Worship Studio now to apply them?'
          : libraryPathChanged
            ? 'The library folder has changed. Reload Worship Studio now to load its services and other library content?'
            : 'The Remote Control connection settings have changed. Reload Worship Studio now to apply them?',
        'Reload Now',
      ))
    ) {
      window.location.reload()
    }
  } finally {
    saving.value = false
  }
}

// Dark mode applies live for instant feedback (so the toggle isn't disorienting to use),
// but — like every other edit in this view — still needs Save pressed to persist for next
// launch (see App.vue, which reads the saved value at startup).
const theme = useTheme()
const aboutLogo = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))
const brandingLogoPickerOpen = ref(false)
const brandingLogoPreviewUrl = ref<string>()
const brandingLogoLoading = ref(false)

watch(
  () => librarySettings.value?.branding.logoMediaId,
  async (mediaId) => {
    brandingLogoPreviewUrl.value = undefined
    if (!mediaId) return
    brandingLogoLoading.value = true
    try {
      const url = await getAdapter().media.getPreviewUrl(mediaId)
      // Do not let a slower request for the previous logo replace a newer selection.
      if (librarySettings.value?.branding.logoMediaId === mediaId)
        brandingLogoPreviewUrl.value = url
    } catch (error) {
      console.error('Failed to load branding logo:', error)
    } finally {
      if (librarySettings.value?.branding.logoMediaId === mediaId) brandingLogoLoading.value = false
    }
  },
  { immediate: true },
)

function selectBrandingLogo(mediaId: string) {
  if (librarySettings.value) librarySettings.value.branding.logoMediaId = mediaId
}

function removeBrandingLogo() {
  if (!librarySettings.value) return
  librarySettings.value.branding.logoMediaId = undefined
  brandingLogoPreviewUrl.value = undefined
}

function setBrandingColor(which: 'primaryColor' | 'secondaryColor', event: Event) {
  if (!librarySettings.value) return
  librarySettings.value.branding[which] = (event.target as HTMLInputElement).value.toUpperCase()
}
const appVersion = ref('')
void getVersion()
  .then((version) => (appVersion.value = version))
  .catch(() => (appVersion.value = 'Development build'))

const projectLinks = [
  {
    label: 'Source Code',
    description: 'View the Worship Studio source on GitHub',
    icon: 'mdi-github',
    url: 'https://github.com/jeyeager65/WorshipStudio',
  },
  {
    label: 'Report an Issue',
    description: 'Report a bug or request a feature',
    icon: 'mdi-bug-outline',
    url: 'https://github.com/jeyeager65/WorshipStudio/issues',
  },
  {
    label: 'Releases',
    description: 'See release notes and available downloads',
    icon: 'mdi-tag-outline',
    url: 'https://github.com/jeyeager65/WorshipStudio/releases',
  },
] as const

async function openProjectLink(url: string) {
  if (getAdapter().kind === 'tauri') await openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

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
const loadingDisplays = ref(false)
const roleOptions: { title: string; value: DisplayRole }[] = [
  { title: 'Operator (this window)', value: 'operator' },
  { title: 'Audience Display', value: 'audience' },
  { title: 'Not Used', value: 'not-used' },
]
async function loadDisplays() {
  // Not wired to a real command on the native Tauri backend yet (README's adapter-status
  // note) — falls back to "no displays detected" rather than leaving an unhandled rejection.
  loadingDisplays.value = true
  try {
    displays.value = (await getAdapter().displays?.list()) ?? []
  } catch (e) {
    console.error('Failed to list displays:', e)
    displays.value = []
  } finally {
    loadingDisplays.value = false
  }
}
// Role assignment is an immediate hardware-config action, not a staged edit like the rest
// of this screen — there's nothing meaningful to "revert" before Save, so it applies (and
// persists) right away, same reasoning as the spec's External Apps "Test Launch" button.
async function assignRole(displayId: string, role: DisplayRole) {
  await getAdapter().displays?.assignRole(displayId, role)
  const display = displays.value.find((d) => d.id === displayId)
  if (display) display.role = role
  // Keep the staged settings model aligned with the immediate backend write so a later Save
  // on this page cannot put the previous display role map back.
  if (machineSettings.value) machineSettings.value.displayRoles[displayId] = role
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
const launchModeOptions: {
  title: string
  value: ExternalAppProfile['launchMode']
  hint: string
}[] = [
  {
    title: 'Already Running',
    value: 'already-running',
    hint: 'Operator opens it manually before the service',
  },
  {
    title: 'Launch Automatically',
    value: 'launch-automatically',
    hint: 'Worship Studio opens it when the slide is reached',
  },
]

const profileDialogOpen = ref(false)
const editingProfile = ref<ExternalAppProfile>()
// Test Launch/Recapture Position both act on the profile as saved on disk (the Rust side
// looks it up by id) — until Save Profile has run at least once, there's nothing for them to
// act on yet, so they stay disabled with a hint rather than silently auto-saving.
const isEditingSavedProfile = computed(() =>
  externalAppProfiles.value.some((p) => p.id === editingProfile.value?.id),
)

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
  if (
    !(await confirmDialog.confirm(`Delete the "${profile.name}" external app profile?`, 'Delete'))
  )
    return
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

// Remote Control devices are machine-local, but ownership points at the synced people library.
const remoteDevices = ref<RemoteDevice[]>([])
const remoteServerInfo = ref<{ hostname?: string; lanIp?: string; port: number }>()
const remoteHostnameOverride = computed<string>({
  get: () => machineSettings.value?.remoteControlHostname ?? '',
  set: (hostname) => {
    if (machineSettings.value)
      machineSettings.value.remoteControlHostname = hostname.trim() || undefined
  },
})
const remotePortOverride = computed<number | null>({
  get: () => machineSettings.value?.remoteControlPort ?? null,
  set: (port) => {
    if (machineSettings.value) machineSettings.value.remoteControlPort = port ?? undefined
  },
})
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
const newDevicePersonId = ref('')
const newDeviceName = ref('')
const newDeviceAccessLevel = ref<RemoteDevice['accessLevel']>('advance-only')
const provisioning = ref(false)
const provisionResult = ref<{ qrDataUrl: string; pairingUrl: string }>()
const repairingDeviceId = ref<string>()
const remotePersonOptions = computed(() =>
  [...peopleStore.people]
    .sort((a, b) => personDisplayName(a).localeCompare(personDisplayName(b)))
    .map((person) => ({ title: personDisplayName(person), value: person.id })),
)

function remoteDeviceOwner(device: RemoteDevice): string {
  const owner = peopleStore.people.find((person) => person.id === device.personId)
  return owner ? personDisplayName(owner) : 'Unassigned legacy device'
}

function openProvisionDialog(personId = '') {
  newDevicePersonId.value = personId
  newDeviceName.value = ''
  newDeviceAccessLevel.value = 'advance-only'
  provisionResult.value = undefined
  provisionDialogOpen.value = true
}
async function provisionDevice() {
  if (!newDevicePersonId.value || !newDeviceName.value.trim() || provisioning.value) return
  provisioning.value = true
  try {
    provisionResult.value = await getAdapter().remote?.provisionDevice(
      newDevicePersonId.value,
      newDeviceName.value.trim(),
      newDeviceAccessLevel.value,
    )
    await loadRemoteDevices()
  } catch (e) {
    console.error('Failed to provision remote device:', e)
  } finally {
    provisioning.value = false
  }
}
async function repairRemoteDevice(device: RemoteDevice) {
  repairingDeviceId.value = device.id
  try {
    provisionResult.value = await getAdapter().remote?.repairDevice(device.id)
    newDeviceName.value = device.name
    newDevicePersonId.value = device.personId ?? ''
    provisionDialogOpen.value = true
  } catch (e) {
    console.error('Failed to re-pair remote device:', e)
  } finally {
    repairingDeviceId.value = undefined
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
  await Promise.all([
    songsStore.load(),
    servicesStore.load(),
    peopleStore.load(),
    themesStore.load(),
  ])
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
      "This permanently deletes ALL existing songs, services, people, and themes in this library, and replaces them with demo content. This cannot be undone — only use this on a library you don't need (e.g. exploring the app for the first time), never on a real church's data.",
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
const libraryPathIsRelative = computed(() => {
  const path = machineSettings.value?.libraryPath.trim() ?? ''
  return !!path && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path)
})

function usePortableLibraryFolder() {
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
  const code =
    entry.abbreviation.replace(/\d+$/, '').toUpperCase() || entry.abbreviation.toUpperCase()
  if (librarySettings.value.apiBibleTranslations.some((t) => t.code === code)) {
    addTranslationError.value = `"${code}" is already used by another translation — remove it first.`
    return
  }
  librarySettings.value.apiBibleTranslations.push({ code, label: entry.name, bibleId: entry.id })
  if (!librarySettings.value.defaultTranslationCode)
    librarySettings.value.defaultTranslationCode = code
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
    entries.push({
      code: 'ESV',
      name: 'English Standard Version',
      removable: false,
      needsKey: false,
    })
  }
  const apiBibleKeyConfigured = !!machineSettings.value?.apiBibleKey
  for (const t of librarySettings.value?.apiBibleTranslations ?? []) {
    entries.push({ code: t.code, name: t.label, removable: true, needsKey: !apiBibleKeyConfigured })
  }
  return entries
})

function translationSource(entry: AvailableTranslationEntry): string {
  if (entry.code === 'KJV') return 'Included with Worship Studio'
  if (entry.code === 'ESV') return 'Connected through the ESV API'
  return 'Connected through api.bible'
}
</script>

<template>
  <div v-if="librarySettings && machineSettings" class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections">
      <header class="settings-nav-header">
        <span>Configure</span>
        <strong>Worship Studio</strong>
      </header>
      <section v-for="group in groupedSections" :key="group.name" class="settings-nav-group">
        <div class="settings-nav-group-heading">
          <span>{{ group.name }}</span>
          <small>{{ group.items.length }}</small>
        </div>
        <v-list density="compact" nav class="settings-nav-list">
          <v-list-item
            v-for="section in group.items"
            :key="section.key"
            :active="activeSection === section.key"
            rounded="md"
            class="settings-nav-item"
            @click="selectSettingsSection(section.key)"
          >
            <template #prepend>
              <v-icon :icon="sectionIcons[section.key]" size="18" />
            </template>
            {{ section.label }}
          </v-list-item>
        </v-list>
      </section>
    </nav>

    <div class="settings-content">
      <SettingsPageHeader
        :eyebrow="activeSectionInfo.group"
        :title="activeSectionInfo.label"
        :description="activeSectionInfo.description"
        :icon="activeSectionInfo.icon"
      />

      <template v-if="activeSection === 'general'">
        <SettingsPanel
          title="Workstation identity"
          description="Used to distinguish this computer when synchronized files conflict."
          icon="mdi-laptop"
        >
          <v-text-field
            v-model="machineSettings.thisComputerName"
            label="Computer name"
            variant="outlined"
            density="comfortable"
            hide-details
            class="settings-form-field"
          />
        </SettingsPanel>
        <SettingsPanel
          title="Guided setup"
          description="Review the initial library, display, and service configuration."
          icon="mdi-magic-staff"
        >
          <v-btn
            variant="outlined"
            color="primary"
            prepend-icon="mdi-magic-staff"
            @click="runSetupWizard"
          >
            Run Setup Wizard
          </v-btn>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'sync'">
        <SettingsPanel
          title="Library folder"
          description="The shared location containing services, songs, people, themes, and settings."
          icon="mdi-folder-sync-outline"
        >
          <div class="path-setting">
            <v-text-field
              v-model="machineSettings.libraryPath"
              label="Library path"
              placeholder="C:\\WorshipStudio\\Library or ./Library"
              variant="outlined"
              density="comfortable"
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
              </v-btn>
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Sync health"
          description="Folder access, Dropbox availability, and conflicted-copy files."
          icon="mdi-cloud-check-outline"
        >
          <template #action>
            <v-btn variant="text" size="small" :loading="refreshingSync" @click="refreshSyncStatus">
              Check Now
            </v-btn>
          </template>

          <div v-if="syncStore.status" class="status-list">
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
                Dropbox
                {{
                  syncStore.status.syncClientRunning
                    ? 'appears to be running'
                    : "doesn't appear to be running"
                }}
              </span>
            </div>
            <div
              v-if="syncStore.status.lastLibraryChangeAt"
              class="text-caption text-medium-emphasis mb-4"
            >
              Last library change:
              {{ new Date(syncStore.status.lastLibraryChangeAt).toLocaleString() }}
            </div>

            <v-btn
              v-if="syncStore.status.conflictCount > 0"
              variant="flat"
              color="warning"
              prepend-icon="mdi-alert"
              to="/sync-conflicts"
            >
              Resolve {{ syncStore.status.conflictCount }} Conflict{{
                syncStore.status.conflictCount === 1 ? '' : 's'
              }}
            </v-btn>
            <p v-else class="text-medium-emphasis text-body-2">No sync conflicts right now.</p>
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Data tools"
          description="Demo and maintenance actions for the selected library folder."
          icon="mdi-database-cog-outline"
          tone="danger"
        >
          <div class="d-flex flex-wrap ga-2">
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
          <div v-if="dataCleared" class="text-caption text-medium-emphasis mt-2">
            All songs, services, people, and themes have been deleted.
          </div>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'appearance'">
        <SettingsPanel
          title="Operator interface"
          description="Choose how Worship Studio looks on this computer."
          icon="mdi-theme-light-dark"
        >
          <div class="settings-toggle-row">
            <div>
              <strong>Dark mode</strong>
              <p>Use a darker interface that is easier on the eyes in the booth.</p>
            </div>
            <v-switch v-model="darkMode" color="primary" hide-details aria-label="Dark mode" />
          </div>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'branding'">
        <SettingsPanel
          title="Church identity"
          description="The name used on reports, bulletins, and exported documents."
          icon="mdi-church-outline"
        >
          <v-text-field
            v-model="librarySettings.branding.churchName"
            label="Church or ministry name"
            placeholder="First Community Church"
            variant="outlined"
            density="comfortable"
            hide-details
            class="branding-name-field"
          />
        </SettingsPanel>

        <SettingsPanel
          title="Logo"
          description="Choose a synced image so the logo is available on every computer using this library."
          icon="mdi-image-outline"
        >
          <div class="branding-logo-layout">
            <div class="branding-logo-preview">
              <v-progress-circular
                v-if="brandingLogoLoading"
                indeterminate
                color="primary"
                size="28"
              />
              <img
                v-else-if="brandingLogoPreviewUrl"
                :src="brandingLogoPreviewUrl"
                :alt="`${librarySettings.branding.churchName || 'Church'} logo`"
              />
              <template v-else>
                <v-icon icon="mdi-image-outline" size="31" />
                <span>{{
                  librarySettings.branding.logoMediaId
                    ? 'Logo preview unavailable'
                    : 'No logo selected'
                }}</span>
              </template>
            </div>
            <div class="branding-logo-copy">
              <strong>Church logo</strong>
              <p>
                A transparent PNG works best. The original image remains in the Media Library and
                can be reused elsewhere.
              </p>
              <div>
                <v-btn
                  variant="flat"
                  color="primary"
                  prepend-icon="mdi-image-search-outline"
                  @click="brandingLogoPickerOpen = true"
                >
                  {{ librarySettings.branding.logoMediaId ? 'Change Logo' : 'Choose Logo' }}
                </v-btn>
                <v-btn
                  v-if="librarySettings.branding.logoMediaId"
                  variant="text"
                  color="error"
                  prepend-icon="mdi-close"
                  @click="removeBrandingLogo"
                >
                  Remove Logo
                </v-btn>
              </div>
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Brand colors"
          description="Reusable colors for report accents and audience themes."
          icon="mdi-palette-outline"
        >
          <div class="branding-color-grid">
            <label class="branding-color-field">
              <span>Primary color</span>
              <div>
                <input
                  type="color"
                  :value="librarySettings.branding.primaryColor"
                  aria-label="Choose primary brand color"
                  @input="setBrandingColor('primaryColor', $event)"
                />
                <v-text-field
                  v-model="librarySettings.branding.primaryColor"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </div>
              <small>Headings and primary accents</small>
            </label>
            <label class="branding-color-field">
              <span>Secondary color</span>
              <div>
                <input
                  type="color"
                  :value="librarySettings.branding.secondaryColor"
                  aria-label="Choose secondary brand color"
                  @input="setBrandingColor('secondaryColor', $event)"
                />
                <v-text-field
                  v-model="librarySettings.branding.secondaryColor"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </div>
              <small>Highlights and supporting accents</small>
            </label>
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Preview"
          description="A simplified example of how the identity appears on generated documents."
          icon="mdi-file-eye-outline"
        >
          <div
            class="branding-document-preview"
            :style="{
              '--preview-primary': librarySettings.branding.primaryColor,
              '--preview-secondary': librarySettings.branding.secondaryColor,
            }"
          >
            <header>
              <span class="branding-preview-logo">
                <img v-if="brandingLogoPreviewUrl" :src="brandingLogoPreviewUrl" alt="" />
                <v-icon v-else icon="mdi-church-outline" size="22" />
              </span>
              <div>
                <small>Worship Planning Report</small>
                <strong>{{ librarySettings.branding.churchName || 'Your Church Name' }}</strong>
              </div>
            </header>
            <div class="branding-preview-rule" />
            <section>
              <span />
              <span />
              <span />
            </section>
          </div>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'about'">
        <div class="about-card">
          <img :src="aboutLogo" alt="Worship Studio" class="about-logo" />
          <div class="about-version">Version {{ appVersion || '…' }}</div>
          <p class="about-description">
            Worship planning and presentation software built for calm, confident operation during a
            service.
          </p>

          <div class="about-links">
            <button
              v-for="link in projectLinks"
              :key="link.url"
              type="button"
              class="about-link"
              @click="openProjectLink(link.url)"
            >
              <span class="about-link-icon"><v-icon :icon="link.icon" size="20" /></span>
              <span class="about-link-copy">
                <strong>{{ link.label }}</strong>
                <small>{{ link.description }}</small>
              </span>
              <v-icon icon="mdi-open-in-new" size="16" class="about-link-arrow" />
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="activeSection === 'display'">
        <SettingsPanel
          title="Connected displays"
          description="Assign what each monitor shows. Changes take effect immediately."
          icon="mdi-monitor-multiple"
        >
          <template #action>
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-refresh"
              :loading="loadingDisplays"
              @click="loadDisplays"
            >
              Refresh
            </v-btn>
          </template>
          <v-alert
            v-if="needsSingleMonitorFallback(displays)"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            Only one display detected. You can plan services and use 16:9 previews on this computer,
            but presenting requires a separate audience display in extended-desktop mode.
          </v-alert>
          <div v-if="displays.length === 0" class="settings-empty">
            <v-icon icon="mdi-monitor-off" size="28" />
            <span>No displays detected.</span>
          </div>
          <div v-for="display in displays" :key="display.id" class="display-setting-row">
            <div class="display-setting-copy">
              <strong>{{ display.name }}</strong>
              <span>{{ display.resolution }}</span>
            </div>
            <v-select
              :model-value="display.role"
              :items="roleOptions"
              label="Role"
              variant="outlined"
              density="compact"
              hide-details
              :disabled="needsSingleMonitorFallback(displays)"
              @update:model-value="(role: DisplayRole) => assignRole(display.id, role)"
            />
            <v-btn variant="outlined" color="secondary" @click="identifyDisplay(display.id)">
              Identify
            </v-btn>
          </div>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'external-apps'">
        <SettingsPanel
          title="App profiles"
          description="Define how presentation files open and how Worship Studio controls their windows."
          icon="mdi-application-cog-outline"
        >
          <template #action>
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              @click="openNewExternalAppProfile"
            >
              Add Profile
            </v-btn>
          </template>
          <v-list v-if="externalAppProfiles.length > 0" density="comfortable" class="settings-list">
            <v-list-item
              v-for="profile in externalAppProfiles"
              :key="profile.id"
              rounded="lg"
              class="mb-1"
              border
            >
              <template #prepend>
                <v-icon icon="mdi-application-outline" class="mr-3" />
              </template>
              <v-list-item-title class="font-weight-bold">{{
                profile.name || '(Unnamed)'
              }}</v-list-item-title>
              <v-list-item-subtitle>
                {{
                  profile.launchMode === 'already-running'
                    ? 'Already Running'
                    : 'Launch Automatically'
                }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  icon="mdi-pencil-outline"
                  variant="text"
                  size="small"
                  @click.stop="openEditExternalAppProfile(profile)"
                />
                <v-btn
                  icon="mdi-trash-can-outline"
                  variant="text"
                  size="small"
                  color="error"
                  @click.stop="deleteExternalAppProfile(profile)"
                />
              </template>
            </v-list-item>
          </v-list>
          <div v-else class="settings-empty">
            <v-icon icon="mdi-application-outline" size="28" />
            <span>No external app profiles configured yet.</span>
          </div>
        </SettingsPanel>

        <v-dialog v-model="profileDialogOpen" max-width="640">
          <v-card v-if="editingProfile">
            <v-card-title
              >External App Profile{{
                editingProfile.name ? ` — ${editingProfile.name}` : ''
              }}</v-card-title
            >
            <v-card-text>
              <v-text-field
                v-model="editingProfile.name"
                label="Name"
                variant="outlined"
                density="comfortable"
                class="mb-4"
              />

              <div class="text-caption text-medium-emphasis font-weight-bold text-uppercase mb-2">
                Launch Mode
              </div>
              <v-btn-toggle
                v-model="editingProfile.launchMode"
                mandatory
                density="comfortable"
                class="mb-4 d-flex"
                style="width: 100%"
              >
                <v-btn
                  v-for="option in launchModeOptions"
                  :key="option.value"
                  :value="option.value"
                  class="flex-grow-1"
                  style="height: auto"
                >
                  <div class="text-left py-1">
                    <div class="text-body-2 font-weight-bold">{{ option.title }}</div>
                    <div class="text-caption text-medium-emphasis" style="white-space: normal">
                      {{ option.hint }}
                    </div>
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
                  Will run:
                  {{
                    previewExternalAppCommand(
                      editingProfile.executablePath,
                      editingProfile.parameterFormat,
                    )
                  }}
                </div>

                <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
                  Worship Studio checks the executable and chosen file both exist when this item is
                  added to a service — not just when the slide is reached — so a missing file is
                  caught during prep, not mid-service.
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
                <span v-if="!isEditingSavedProfile" class="text-caption text-medium-emphasis ml-2"
                  >Save this profile first</span
                >
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
                    Let Next/Prev and the remote control also drive this app, if it supports simple
                    commands
                  </div>
                </div>
                <v-switch
                  v-model="editingProfile.remoteControlsEnabled"
                  color="primary"
                  hide-details
                />
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
                  Sent as a keystroke to the app's window when Next/Prev is pressed while this item
                  is live. Leave blank if the app doesn't support this.
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
              <v-btn variant="flat" color="primary" @click="saveExternalAppProfile"
                >Save Profile</v-btn
              >
            </v-card-actions>
          </v-card>
        </v-dialog>
      </template>

      <template v-else-if="activeSection === 'remote-control'">
        <SettingsPanel
          title="Connection"
          description="How phones and tablets find this Worship Studio installation on the local network."
          icon="mdi-lan-connect"
        >
          <div class="remote-connection-summary">
            <span class="remote-connection-summary-icon">
              <v-icon icon="mdi-access-point-network" size="20" />
            </span>
            <div>
              <span>Active address</span>
              <strong>
                {{ remoteServerInfo?.hostname ?? remoteServerInfo?.lanIp ?? 'Starting…' }}:{{
                  remoteServerInfo?.port ?? '…'
                }}
              </strong>
              <small v-if="remoteServerInfo?.lanIp">
                Also available at {{ remoteServerInfo.lanIp }}:{{ remoteServerInfo.port }}
              </small>
            </div>
            <v-chip
              :color="remoteServerInfo ? 'success' : undefined"
              variant="tonal"
              size="small"
              :prepend-icon="remoteServerInfo ? 'mdi-check-circle-outline' : 'mdi-timer-sand'"
            >
              {{ remoteServerInfo ? 'Available' : 'Starting' }}
            </v-chip>
          </div>

          <div class="remote-connection-options">
            <div class="remote-setting-row">
              <div class="remote-setting-copy">
                <strong>Local hostname</strong>
                <span>
                  Leave automatic for an installation-specific name. Use “worshipstudio” for the
                  primary booth.
                </span>
              </div>
              <v-text-field
                v-model="remoteHostnameOverride"
                label="Hostname"
                placeholder="Automatic"
                suffix=".local"
                variant="outlined"
                density="comfortable"
                clearable
                maxlength="63"
                hide-details
              />
            </div>

            <div class="remote-setting-row">
              <div class="remote-setting-copy">
                <strong>Port</strong>
                <span>
                  Automatic remembers an available port. Set a specific port only when required by
                  the network.
                </span>
              </div>
              <v-number-input
                v-model="remotePortOverride"
                label="Port"
                placeholder="Automatic"
                variant="outlined"
                density="comfortable"
                control-variant="stacked"
                :min="1024"
                :max="65535"
                clearable
                hide-details
              />
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Paired devices"
          description="Phones and tablets authorized to view or control the current presentation."
          icon="mdi-cellphone-link"
        >
          <template #action>
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              :disabled="remotePersonOptions.length === 0"
              @click="openProvisionDialog"
            >
              Pair a Device
            </v-btn>
          </template>
          <v-alert
            v-if="remoteServerInfo && !remoteServerInfo.lanIp"
            type="warning"
            variant="tonal"
            class="mb-4"
          >
            Couldn't detect a network address for this computer — check that it's connected to the
            church's network, then reopen this screen.
          </v-alert>
          <v-alert
            v-if="remotePersonOptions.length === 0"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            Add a person before pairing a Remote Control device.
          </v-alert>
          <v-list v-if="remoteDevices.length > 0" density="comfortable" class="settings-list">
            <v-list-item
              v-for="device in remoteDevices"
              :key="device.id"
              rounded="lg"
              class="mb-1"
              border
            >
              <template #prepend><v-icon icon="mdi-cellphone" class="mr-3" /></template>
              <v-list-item-title class="font-weight-bold">{{ device.name }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ remoteDeviceOwner(device) }} · {{ accessLevelLabel(device.accessLevel) }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  icon="mdi-qrcode-scan"
                  variant="text"
                  size="small"
                  :loading="repairingDeviceId === device.id"
                  :disabled="!device.personId"
                  aria-label="Re-pair device"
                  @click.stop="repairRemoteDevice(device)"
                />
                <v-btn
                  icon="mdi-trash-can-outline"
                  variant="text"
                  size="small"
                  color="error"
                  @click.stop="revokeRemoteDevice(device)"
                />
              </template>
            </v-list-item>
          </v-list>
          <div v-else class="settings-empty">
            <v-icon icon="mdi-cellphone-off" size="28" />
            <span>No devices paired yet.</span>
          </div>
        </SettingsPanel>

        <v-dialog v-model="provisionDialogOpen" max-width="480">
          <v-card>
            <v-card-title>Pair a Device</v-card-title>
            <v-card-text>
              <template v-if="!provisionResult">
                <v-select
                  v-model="newDevicePersonId"
                  :items="remotePersonOptions"
                  label="Person"
                  placeholder="Choose the device owner"
                  variant="outlined"
                  density="comfortable"
                  class="mb-2"
                />
                <v-text-field
                  v-model="newDeviceName"
                  label="Device Name"
                  placeholder="e.g. iPhone or Booth Tablet"
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
                  <div>
                    <strong>View Only</strong> — mirrors the presentation screen, no controls.
                  </div>
                  <div><strong>Advance Only</strong> — mirror plus Previous/Next.</div>
                  <div>
                    <strong>Full Control</strong> — mirror, Previous/Next, and Start/Stop
                    Presenting.
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="text-center mb-3">
                  <img
                    :src="provisionResult.qrDataUrl"
                    alt="Pairing QR code"
                    style="width: 220px; height: 220px"
                  />
                </div>
                <p class="text-body-2 text-center mb-2">
                  Scan this with "{{ newDeviceName }}"'s camera, or open this link on it directly:
                </p>
                <p
                  class="text-caption text-medium-emphasis text-center"
                  style="word-break: break-all"
                >
                  {{ provisionResult.pairingUrl }}
                </p>
              </template>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <template v-if="!provisionResult">
                <v-btn variant="text" @click="provisionDialogOpen = false">Cancel</v-btn>
                <v-btn
                  variant="flat"
                  color="primary"
                  :loading="provisioning"
                  :disabled="!newDevicePersonId || !newDeviceName.trim()"
                  @click="provisionDevice"
                >
                  Generate QR Code
                </v-btn>
              </template>
              <v-btn v-else variant="flat" color="primary" @click="provisionDialogOpen = false"
                >Done</v-btn
              >
            </v-card-actions>
          </v-card>
        </v-dialog>
      </template>

      <template v-else-if="activeSection === 'service-types'">
        <SettingsPanel
          title="Available service types"
          description="These choices appear when creating a service and assigning template defaults."
          icon="mdi-calendar-multiple"
        >
          <ManagedStringList
            v-model="librarySettings.serviceTypes"
            add-label="Add a service type…"
          />
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'collections'">
        <SettingsPanel
          title="Available collections"
          description="Songbooks and catalogs a song can belong to, each with its own number."
          icon="mdi-bookshelf"
        >
          <ManagedStringList v-model="librarySettings.collections" add-label="Add a collection…" />
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'bible-translations'">
        <SettingsPanel
          title="English Standard Version"
          description="Connect an api.esv.org account to make the ESV available on this computer."
          icon="mdi-key-outline"
        >
          <v-text-field
            v-model="machineSettings.esvApiKey"
            label="ESV API key"
            type="password"
            variant="outlined"
            density="compact"
            autocomplete="off"
            hint="Free account at api.esv.org."
            persistent-hint
            class="settings-form-field mb-3"
          />
          <v-alert v-if="esvAvailable" type="success" variant="tonal" density="compact">
            {{ ESV_COPYRIGHT_NOTICE }}
          </v-alert>
          <v-alert
            v-else-if="machineSettings.esvApiKey"
            type="warning"
            variant="tonal"
            density="compact"
          >
            Save Settings to verify this key.
          </v-alert>
          <p v-else class="settings-muted">Not configured on this machine.</p>
        </SettingsPanel>

        <SettingsPanel
          title="Additional Bible editions"
          description="Use api.bible to add NIV and other licensed translations to the library."
          icon="mdi-book-plus-outline"
        >
          <v-text-field
            v-model="machineSettings.apiBibleKey"
            label="api.bible API key"
            type="password"
            variant="outlined"
            density="compact"
            autocomplete="off"
            hint="Free account at scripture.api.bible."
            persistent-hint
            class="settings-form-field mb-3"
          />
          <div v-if="machineSettings.apiBibleKey">
            <div class="translation-picker">
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
                hide-details
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
            <p v-if="addTranslationError" class="text-caption text-error mt-2">
              {{ addTranslationError }}
            </p>
          </div>
          <p v-else class="settings-muted">Not configured on this machine.</p>
        </SettingsPanel>

        <SettingsPanel
          title="Available translations"
          description="Choose the default used for new passages. Operators can still switch translations live."
          icon="mdi-book-open-page-variant-outline"
        >
          <div class="translation-grid" role="radiogroup" aria-label="Default Bible translation">
            <article
              v-for="entry in availableTranslationEntries"
              :key="entry.code"
              class="translation-card"
              :class="{
                'translation-card--selected': librarySettings.defaultTranslationCode === entry.code,
              }"
              role="radio"
              :aria-checked="librarySettings.defaultTranslationCode === entry.code"
              tabindex="0"
              @click="librarySettings.defaultTranslationCode = entry.code"
              @keydown.enter="librarySettings.defaultTranslationCode = entry.code"
              @keydown.space.prevent="librarySettings.defaultTranslationCode = entry.code"
            >
              <header>
                <span class="translation-code">{{ entry.code }}</span>
                <v-icon
                  v-if="librarySettings.defaultTranslationCode === entry.code"
                  icon="mdi-check-circle"
                  color="primary"
                  size="19"
                />
              </header>
              <h3>{{ entry.name }}</h3>
              <p>{{ translationSource(entry) }}</p>
              <footer>
                <span v-if="entry.needsKey" class="translation-warning">
                  <v-icon icon="mdi-alert-circle-outline" size="15" /> API key needed
                </span>
                <span
                  v-else-if="librarySettings.defaultTranslationCode === entry.code"
                  class="translation-default"
                >
                  <v-icon icon="mdi-check-circle" size="15" /> Default
                </span>
                <span v-else class="translation-available">Available</span>
                <span class="translation-card-actions">
                  <span
                    v-if="librarySettings.defaultTranslationCode !== entry.code"
                    class="translation-set-default"
                    >Make default</span
                  >
                  <v-btn
                    v-if="entry.removable"
                    icon="mdi-delete-outline"
                    variant="text"
                    color="error"
                    size="small"
                    class="translation-remove"
                    :aria-label="`Remove ${entry.name}`"
                    @click.stop="removeApiBibleTranslation(entry.code)"
                  />
                </span>
              </footer>
            </article>
          </div>
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'canva'">
        <SettingsPanel
          title="Connection credentials"
          description="Credentials stay on this computer and never sync. Canva tools appear after both values are saved."
          icon="mdi-connection"
        >
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
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
            class="settings-form-field mb-2"
          />
          <v-text-field
            v-model="machineSettings.canvaClientSecret"
            label="Canva client secret"
            type="password"
            variant="outlined"
            density="compact"
            autocomplete="off"
            class="settings-form-field"
            hint="Stored only in this machine's app-data settings."
            persistent-hint
          />
        </SettingsPanel>
      </template>

      <template v-else-if="activeSection === 'font-sizes'">
        <SettingsPanel
          title="Scripture"
          description="Text auto-fits within this range. Content that still does not fit at the minimum splits at verse boundaries."
          icon="mdi-book-open-variant"
        >
          <div class="number-field-grid">
            <v-text-field
              v-model.number="librarySettings.scriptureMinFontSizePx"
              label="Minimum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
            <v-text-field
              v-model.number="librarySettings.scriptureMaxFontSizePx"
              label="Maximum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Song lyrics"
          description="Each song part stays on one slide. Lines wrap only when needed and never break mid-word."
          icon="mdi-music-note-outline"
        >
          <div class="number-field-grid">
            <v-text-field
              v-model.number="librarySettings.songMinFontSizePx"
              label="Minimum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
            <v-text-field
              v-model.number="librarySettings.songMaxFontSizePx"
              label="Maximum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Header and footer"
          description="Fixed sizes for references and translation labels surrounding slide content."
          icon="mdi-page-layout-header-footer"
        >
          <div class="number-field-grid">
            <v-text-field
              v-model.number="librarySettings.slideHeaderFontSizePx"
              label="Header size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
            <v-text-field
              v-model.number="librarySettings.slideFooterFontSizePx"
              label="Footer size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="Wayfinding display"
          description="Controls the surrounding book names and centered reference. Large values can overflow long references."
          icon="mdi-sign-direction"
        >
          <div class="number-field-grid">
            <v-text-field
              v-model.number="librarySettings.wayfindingMinFontSizePx"
              label="Minimum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
            <v-text-field
              v-model.number="librarySettings.wayfindingMaxFontSizePx"
              label="Maximum size (px)"
              type="number"
              variant="outlined"
              density="compact"
              min="1"
              hide-details
            />
          </div>
        </SettingsPanel>
      </template>
    </div>
    <MediaPickerDialog
      v-model="brandingLogoPickerOpen"
      purpose="logo"
      @select="selectBrandingLogo"
    />
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  align-items: start;
  min-height: calc(100vh - 49px);
  background: rgba(var(--v-theme-background), 0.34);
}
.settings-nav {
  position: sticky;
  top: 49px;
  height: calc(100vh - 49px);
  overflow-y: auto;
  padding: 18px 14px 28px;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-surface), 0.72);
  scrollbar-width: thin;
}
.settings-nav-header {
  display: flex;
  flex-direction: column;
  margin: 0 8px 21px;
  padding: 5px 5px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.settings-nav-header span {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.settings-nav-header strong {
  margin-top: 2px;
  font-size: 0.91rem;
  font-weight: 720;
  letter-spacing: -0.01em;
}
.settings-nav-group + .settings-nav-group {
  margin-top: 17px;
}
.settings-nav-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 9px 5px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.61rem;
  font-weight: 720;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.settings-nav-group-heading small {
  display: grid;
  min-width: 19px;
  height: 19px;
  place-items: center;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  font-size: 0.57rem;
  letter-spacing: 0;
}
.settings-nav-list {
  padding: 0;
  background: transparent;
}
.settings-nav-item {
  min-height: 37px;
  margin-bottom: 2px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 560;
}
.settings-nav-item :deep(.v-list-item__prepend) {
  margin-inline-end: 10px;
  color: rgba(var(--v-theme-on-surface), 0.46);
}
.settings-nav-item.v-list-item--active {
  color: rgb(var(--v-theme-primary));
  font-weight: 680;
}
.settings-nav-item.v-list-item--active :deep(.v-list-item__overlay) {
  opacity: 0.09;
}
.settings-nav-item.v-list-item--active :deep(.v-list-item__prepend) {
  color: rgb(var(--v-theme-primary));
}
.settings-content {
  padding: 24px 30px 52px;
  width: 100%;
  max-width: 900px;
}
.settings-content--wide {
  max-width: 1240px;
}
.settings-toggle-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}
.settings-toggle-row strong,
.display-setting-copy strong,
.translation-row-copy strong {
  display: block;
  font-size: 0.82rem;
}
.settings-toggle-row p,
.display-setting-copy span,
.translation-row-copy span,
.settings-muted {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
  line-height: 1.45;
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
.status-list {
  max-width: 620px;
}
.remote-connection-summary {
  display: grid;
  max-width: 700px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.045);
}
.remote-connection-summary-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.remote-connection-summary > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.remote-connection-summary span,
.remote-connection-summary small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.65rem;
}
.remote-connection-summary strong {
  overflow: hidden;
  margin: 1px 0;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remote-connection-options {
  max-width: 700px;
  margin-top: 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.remote-setting-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(230px, 280px);
  align-items: center;
  gap: 24px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.remote-setting-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.remote-setting-copy strong {
  display: block;
  font-size: 0.78rem;
}
.remote-setting-copy span {
  display: block;
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  line-height: 1.45;
}
.settings-list {
  max-width: 680px;
  padding: 0;
  background: transparent;
}
.settings-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 92px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 9px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.73rem;
}
.display-setting-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 220px auto;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.display-setting-row:last-child {
  border-bottom: 0;
}
.display-setting-copy,
.translation-row-copy {
  min-width: 0;
}
.settings-form-field {
  max-width: 520px;
}
.translation-picker {
  display: grid;
  grid-template-columns: minmax(0, 420px) auto;
  align-items: center;
  gap: 12px;
}
.translation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 11px;
}
.translation-card {
  display: flex;
  min-height: 154px;
  flex-direction: column;
  padding: 15px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.2);
  cursor: pointer;
  outline: none;
  transition: 0.15s ease;
}
.translation-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.06);
}
.translation-card:focus-visible {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.45);
}
.translation-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.065);
}
.translation-card header,
.translation-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.translation-code {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-size: 0.64rem;
  font-weight: 750;
  letter-spacing: 0.04em;
}
.translation-card h3 {
  margin: 13px 0 3px;
  font-size: 0.84rem;
  line-height: 1.35;
}
.translation-card > p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
  line-height: 1.4;
}
.translation-card footer {
  min-height: 28px;
  margin-top: auto;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 0.66rem;
}
.translation-default,
.translation-warning {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
}
.translation-default,
.translation-set-default {
  color: rgb(var(--v-theme-primary));
}
.translation-warning {
  color: rgb(var(--v-theme-warning));
}
.translation-available {
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.translation-set-default {
  font-weight: 650;
}
.translation-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.translation-remove {
  margin: -6px -7px -6px 0;
}
.number-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 190px));
  gap: 12px;
}
.param-preview {
  font-family: monospace;
  font-size: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.branding-name-field {
  max-width: 560px;
}
.branding-logo-layout {
  display: grid;
  max-width: 760px;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: center;
  gap: 22px;
}
.branding-logo-preview {
  display: flex;
  min-height: 132px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  overflow: hidden;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.3);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.branding-logo-preview img {
  width: 100%;
  height: 104px;
  object-fit: contain;
}
.branding-logo-preview span {
  font-size: 0.68rem;
}
.branding-logo-copy strong {
  font-size: 0.79rem;
}
.branding-logo-copy p {
  max-width: 470px;
  margin: 5px 0 14px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.71rem;
  line-height: 1.5;
}
.branding-logo-copy > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.branding-color-grid {
  display: grid;
  max-width: 620px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.branding-color-field > span {
  display: block;
  margin-bottom: 7px;
  font-size: 0.73rem;
  font-weight: 700;
}
.branding-color-field > div {
  display: grid;
  grid-template-columns: 45px minmax(0, 1fr);
  gap: 8px;
}
.branding-color-field input {
  width: 45px;
  height: 40px;
  padding: 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.branding-color-field small {
  display: block;
  margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.68rem;
}
.branding-document-preview {
  max-width: 620px;
  padding: 22px 24px 25px;
  overflow: hidden;
  border: 1px solid #dfe3e8;
  border-radius: 10px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
}
.branding-document-preview header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.branding-preview-logo {
  display: grid;
  width: 45px;
  height: 45px;
  place-items: center;
  overflow: hidden;
  border-radius: 9px;
  background: color-mix(in srgb, var(--preview-primary) 12%, transparent);
  color: var(--preview-primary);
}
.branding-preview-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.branding-document-preview header small,
.branding-document-preview header strong {
  display: block;
}
.branding-document-preview header small {
  color: #667085;
  font-size: 0.64rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.branding-document-preview header strong {
  margin-top: 2px;
  color: var(--preview-primary);
  font-size: 0.9rem;
}
.branding-preview-rule {
  height: 3px;
  margin: 17px 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--preview-primary), var(--preview-secondary));
}
.branding-document-preview section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.branding-document-preview section span {
  width: 86%;
  height: 7px;
  border-radius: 999px;
  background: #e5e9ef;
}
.branding-document-preview section span:nth-child(2) {
  width: 68%;
}
.branding-document-preview section span:nth-child(3) {
  width: 76%;
}
.about-card {
  max-width: 600px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.72);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.12);
}
.about-logo {
  display: block;
  width: min(360px, calc(100% - 64px));
  height: auto;
  margin: 38px auto 14px;
}
.about-version {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: center;
  text-transform: uppercase;
}
.about-description {
  max-width: 460px;
  margin: 16px auto 30px;
  padding: 0 24px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8rem;
  line-height: 1.55;
  text-align: center;
}
.about-links {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.about-link {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 18px;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background-color var(--ws-transition-fast);
}
.about-link:last-child {
  border-bottom: 0;
}
.about-link:hover,
.about-link:focus-visible {
  background: rgba(var(--v-theme-primary), 0.09);
  outline: none;
}
.about-link:focus-visible {
  box-shadow: inset 3px 0 rgb(var(--v-theme-primary));
}
.about-link-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.about-link-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.about-link-copy strong {
  font-size: 0.78rem;
  font-weight: 650;
}
.about-link-copy small {
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.68rem;
}
.about-link-arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 218px minmax(0, 1fr);
  }
  .settings-content {
    padding-inline: 22px;
  }
  .display-setting-row {
    grid-template-columns: minmax(130px, 1fr) 190px;
  }
  .display-setting-row > .v-btn {
    grid-column: 2;
    justify-self: end;
  }
}

@media (max-width: 700px) {
  .settings-layout {
    display: block;
  }
  .settings-nav {
    position: static;
    height: auto;
    max-height: 255px;
    padding: 12px 14px 16px;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
  .settings-nav-header {
    display: none;
  }
  .settings-nav-group + .settings-nav-group {
    margin-top: 11px;
  }
  .settings-content {
    max-width: none;
    padding: 18px 16px 42px;
  }
  .path-setting,
  .translation-picker {
    align-items: stretch;
    grid-template-columns: 1fr;
  }
  .path-setting {
    grid-template-columns: 1fr;
  }
  .remote-setting-row {
    grid-template-columns: 1fr;
    gap: 9px;
  }
  .remote-connection-summary {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .remote-connection-summary > .v-chip {
    display: none;
  }
  .path-setting-actions {
    flex-wrap: wrap;
  }
  .display-setting-row {
    grid-template-columns: 1fr;
  }
  .display-setting-row > .v-btn {
    grid-column: auto;
    justify-self: start;
  }
  .branding-logo-layout,
  .branding-color-grid {
    grid-template-columns: 1fr;
  }
  .branding-logo-preview {
    max-width: 320px;
  }
}

@media (max-width: 460px) {
  .number-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
