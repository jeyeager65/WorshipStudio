<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useSongsStore } from '@/stores/songs'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'
import type { DisplayInfo, DisplayRole, ScriptureTranslation } from '@/adapters/types'

const router = useRouter()
const store = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const songsStore = useSongsStore()
const unsavedChanges = useUnsavedChangesStore()
const theme = useTheme()
const adapter = getAdapter()
const isDesktop = adapter.kind === 'tauri'
const welcomeLogo = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

type StepKey = 'welcome' | 'church' | 'device' | 'displays' | 'library' | 'preferences' | 'finish'
interface WizardStep {
  key: StepKey
  label: string
  shortLabel: string
  icon: string
}

/** Which of the two genuinely different first runs this is. The distinction matters because
 *  LibrarySettings is *shared* — a device joining an existing library already has the church name,
 *  brand colours, translation and service types, and must not overwrite them with a blank slate.
 *  See notes/setup-wizard-join-plan.md for the data loss this prevents. */
type SetupMode = 'new' | 'join'
const setupMode = ref<SetupMode>()

const STEP_DEFS: Record<StepKey, WizardStep> = {
  welcome: {
    key: 'welcome',
    label: 'Welcome',
    shortLabel: 'Welcome',
    icon: 'mdi-hand-wave-outline',
  },
  church: {
    key: 'church',
    label: 'Church Identity',
    shortLabel: 'Church',
    icon: 'mdi-church-outline',
  },
  device: { key: 'device', label: 'This Device', shortLabel: 'Device', icon: 'mdi-laptop' },
  displays: {
    key: 'displays',
    label: 'Display Setup',
    shortLabel: 'Displays',
    icon: 'mdi-monitor-multiple',
  },
  library: {
    key: 'library',
    label: 'Library & Import',
    shortLabel: 'Library',
    icon: 'mdi-bookshelf',
  },
  preferences: {
    key: 'preferences',
    label: 'Planning Defaults',
    shortLabel: 'Defaults',
    icon: 'mdi-tune-variant',
  },
  finish: {
    key: 'finish',
    label: 'Ready to Begin',
    shortLabel: 'Finish',
    icon: 'mdi-check-circle-outline',
  },
}

// Join puts the library first so every later step is decided against the real, loaded library
// rather than a guess — and drops Church/Defaults entirely, since those live *in* that library.
// Displays are machine-scoped, so a joining desktop still needs them; the platforms without a
// displays port (web/tablet) drop that step in both modes.
const stepKeys = computed<StepKey[]>(() => {
  const hasDisplays = Boolean(adapter.displays)
  if (setupMode.value === 'join') {
    return [
      'welcome',
      'library',
      ...(hasDisplays ? (['displays'] as const) : []),
      'device',
      'finish',
    ]
  }
  return [
    'welcome',
    'church',
    'device',
    ...(hasDisplays ? (['displays'] as const) : []),
    'library',
    'preferences',
    'finish',
  ]
})
const steps = computed(() => stepKeys.value.map((key) => STEP_DEFS[key]))
const stepIndex = ref(0)
const currentStep = computed(() => steps.value[stepIndex.value]?.key ?? 'welcome')
const currentStepInfo = computed(() => steps.value[stepIndex.value] ?? STEP_DEFS.welcome)
const progress = computed(() => ((stepIndex.value + 1) / steps.value.length) * 100)
const isJoining = computed(() => setupMode.value === 'join')
const loading = ref(true)
const saving = ref(false)
const operationError = ref('')
const validationMessage = ref('')

onMounted(async () => {
  try {
    await Promise.all([store.load(), serviceTypesStore.load()])
    firstServiceType.value = serviceTypesStore.serviceTypes[0]?.name ?? ''
    // The configured folder may *already* be the church's library — the common case when setup is
    // re-run on a machine that was pointed at it long ago. Detecting that here rather than only on
    // pick is what lets Join accept it without making the operator re-choose a folder that is
    // already right, and what makes the wrong-mode warning correct on first render too.
    refreshExistingLibraryInfo()
    await Promise.all([loadDisplays(), loadTranslations()])
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : 'Setup could not be loaded.'
  } finally {
    loading.value = false
  }
})

// Church identity — reports and themes already consume these shared values, so first-run is
// the right time to collect them instead of letting exports quietly say "Worship Studio."
const churchName = computed({
  get: () => store.librarySettings?.branding.churchName ?? '',
  set: (value: string) => {
    if (store.librarySettings) store.librarySettings.branding.churchName = value
  },
})

function setBrandColor(which: 'primaryColor' | 'secondaryColor', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (store.librarySettings) store.librarySettings.branding[which] = value.toUpperCase()
}

// Display Setup — absent where the platform cannot manage physical audience displays.
const displays = ref<DisplayInfo[]>([])
const loadingDisplays = ref(false)
const roleOptions: { title: string; value: DisplayRole }[] = [
  { title: 'Control Screen', value: 'operator' },
  { title: 'Audience Display', value: 'audience' },
  { title: 'Not Used', value: 'not-used' },
]

async function loadDisplays() {
  loadingDisplays.value = true
  try {
    displays.value = (await adapter.displays?.list()) ?? []
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'Displays could not be detected.'
    displays.value = []
  } finally {
    loadingDisplays.value = false
  }
}

async function assignRole(displayId: string, role: DisplayRole) {
  operationError.value = ''
  try {
    await adapter.displays?.assignRole(displayId, role)
    const display = displays.value.find((candidate) => candidate.id === displayId)
    if (display) display.role = role
    // The desktop display port persists immediately, but Finish later saves this loaded
    // MachineSettings object too. Keep both copies aligned so Finish cannot restore stale roles.
    if (store.machineSettings) store.machineSettings.displayRoles[displayId] = role
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'The display role could not be changed.'
  }
}

async function identifyDisplay(displayId: string) {
  operationError.value = ''
  try {
    await adapter.displays?.identify(displayId)
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'The display could not be identified.'
  }
}

// Optional library import. Source selectors deliberately expose only formats that exist today,
// while leaving the interaction ready for additional sources without promising them.
const songImportSource = ref('opensong')
const importingSongs = ref(false)
const importedSongsCount = ref(0)
const pickingLibraryFolder = ref(false)
const importingStockBackgrounds = ref(false)
const stockBackgroundsSummary = ref<{ mediaAdded: number; themesAdded: number }>()

async function importStockBackgrounds() {
  importingStockBackgrounds.value = true
  operationError.value = ''
  try {
    stockBackgroundsSummary.value = await adapter.media.importStockBackgrounds()
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'Stock backgrounds could not be added.'
  } finally {
    importingStockBackgrounds.value = false
  }
}

async function importSongs() {
  importingSongs.value = true
  operationError.value = ''
  try {
    const imported = await songsStore.importFromOpenSong()
    importedSongsCount.value += imported.length
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : 'Songs could not be imported.'
  } finally {
    importingSongs.value = false
  }
}

/** The church name found in the currently configured library folder, when it already holds a real
 *  one. Drives the Join confirmation, the "you may have meant Join" warning in New mode, and
 *  whether Join considers the folder settled. */
const existingLibraryChurchName = ref('')

/** Whether the operator explicitly chose a folder on this run — an intentional act that settles
 *  the question even when the folder turns out to be empty (starting a library somewhere new). */
const libraryFolderChosen = ref(false)

function refreshExistingLibraryInfo() {
  existingLibraryChurchName.value = store.librarySettings?.branding.churchName.trim() ?? ''
}

/** Join needs the folder question settled, but must not demand a *re-pick* of a folder that is
 *  already correct — the usual case when setup is re-run on a machine that has pointed at the
 *  church's library for ages. Plain `libraryPath` cannot answer this: the desktop backend defaults
 *  it to an app-data folder, so it is never empty and "has a path" would wave someone into a blank
 *  local library believing they had joined. A library that already knows its church name is the
 *  signal that the configured folder is the real thing. */
const joinTargetSettled = computed(
  () => libraryFolderChosen.value || Boolean(existingLibraryChurchName.value),
)

async function pickLibraryFolder() {
  pickingLibraryFolder.value = true
  operationError.value = ''
  try {
    const folder = await adapter.settings.pickLibraryFolder()
    if (!folder || !store.machineSettings) return
    store.machineSettings.libraryPath = folder
    libraryFolderChosen.value = true
    // Persist before reloading: the desktop backend resolves library_root() by re-reading machine
    // settings from disk (src-tauri/src/paths.rs), so an in-memory path change alone would reload
    // the *old* library and leave us none the wiser about what the chosen folder actually holds.
    await store.saveMachineOnly()
    await Promise.all([store.load(), serviceTypesStore.load()])
    // Both now describe the newly chosen library rather than whatever the previous root held.
    refreshExistingLibraryInfo()
    firstServiceType.value = serviceTypesStore.serviceTypes[0]?.name ?? ''
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'The library folder could not be selected.'
  } finally {
    pickingLibraryFolder.value = false
  }
}

function usePortableLibraryFolder() {
  if (store.machineSettings) store.machineSettings.libraryPath = './Library'
  existingLibraryChurchName.value = ''
  libraryFolderChosen.value = true
}

function switchToJoining() {
  setupMode.value = 'join'
  // Library is step 2 in Join; the folder is already chosen, so land on what comes after it.
  stepIndex.value = stepKeys.value.indexOf('library')
  validationMessage.value = ''
}

// Machine-scoped, and the `updatedByDevice` stamp on every record this device saves — which is
// what SyncConflictsView shows when two devices disagree. Desktop defaults it to the OS hostname
// (paths.rs), but web and tablet default it to '' (adapters/web/settings.ts), so the devices most
// likely to be *joining* were the ones stamping every edit with nothing.
const computerName = computed({
  get: () => store.machineSettings?.thisComputerName ?? '',
  set: (value: string) => {
    if (store.machineSettings) store.machineSettings.thisComputerName = value
  },
})

// Planning and operator defaults.
const availableTranslations = ref<ScriptureTranslation[]>([])
async function loadTranslations() {
  try {
    availableTranslations.value = await adapter.scripture.listTranslations()
  } catch (error) {
    console.error('Failed to list scripture translations:', error)
    availableTranslations.value = [{ code: 'KJV', name: 'King James Version' }]
  }
}

const defaultTranslation = computed({
  get: () => store.librarySettings?.defaultTranslationCode ?? 'KJV',
  set: (value: string) => {
    if (store.librarySettings) store.librarySettings.defaultTranslationCode = value
  },
})
const darkMode = computed({
  get: () => store.machineSettings?.darkMode ?? true,
  set: (value: boolean) => {
    if (!store.machineSettings) return
    store.machineSettings.darkMode = value
    theme.change(value ? 'worshipDark' : 'worshipLight')
  },
})
const firstServiceType = ref('')

// Service Types have their own store/file with no reorder API, so "shown first when creating a
// service" (CreateServiceView defaults to serviceTypes[0]) is achieved by renaming — swapping
// names with whichever entry currently holds the chosen name, if any — rather than moving items.
async function applyFirstServiceType() {
  const chosen = firstServiceType.value.trim()
  if (!chosen) return
  const types = serviceTypesStore.serviceTypes
  const first = types[0]
  if (!first) {
    await serviceTypesStore.save({ id: `type-${crypto.randomUUID()}`, name: chosen })
    return
  }
  if (first.name === chosen) return
  const existingElsewhere = types.find((type) => type.id !== first.id && type.name === chosen)
  if (existingElsewhere) {
    await serviceTypesStore.save({ ...existingElsewhere, name: first.name })
  }
  await serviceTypesStore.save({ ...first, name: chosen })
}

function validateCurrentStep(): boolean {
  validationMessage.value = ''
  if (currentStep.value === 'welcome' && !setupMode.value) {
    validationMessage.value = 'Choose whether this device starts a new library or joins one.'
    return false
  }
  if (currentStep.value === 'church' && !churchName.value.trim()) {
    validationMessage.value = 'Enter the church or ministry name that should appear on reports.'
    return false
  }
  if (currentStep.value === 'device' && !computerName.value.trim()) {
    validationMessage.value = 'Name this device so its edits can be told apart from other devices.'
    return false
  }
  // Only desktop picks a folder here — the web build already opened one in BootGate, and tablets
  // arrive with a cloud connection rather than a path.
  if (isJoining.value && currentStep.value === 'library' && isDesktop && !joinTargetSettled.value) {
    validationMessage.value =
      'Choose the shared library folder this device should join — the current folder does not contain a library yet.'
    return false
  }
  if (currentStep.value === 'preferences' && !firstServiceType.value.trim()) {
    validationMessage.value = 'Enter at least one service type.'
    return false
  }
  return true
}

async function goNext() {
  if (!validateCurrentStep()) return
  // Join never touches service types — they live in the library this device is joining.
  if (currentStep.value === 'preferences' && !isJoining.value) await applyFirstServiceType()
  if (stepIndex.value < steps.value.length - 1) stepIndex.value++
}

function goBack() {
  validationMessage.value = ''
  if (stepIndex.value > 0) stepIndex.value--
}

function revisitStep(index: number) {
  if (index >= stepIndex.value) return
  validationMessage.value = ''
  stepIndex.value = index
}

async function completeSetup(destination = '/') {
  if (!store.machineSettings || saving.value) return
  saving.value = true
  operationError.value = ''
  try {
    store.machineSettings.hasCompletedSetup = true
    // No mode chosen means Skip, which declined to configure anything — treated like Join, since
    // "write nothing shared" is the safe reading of an explicit refusal to answer.
    if (isJoining.value || !setupMode.value) {
      // The whole point of Join: persist only what belongs to this device. Writing library
      // settings here would overwrite the joined library's real branding, translation, bulletin
      // and font sizes with whatever this device happened to have in memory — the data loss
      // notes/setup-wizard-join-plan.md describes.
      await store.saveMachineOnly()
    } else {
      await applyFirstServiceType()
      await store.save()
    }
    // Wizard completion is an explicit save boundary. Clear the shared editor flag only after
    // persistence succeeds so the route guard never asks to save the settings we just saved.
    unsavedChanges.isDirty = false
    await router.push(destination)
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : 'Setup could not be saved.'
  } finally {
    saving.value = false
  }
}

async function skipSetup() {
  await completeSetup('/')
}
</script>

<template>
  <main class="wizard-page">
    <div v-if="loading" class="wizard-loading">
      <v-progress-circular indeterminate color="primary" size="38" />
      <strong>Preparing setup…</strong>
    </div>

    <section v-else-if="store.machineSettings && store.librarySettings" class="wizard-shell">
      <aside class="wizard-sidebar">
        <div class="wizard-brand">
          <span class="brand-mark"><v-icon icon="mdi-church-outline" size="25" /></span>
          <div><strong>Worship Studio</strong><small>First-time setup</small></div>
        </div>

        <nav aria-label="Setup progress" class="wizard-steps">
          <button
            v-for="(step, index) in steps"
            :key="step.key"
            type="button"
            class="wizard-step"
            :class="{
              'wizard-step--active': index === stepIndex,
              'wizard-step--done': index < stepIndex,
            }"
            :disabled="index >= stepIndex"
            @click="revisitStep(index)"
          >
            <span class="step-marker">
              <v-icon v-if="index < stepIndex" icon="mdi-check" size="17" />
              <span v-else>{{ index + 1 }}</span>
            </span>
            <span class="step-copy"
              ><strong>{{ step.label }}</strong
              ><small>Step {{ index + 1 }}</small></span
            >
          </button>
        </nav>

        <div class="sidebar-note">
          <v-icon icon="mdi-lock-outline" size="18" />
          <p>Your library stays in files you control. Optional services can be connected later.</p>
        </div>
      </aside>

      <div class="wizard-main">
        <header class="mobile-progress">
          <div>
            <span>Step {{ stepIndex + 1 }} of {{ steps.length }}</span
            ><strong>{{ currentStepInfo.shortLabel }}</strong>
          </div>
          <v-progress-linear :model-value="progress" color="primary" height="5" rounded />
        </header>

        <div class="wizard-content">
          <v-alert
            v-if="operationError"
            type="error"
            variant="tonal"
            closable
            class="wizard-alert"
            @click:close="operationError = ''"
            >{{ operationError }}</v-alert
          >
          <v-alert
            v-if="validationMessage"
            type="warning"
            variant="tonal"
            closable
            class="wizard-alert"
            @click:close="validationMessage = ''"
            >{{ validationMessage }}</v-alert
          >

          <section v-if="currentStep === 'welcome'" class="step-panel welcome-panel">
            <img :src="welcomeLogo" alt="Worship Studio" class="welcome-logo" />
            <div class="step-eyebrow">Welcome</div>
            <h1>Set up Worship Studio</h1>
            <p class="step-intro">
              Is this the first computer to use Worship Studio at your church, or is it joining a
              library another device already set up?
            </p>
            <div class="mode-grid">
              <button
                type="button"
                class="mode-card"
                :class="{ 'mode-card--active': setupMode === 'new' }"
                :aria-pressed="setupMode === 'new'"
                @click="setupMode = 'new'"
              >
                <span class="mode-icon"><v-icon icon="mdi-star-outline" size="26" /></span>
                <strong>Set up a new library</strong>
                <p>
                  Nobody has set up Worship Studio yet. You’ll name your church, choose defaults,
                  and pick where the library lives.
                </p>
              </button>
              <button
                type="button"
                class="mode-card"
                :class="{ 'mode-card--active': setupMode === 'join' }"
                :aria-pressed="setupMode === 'join'"
                @click="setupMode = 'join'"
              >
                <span class="mode-icon"><v-icon icon="mdi-folder-sync-outline" size="26" /></span>
                <strong>Join an existing library</strong>
                <p>
                  Another computer already has your songs and services. This device just needs to
                  point at the shared folder and name itself.
                </p>
              </button>
            </div>
            <div class="optional-note">
              <v-icon icon="mdi-information-outline" size="19" /><span
                >Joining keeps the church details, defaults and service types already in that
                library — this device never overwrites them.</span
              >
            </div>
          </section>

          <section v-else-if="currentStep === 'church'" class="step-panel">
            <div class="step-heading">
              <span class="step-icon"><v-icon icon="mdi-church-outline" size="24" /></span>
              <div>
                <div class="step-eyebrow">Church Identity</div>
                <h1>Make the workspace yours</h1>
                <p>
                  These shared details appear on reports and provide reusable colors for themes.
                </p>
              </div>
            </div>
            <div class="form-section">
              <label class="field-label" for="church-name">Church or ministry name</label>
              <v-text-field
                id="church-name"
                v-model="churchName"
                placeholder="First Community Church"
                variant="outlined"
                density="compact"
                hide-details
                autofocus
              />
              <span class="field-help"
                >Used on bulletins, planning reports, and exported documents.</span
              >
            </div>
            <div class="brand-color-grid">
              <label class="color-field">
                <span class="field-label">Primary color</span>
                <span class="color-control"
                  ><input
                    type="color"
                    :value="store.librarySettings.branding.primaryColor"
                    aria-label="Choose primary color"
                    @input="setBrandColor('primaryColor', $event)" /><v-text-field
                    v-model="store.librarySettings.branding.primaryColor"
                    variant="outlined"
                    density="compact"
                    hide-details
                /></span>
                <small>Headings and primary accents</small>
              </label>
              <label class="color-field">
                <span class="field-label">Secondary color</span>
                <span class="color-control"
                  ><input
                    type="color"
                    :value="store.librarySettings.branding.secondaryColor"
                    aria-label="Choose secondary color"
                    @input="setBrandColor('secondaryColor', $event)" /><v-text-field
                    v-model="store.librarySettings.branding.secondaryColor"
                    variant="outlined"
                    density="compact"
                    hide-details
                /></span>
                <small>Highlights and supporting accents</small>
              </label>
            </div>
            <div
              class="brand-preview"
              :style="{
                '--brand-primary': store.librarySettings.branding.primaryColor,
                '--brand-secondary': store.librarySettings.branding.secondaryColor,
              }"
            >
              <span class="preview-mark"><v-icon icon="mdi-church-outline" size="25" /></span>
              <div>
                <small>Report preview</small
                ><strong>{{ churchName.trim() || 'Your Church Name' }}</strong
                ><span>Sunday Worship · Order of Service</span>
              </div>
            </div>
          </section>

          <section v-else-if="currentStep === 'device'" class="step-panel">
            <div class="step-heading">
              <span class="step-icon"><v-icon icon="mdi-laptop" size="24" /></span>
              <div>
                <div class="step-eyebrow">This Device</div>
                <h1>Name this device</h1>
                <p>
                  Settings on this page belong to this device alone — they are never shared with the
                  rest of your church.
                </p>
              </div>
            </div>
            <div class="preference-list">
              <article class="preference-card">
                <span class="preference-icon"><v-icon icon="mdi-tag-outline" size="22" /></span>
                <div>
                  <strong>Device name</strong>
                  <p>
                    Stamped on everything you save here, so you can tell which device made a change
                    when two of them edit the same song or service.
                  </p>
                </div>
                <v-text-field
                  v-model="computerName"
                  label="Device name"
                  placeholder="Booth Laptop"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </article>
              <article class="preference-card">
                <span class="preference-icon"
                  ><v-icon icon="mdi-theme-light-dark" size="22"
                /></span>
                <div>
                  <strong>Dark operator interface</strong>
                  <p>Recommended for reducing glare in a dim booth.</p>
                </div>
                <v-switch
                  v-model="darkMode"
                  color="primary"
                  hide-details
                  aria-label="Use dark operator interface"
                />
              </article>
            </div>
          </section>

          <section v-else-if="currentStep === 'displays'" class="step-panel">
            <div class="step-heading">
              <span class="step-icon"><v-icon icon="mdi-monitor-multiple" size="24" /></span>
              <div>
                <div class="step-eyebrow">Display Setup</div>
                <h1>Choose what each screen shows</h1>
                <p>Use Identify if the monitor names do not match the labels in the room.</p>
              </div>
            </div>
            <v-alert
              v-if="needsSingleMonitorFallback(displays)"
              type="info"
              variant="tonal"
              class="mb-4"
            >
              <div class="d-flex align-center ga-3">
                <span>
                  Only one display is connected. You can finish setup and plan with 16:9 previews,
                  but Start Presenting will remain unavailable until a separate audience display is
                  connected.
                </span>
                <v-btn
                  variant="text"
                  size="small"
                  prepend-icon="mdi-refresh"
                  :loading="loadingDisplays"
                  @click="loadDisplays"
                >
                  Detect Again
                </v-btn>
              </div>
            </v-alert>
            <div v-if="loadingDisplays" class="inline-loading">
              <v-progress-circular indeterminate color="primary" size="26" /><span
                >Detecting displays…</span
              >
            </div>
            <div v-else-if="displays.length === 0" class="step-empty">
              <span><v-icon icon="mdi-monitor-off" size="28" /></span
              ><strong>No displays detected</strong>
              <p>You can continue now and configure displays later in Settings.</p>
              <v-btn variant="outlined" prepend-icon="mdi-refresh" @click="loadDisplays"
                >Detect Again</v-btn
              >
            </div>
            <div v-else class="display-list">
              <article v-for="(display, index) in displays" :key="display.id" class="display-card">
                <span class="display-number">{{ index + 1 }}</span>
                <div class="display-copy">
                  <strong>{{ display.name }}</strong
                  ><span>{{ display.resolution }}</span>
                </div>
                <v-select
                  :model-value="display.role"
                  :items="roleOptions"
                  label="Screen role"
                  variant="outlined"
                  density="compact"
                  hide-details
                  :disabled="needsSingleMonitorFallback(displays)"
                  @update:model-value="(role: DisplayRole) => assignRole(display.id, role)"
                />
                <v-btn
                  variant="outlined"
                  prepend-icon="mdi-monitor-eye"
                  @click="identifyDisplay(display.id)"
                  >Identify</v-btn
                >
              </article>
            </div>
          </section>

          <section v-else-if="currentStep === 'library'" class="step-panel">
            <div class="step-heading">
              <span class="step-icon"><v-icon icon="mdi-bookshelf" size="24" /></span>
              <div>
                <div class="step-eyebrow">
                  {{ isJoining ? 'Shared Library' : 'Library & Import' }}
                </div>
                <h1>
                  {{
                    isJoining
                      ? 'Point at your church’s library'
                      : 'Bring your existing work with you'
                  }}
                </h1>
                <p>
                  {{
                    isJoining
                      ? 'Choose the synced folder the first computer set up. Everything in it stays exactly as it is.'
                      : 'Every option on this page is optional and remains available after setup.'
                  }}
                </p>
              </div>
            </div>

            <v-alert
              v-if="isJoining && existingLibraryChurchName"
              type="success"
              variant="tonal"
              class="mb-4"
            >
              Found the library for <strong>{{ existingLibraryChurchName }}</strong
              >. Its church details, defaults and service types will be used as-is.
            </v-alert>
            <!-- Chosen deliberately, but nothing there to join. Allowed to continue — an operator
                 may be pointing at a folder the cloud client has not finished pulling yet — but
                 never silently, since the likelier cause is the wrong folder. -->
            <v-alert
              v-else-if="isJoining && libraryFolderChosen"
              type="warning"
              variant="tonal"
              class="mb-4"
            >
              This folder does not contain a library yet. If your church's library lives elsewhere,
              choose that folder — otherwise this device will start out empty.
            </v-alert>
            <!-- The safety net for picking the wrong mode: an existing library in what was meant
                 to be a fresh folder. Deliberately a backstop, not the mechanism — a part-pulled
                 cloud folder is ambiguous mid-sync, so the explicit choice still decides. -->
            <v-alert
              v-else-if="!isJoining && existingLibraryChurchName"
              type="warning"
              variant="tonal"
              class="mb-4"
            >
              <p class="mb-2">
                This folder already holds a library for
                <strong>{{ existingLibraryChurchName }}</strong
                >. Finishing as a new library would overwrite its church details and defaults.
              </p>
              <v-btn size="small" color="warning" variant="flat" @click="switchToJoining"
                >Join this library instead</v-btn
              >
            </v-alert>

            <div class="import-list">
              <article v-if="!isJoining" class="import-card">
                <span class="import-icon"><v-icon icon="mdi-music-note-outline" size="23" /></span>
                <div class="import-copy">
                  <strong>Song library</strong>
                  <p>Import lyrics and song metadata from existing files.</p>
                  <span v-if="importedSongsCount" class="success-note"
                    ><v-icon icon="mdi-check-circle" size="16" />{{ importedSongsCount }}
                    {{ importedSongsCount === 1 ? 'song' : 'songs' }} imported</span
                  >
                </div>
                <v-select
                  v-model="songImportSource"
                  :items="[{ title: 'OpenSong XML', value: 'opensong' }]"
                  label="Source"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-btn
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-file-import-outline"
                  :loading="importingSongs"
                  @click="importSongs"
                  >Choose Files</v-btn
                >
              </article>

              <article
                class="import-card"
                :class="{
                  'import-card--disabled': adapter.kind === 'mock' || adapter.kind === 'tablet',
                }"
              >
                <span class="import-icon"><v-icon icon="mdi-folder-sync-outline" size="23" /></span>
                <div class="import-copy">
                  <strong>Shared library folder</strong>
                  <p>
                    {{
                      store.machineSettings.libraryPath ||
                      (isDesktop
                        ? 'Choose a Dropbox, OneDrive, or other synced folder.'
                        : adapter.kind === 'web'
                          ? 'Already using the folder you opened this library from.'
                          : adapter.kind === 'tablet'
                            ? 'Already connected to your Dropbox library — see Settings to manage the connection.'
                            : 'The browser demo uses temporary local data.')
                    }}
                  </p>
                </div>
                <div class="import-actions">
                  <v-btn
                    variant="outlined"
                    prepend-icon="mdi-folder-cog-outline"
                    :loading="pickingLibraryFolder"
                    :disabled="adapter.kind === 'mock' || adapter.kind === 'tablet'"
                    @click="pickLibraryFolder"
                    >{{
                      store.machineSettings.libraryPath ? 'Change Folder' : 'Choose Folder'
                    }}</v-btn
                  >
                  <v-btn
                    variant="tonal"
                    color="primary"
                    prepend-icon="mdi-usb-flash-drive-outline"
                    :disabled="!isDesktop"
                    @click="usePortableLibraryFolder"
                    >Portable</v-btn
                  >
                </div>
              </article>

              <article v-if="!isJoining" class="import-card">
                <span class="import-icon"
                  ><v-icon icon="mdi-image-multiple-outline" size="23"
                /></span>
                <div class="import-copy">
                  <strong>Stock background images</strong>
                  <p>6 royalty-free backgrounds and 2 starter themes, ready to use right away.</p>
                  <span v-if="stockBackgroundsSummary" class="success-note"
                    ><v-icon icon="mdi-check-circle" size="16" />{{
                      stockBackgroundsSummary.mediaAdded
                    }}
                    images, {{ stockBackgroundsSummary.themesAdded }} themes added</span
                  >
                </div>
                <v-btn
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-image-plus-outline"
                  :loading="importingStockBackgrounds"
                  @click="importStockBackgrounds"
                  >Add Stock Backgrounds</v-btn
                >
              </article>
            </div>
          </section>

          <section v-else-if="currentStep === 'preferences'" class="step-panel">
            <div class="step-heading">
              <span class="step-icon"><v-icon icon="mdi-tune-variant" size="24" /></span>
              <div>
                <div class="step-eyebrow">Planning Defaults</div>
                <h1>Start each service with the right choices</h1>
                <p>
                  These are defaults, not restrictions. They can always be changed for an individual
                  service.
                </p>
              </div>
            </div>
            <div class="preference-list">
              <article class="preference-card">
                <span class="preference-icon"><v-icon icon="mdi-book-cross" size="22" /></span>
                <div>
                  <strong>Default Bible translation</strong>
                  <p>Preselected when scripture is added to a service.</p>
                </div>
                <v-select
                  v-model="defaultTranslation"
                  :items="availableTranslations"
                  item-title="name"
                  item-value="code"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </article>
              <article class="preference-card">
                <span class="preference-icon"><v-icon icon="mdi-calendar-star" size="22" /></span>
                <div>
                  <strong>Primary service type</strong>
                  <p>Shown first when creating a service. Enter a new name if needed.</p>
                </div>
                <v-combobox
                  v-model="firstServiceType"
                  :items="serviceTypesStore.serviceTypes.map((type) => type.name)"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </article>
            </div>
          </section>

          <section v-else class="step-panel finish-panel">
            <span class="step-icon step-icon--success"><v-icon icon="mdi-check" size="30" /></span>
            <div class="step-eyebrow">Setup Complete</div>
            <h1>
              {{ churchName.trim() || 'Your church' }} is
              {{ isJoining ? 'connected' : 'ready' }}
            </h1>
            <p class="step-intro">
              {{
                isJoining
                  ? 'This device is pointed at the shared library. Songs, services and settings come from there — nothing on this device changed them.'
                  : 'The essentials are configured. You can create a service now or continue shaping the planning library.'
              }}
            </p>
            <div class="finish-summary">
              <article>
                <v-icon icon="mdi-church-outline" size="19" />
                <div>
                  <small>Church</small><strong>{{ churchName.trim() }}</strong>
                </div>
              </article>
              <article>
                <v-icon icon="mdi-laptop" size="19" />
                <div>
                  <small>This device</small><strong>{{ computerName.trim() }}</strong>
                </div>
              </article>
              <article v-if="!isJoining">
                <v-icon icon="mdi-book-cross" size="19" />
                <div>
                  <small>Scripture</small><strong>{{ defaultTranslation }}</strong>
                </div>
              </article>
              <article v-if="!isJoining">
                <v-icon icon="mdi-calendar-star" size="19" />
                <div>
                  <small>Primary service</small><strong>{{ firstServiceType }}</strong>
                </div>
              </article>
              <article>
                <v-icon icon="mdi-monitor-multiple" size="19" />
                <div>
                  <small>Displays</small
                  ><strong>{{
                    displays.length ? `${displays.length} detected` : 'Configure later'
                  }}</strong>
                </div>
              </article>
            </div>
            <div class="next-steps">
              <div class="next-heading">
                <strong>Useful next steps</strong
                ><span
                  >These are intentionally separate because every church organizes them
                  differently.</span
                >
              </div>
              <button type="button" @click="completeSetup('/library/service-templates')">
                <span><v-icon icon="mdi-file-tree-outline" size="21" /></span>
                <div>
                  <strong>Build a service template</strong
                  ><small>Define your usual order and staffing needs.</small>
                </div>
                <v-icon icon="mdi-arrow-right" size="18" />
              </button>
              <button type="button" @click="completeSetup('/people')">
                <span><v-icon icon="mdi-account-multiple-outline" size="21" /></span>
                <div>
                  <strong>Add people and roles</strong
                  ><small>Prepare the directory for service assignments.</small>
                </div>
                <v-icon icon="mdi-arrow-right" size="18" />
              </button>
            </div>
          </section>
        </div>

        <footer class="wizard-footer">
          <v-btn variant="text" size="small" :disabled="saving" @click="skipSetup"
            >Skip for Now</v-btn
          >
          <div>
            <v-btn
              v-if="stepIndex > 0"
              variant="outlined"
              prepend-icon="mdi-arrow-left"
              :disabled="saving"
              @click="goBack"
              >Back</v-btn
            >
            <v-btn
              v-if="currentStep === 'finish'"
              color="primary"
              variant="flat"
              append-icon="mdi-arrow-right"
              :loading="saving"
              @click="completeSetup('/')"
              >Open Services</v-btn
            >
            <v-btn
              v-else
              color="primary"
              variant="flat"
              append-icon="mdi-arrow-right"
              @click="goNext"
              >Continue</v-btn
            >
          </div>
        </footer>
      </div>
    </section>
  </main>
</template>

<style scoped>
.wizard-page {
  min-height: calc(100vh - 48px);
  padding: 26px;
  background:
    radial-gradient(circle at 18% 12%, rgba(var(--v-theme-primary), 0.1), transparent 34%),
    rgba(var(--v-theme-background), 0.68);
}
.wizard-loading {
  display: flex;
  min-height: calc(100vh - 100px);
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 13px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
}
.wizard-shell {
  display: grid;
  width: min(1120px, 100%);
  min-height: min(720px, calc(100vh - 100px));
  margin: 0 auto;
  grid-template-columns: 248px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 17px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.14);
}
.wizard-sidebar {
  display: flex;
  flex-direction: column;
  padding: 25px 18px 20px;
  background: linear-gradient(
    165deg,
    rgba(var(--v-theme-primary), 0.14),
    rgba(var(--v-theme-background), 0.45)
  );
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.wizard-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 7px 23px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.brand-mark {
  display: grid;
  width: 41px;
  height: 41px;
  place-items: center;
  border-radius: 11px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 7px 18px rgba(var(--v-theme-primary), 0.22);
}
.wizard-brand strong,
.wizard-brand small {
  display: block;
}
.wizard-brand strong {
  font-size: 0.9rem;
}
.wizard-brand small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.72rem;
}
.wizard-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 0;
}
.wizard-step {
  display: grid;
  min-height: 53px;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.47);
  cursor: default;
  text-align: left;
}
.wizard-step--done {
  cursor: pointer;
}
.wizard-step--done:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
}
.wizard-step--active {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-on-surface));
}
.step-marker {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 50%;
  font-size: 0.68rem;
  font-weight: 700;
}
.wizard-step--active .step-marker,
.wizard-step--done .step-marker {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.step-copy strong,
.step-copy small {
  display: block;
}
.step-copy strong {
  font-size: 0.78rem;
}
.step-copy small {
  margin-top: 2px;
  font-size: 0.67rem;
  opacity: 0.72;
}
.sidebar-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: auto;
  padding: 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.45);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.sidebar-note p {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.5;
}
.wizard-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.mobile-progress {
  display: none;
}
.wizard-content {
  flex: 1;
  padding: 34px 42px 26px;
}
.wizard-alert {
  margin-bottom: 17px;
}
.step-panel {
  max-width: 760px;
  margin: 0 auto;
}
.step-eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 760;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.step-panel h1 {
  margin: 4px 0 7px;
  font-size: 1.55rem;
  line-height: 1.18;
  letter-spacing: -0.02em;
}
.step-intro,
.step-heading p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.82rem;
  line-height: 1.55;
}
.step-heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 24px;
}
.step-heading h1 {
  font-size: 1.35rem;
}
.step-icon {
  display: grid;
  width: 45px;
  height: 45px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.step-icon--success {
  width: 58px;
  height: 58px;
  margin-bottom: 16px;
  border-radius: 50%;
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.welcome-panel {
  padding-top: 4px;
}
.welcome-logo {
  display: block;
  width: min(360px, 68%);
  height: auto;
  margin: 0 auto 24px;
}
.welcome-panel h1 {
  max-width: 620px;
  font-size: 1.85rem;
}
.welcome-panel .step-intro {
  max-width: 650px;
  font-size: 0.84rem;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 27px;
}
.mode-card {
  padding: 19px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.25);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.mode-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}
.mode-card--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.mode-icon {
  display: grid;
  width: 42px;
  height: 42px;
  margin-bottom: 12px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.mode-card strong {
  display: block;
  font-size: 0.85rem;
}
.mode-card p {
  margin: 5px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.74rem;
  line-height: 1.45;
}
.optional-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 15px;
  padding: 12px 14px;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.065);
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.72rem;
  line-height: 1.45;
}
.form-section {
  max-width: 620px;
}
.field-label {
  display: block;
  margin-bottom: 7px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.76rem;
  font-weight: 700;
}
.field-help {
  display: block;
  margin-top: 7px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.69rem;
}
.brand-color-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  max-width: 620px;
  margin-top: 23px;
}
.color-field small {
  display: block;
  margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.68rem;
}
.color-control {
  display: grid;
  grid-template-columns: 45px 1fr;
  gap: 8px;
}
.color-control input {
  width: 45px;
  height: 40px;
  padding: 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.brand-preview {
  display: flex;
  max-width: 620px;
  align-items: center;
  gap: 13px;
  margin-top: 24px;
  padding: 16px 18px;
  border-left: 4px solid var(--brand-secondary);
  border-radius: 9px;
  background: linear-gradient(
    115deg,
    color-mix(in srgb, var(--brand-primary) 14%, transparent),
    rgba(var(--v-theme-background), 0.34)
  );
}
.preview-mark {
  display: grid;
  width: 43px;
  height: 43px;
  place-items: center;
  border-radius: 10px;
  background: var(--brand-primary);
  color: white;
}
.brand-preview div > * {
  display: block;
}
.brand-preview small {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.brand-preview strong {
  margin: 2px 0;
  font-size: 0.84rem;
}
.brand-preview div > span {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
}
.inline-loading,
.step-empty {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
}
.step-empty > span {
  display: grid;
  width: 53px;
  height: 53px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.step-empty strong {
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.78rem;
}
.step-empty p {
  margin: -3px 0 6px;
  font-size: 0.66rem;
}
.display-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.display-card {
  display: grid;
  grid-template-columns: 38px minmax(120px, 1fr) 190px auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.22);
}
.display-number {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-size: 0.76rem;
  font-weight: 750;
}
.display-copy strong,
.display-copy span {
  display: block;
}
.display-copy strong {
  font-size: 0.78rem;
}
.display-copy span {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.7rem;
}
.import-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.import-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.2);
}
.import-card--disabled {
  opacity: 0.58;
}
.import-icon,
.preference-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.import-card > .import-icon {
  grid-row: 1 / span 2;
  align-self: start;
}
.import-copy {
  min-width: 0;
  grid-column: 2;
}
.import-card > .v-select,
.import-selects {
  width: min(340px, 100%);
  min-width: 0;
  grid-column: 2;
}
.import-card > .v-btn {
  grid-row: 1 / span 2;
  grid-column: 3;
  white-space: nowrap;
}
.import-actions {
  display: flex;
  grid-row: 1 / span 2;
  grid-column: 3;
  align-items: stretch;
  flex-direction: column;
  gap: 7px;
}
.import-copy strong {
  font-size: 0.78rem;
}
.import-copy p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.7rem;
  line-height: 1.4;
}
.success-note {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  color: rgb(var(--v-theme-success));
  font-size: 0.69rem;
  font-weight: 650;
}
.import-selects {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 78px;
  gap: 7px;
}
.preference-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preference-card {
  display: grid;
  grid-template-columns: 42px minmax(180px, 1fr) minmax(210px, 260px);
  align-items: center;
  gap: 13px;
  padding: 15px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.2);
}
.preference-card strong {
  font-size: 0.78rem;
}
.preference-card p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.7rem;
  line-height: 1.4;
}
.preference-card .v-switch {
  justify-self: end;
}
.finish-panel {
  padding-top: 5px;
}
.finish-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 22px;
}
.finish-summary article {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.2);
  color: rgb(var(--v-theme-primary));
}
.finish-summary small,
.finish-summary strong {
  display: block;
}
.finish-summary small {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.finish-summary strong {
  margin-top: 2px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.75rem;
}
.next-steps {
  margin-top: 20px;
}
.next-heading {
  margin-bottom: 8px;
}
.next-heading strong,
.next-heading span {
  display: block;
}
.next-heading strong {
  font-size: 0.76rem;
}
.next-heading span {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.69rem;
}
.next-steps button {
  display: grid;
  width: 100%;
  grid-template-columns: 37px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: 7px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.next-steps button:hover {
  border-color: rgba(var(--v-theme-primary), 0.25);
  background: rgba(var(--v-theme-primary), 0.055);
}
.next-steps button > span {
  display: grid;
  width: 35px;
  height: 35px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.next-steps button strong,
.next-steps button small {
  display: block;
}
.next-steps button strong {
  font-size: 0.74rem;
}
.next-steps button small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.68rem;
}
.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 72px;
  padding: 14px 28px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.2);
}
.wizard-footer > div {
  display: flex;
  gap: 9px;
}
@media (max-width: 900px) {
  .wizard-page {
    padding: 14px;
  }
  .wizard-shell {
    grid-template-columns: 1fr;
  }
  .wizard-sidebar {
    display: none;
  }
  .mobile-progress {
    display: block;
    padding: 16px 22px 0;
  }
  .mobile-progress > div {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 0.66rem;
  }
  .mobile-progress span {
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .wizard-content {
    padding: 26px 25px 22px;
  }
}
@media (max-width: 650px) {
  .wizard-page {
    padding: 0;
  }
  .wizard-shell {
    min-height: calc(100vh - 48px);
    border: 0;
    border-radius: 0;
  }
  .mode-grid,
  .brand-color-grid,
  .finish-summary {
    grid-template-columns: 1fr;
  }
  .display-card,
  .import-card,
  .preference-card {
    grid-template-columns: 42px minmax(0, 1fr);
  }
  .display-card > .v-select,
  .display-card > .v-btn,
  .import-card > .v-select,
  .import-card > .v-btn,
  .import-actions,
  .import-selects,
  .preference-card > .v-select,
  .preference-card > .v-combobox,
  .preference-card > .v-switch {
    grid-column: 2;
    width: 100%;
  }
  .import-card > .import-icon,
  .import-card > .v-btn {
    grid-row: auto;
  }
  .import-actions {
    grid-row: auto;
    justify-self: start;
  }
  .import-card > .v-btn {
    justify-self: start;
  }
  .wizard-footer {
    padding: 12px 15px;
  }
  .wizard-footer .v-btn {
    padding-inline: 11px;
  }
}
</style>
