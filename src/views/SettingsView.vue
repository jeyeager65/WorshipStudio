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
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import { previewExternalAppCommand } from '@/utils/externalAppPreview'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ManagedStringList from '@/components/settings/ManagedStringList.vue'
import type { DisplayInfo, DisplayRole, ExternalAppProfile, RemoteDevice } from '@/adapters/types'
import type { LibrarySettings } from '@/models/settings'

const store = useSettingsStore()
const router = useRouter()
const { librarySettings, machineSettings } = storeToRefs(store)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()
const syncStore = useSyncStore()
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
  | 'service-types'
  | 'preachers'
  | 'collections'
  | 'bible-translations'
  | 'themes'
  | 'volunteer-roles'
  | 'sync'
  | 'external-apps'
  | 'remote-control'
const activeSection = ref<Section>('general')
const sections: { key: Section; label: string; group: string }[] = [
  { key: 'general', label: 'General', group: 'App' },
  { key: 'sync', label: 'Sync Status', group: 'App' },
  { key: 'display', label: 'Display Setup', group: 'Display' },
  // Windows-only (Win32 window hand-off) — the port is entirely absent on the macOS/demo
  // build, unlike Display Setup which still has something to show (real monitors) in mock.
  ...(getAdapter().externalApps ? [{ key: 'external-apps' as const, label: 'External Apps', group: 'Display' }] : []),
  // Needs the bundled local HTTP server (see adapters/types.ts's RemotePort doc comment) —
  // not meaningful in the static/mock demo build even though the port itself exists there.
  ...(getAdapter().kind === 'tauri' ? [{ key: 'remote-control' as const, label: 'Remote Control', group: 'Display' }] : []),
  { key: 'service-types', label: 'Service Types', group: 'Content Library' },
  { key: 'preachers', label: 'Preachers', group: 'Content Library' },
  { key: 'collections', label: 'Song Collections', group: 'Content Library' },
  { key: 'bible-translations', label: 'Bible Translations', group: 'Content Library' },
  { key: 'themes', label: 'Themes', group: 'Content Library' },
  { key: 'volunteer-roles', label: 'Volunteer Roles', group: 'Content Library' },
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
  // actually resolvable right now (an ESV_API_KEY configured on this machine — see
  // commands::scripture on the Rust side), not whether a matching entry happens to exist in
  // librarySettings.bibleTranslations, which is a separate, unrelated picker-seeding list.
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

// Bible Translations — this list only feeds the translation *picker*; scripture.resolve()
// itself only actually knows KJV (full text, bundled — public domain) and ESV (real API,
// Tauri-only, needs an ESV_API_KEY configured on this machine — see docs/release-process.md),
// not these entries generally. Wiring arbitrary local-file/other-API translations up to the
// picker is a later slice.
const newTranslationCode = ref('')
const newTranslationLabel = ref('')
const newTranslationSource = ref<LibrarySettings['bibleTranslations'][number]['source']>('local-file')
const sourceOptions: { title: string; value: LibrarySettings['bibleTranslations'][number]['source'] }[] = [
  { title: 'ESV API', value: 'api-esv' },
  { title: 'api.bible', value: 'api-bible' },
  { title: 'Local File', value: 'local-file' },
]
function sourceLabel(source: string): string {
  return sourceOptions.find((o) => o.value === source)?.title ?? source
}
// ESV API terms require this exact notice appear somewhere equivalent to a "copyright page"
// (https://api.esv.org/) — shown here once, rather than repeated on every passage/live
// slide, which instead just show the compact "(ESV)" designator via the translation code.
const ESV_COPYRIGHT_NOTICE =
  'Scripture quotations marked (ESV) are from the ESV® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. www.esv.org'
const esvAvailable = ref(false)
function addTranslation() {
  if (!librarySettings.value) return
  const code = newTranslationCode.value.trim().toUpperCase()
  const label = newTranslationLabel.value.trim()
  if (!code || !label || librarySettings.value.bibleTranslations.some((t) => t.code === code)) return
  librarySettings.value.bibleTranslations.push({ code, source: newTranslationSource.value, label })
  if (!librarySettings.value.defaultTranslationCode) librarySettings.value.defaultTranslationCode = code
  newTranslationCode.value = ''
  newTranslationLabel.value = ''
}
function removeTranslation(index: number) {
  if (!librarySettings.value) return
  const [removed] = librarySettings.value.bibleTranslations.splice(index, 1)
  if (!removed) return
  const wasDefault = librarySettings.value.defaultTranslationCode === removed.code
  if (wasDefault) {
    librarySettings.value.defaultTranslationCode = librarySettings.value.bibleTranslations[0]?.code
  }
  undoStore.push(`Removed "${removed.label}"`, () => {
    if (!librarySettings.value) return
    librarySettings.value.bibleTranslations.splice(index, 0, removed)
    if (wasDefault) librarySettings.value.defaultTranslationCode = removed.code
  })
}
</script>

<template>
  <div v-if="librarySettings && machineSettings" class="settings-layout">
    <div class="settings-nav">
      <template v-for="group in groupedSections" :key="group.name">
        <div class="text-overline text-medium-emphasis px-3 pt-3">{{ group.name }}</div>
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

      <template v-else-if="activeSection === 'preachers'">
        <h2 class="text-h6 mb-4">Preachers</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Suggestions for Create Service's Preacher field — typing a name not on this list is still allowed.
        </p>
        <ManagedStringList v-model="librarySettings.preachers" add-label="Add a preacher…" />
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
          Translations offered in the scripture picker. The default is used unless a passage is switched
          to another translation.
        </p>
        <v-radio-group v-model="librarySettings.defaultTranslationCode" hide-details class="mb-4">
          <div
            v-for="(translation, index) in librarySettings.bibleTranslations"
            :key="translation.code"
            class="d-flex align-center ga-3 mb-2"
            style="max-width: 560px"
          >
            <v-radio :value="translation.code" />
            <div class="flex-grow-1">
              <div class="font-weight-bold">{{ translation.label }} ({{ translation.code }})</div>
              <div class="text-caption text-medium-emphasis">{{ sourceLabel(translation.source) }}</div>
            </div>
            <v-btn icon="mdi-trash-can-outline" variant="flat" color="error" size="small" @click="removeTranslation(index)" />
          </div>
        </v-radio-group>
        <p v-if="librarySettings.bibleTranslations.length === 0" class="text-medium-emphasis text-body-2 mb-4">
          None configured yet.
        </p>

        <div class="d-flex flex-wrap align-end ga-3">
          <v-text-field v-model="newTranslationCode" label="Code" variant="outlined" density="compact" style="width: 100px" />
          <v-text-field v-model="newTranslationLabel" label="Name" variant="outlined" density="compact" style="width: 240px" />
          <v-select
            v-model="newTranslationSource"
            :items="sourceOptions"
            label="Source"
            variant="outlined"
            density="compact"
            style="width: 160px"
          />
          <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="addTranslation">Add</v-btn>
        </div>

        <v-alert v-if="esvAvailable" type="info" variant="tonal" density="compact" class="mt-4" style="max-width: 560px">
          {{ ESV_COPYRIGHT_NOTICE }}
        </v-alert>
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

      <template v-else-if="activeSection === 'volunteer-roles'">
        <h2 class="text-h6 mb-4">Volunteer Roles</h2>
        <p class="text-medium-emphasis text-body-2 mb-4">
          The roles offered on each service's Volunteer Roster (Piano, Sound Booth, Greeters, etc.).
        </p>
        <ManagedStringList v-model="librarySettings.volunteerRoles" add-label="Add a role…" />
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
