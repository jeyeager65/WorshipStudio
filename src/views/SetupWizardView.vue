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
import type {
  DisplayInfo,
  DisplayRole,
  ImportSetsSummary,
  ScriptureTranslation,
} from '@/adapters/types'

const router = useRouter()
const store = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const songsStore = useSongsStore()
const unsavedChanges = useUnsavedChangesStore()
const theme = useTheme()
const adapter = getAdapter()
const isDesktop = adapter.kind === 'tauri'
const welcomeLogo = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

type StepKey = 'welcome' | 'church' | 'displays' | 'library' | 'preferences' | 'finish'
interface WizardStep {
  key: StepKey
  label: string
  shortLabel: string
  icon: string
}

const steps: WizardStep[] = [
  { key: 'welcome', label: 'Welcome', shortLabel: 'Welcome', icon: 'mdi-hand-wave-outline' },
  { key: 'church', label: 'Church Identity', shortLabel: 'Church', icon: 'mdi-church-outline' },
  { key: 'displays', label: 'Display Setup', shortLabel: 'Displays', icon: 'mdi-monitor-multiple' },
  { key: 'library', label: 'Library & Import', shortLabel: 'Library', icon: 'mdi-bookshelf' },
  {
    key: 'preferences',
    label: 'Planning Defaults',
    shortLabel: 'Defaults',
    icon: 'mdi-tune-variant',
  },
  {
    key: 'finish',
    label: 'Ready to Begin',
    shortLabel: 'Finish',
    icon: 'mdi-check-circle-outline',
  },
]
const stepIndex = ref(0)
const currentStep = computed(() => steps[stepIndex.value]!.key)
const currentStepInfo = computed(() => steps[stepIndex.value]!)
const progress = computed(() => ((stepIndex.value + 1) / steps.length) * 100)
const loading = ref(true)
const saving = ref(false)
const operationError = ref('')
const validationMessage = ref('')

onMounted(async () => {
  try {
    await Promise.all([store.load(), serviceTypesStore.load()])
    firstServiceType.value = serviceTypesStore.serviceTypes[0]?.name ?? ''
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
const serviceImportSource = ref('opensong-sets')
const importingSongs = ref(false)
const importedSongsCount = ref(0)
const setsYear = ref(new Date().getFullYear())
const setsImporting = ref(false)
const setsSummary = ref<ImportSetsSummary>()
const setsUnavailable = ref(false)
const pickingLibraryFolder = ref(false)
const defaultServiceTypeForSets = computed(() => serviceTypesStore.serviceTypes[0]?.id ?? '')
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

async function importSets() {
  setsImporting.value = true
  setsUnavailable.value = false
  operationError.value = ''
  try {
    const summary = await adapter.services.importOpenSongSets(
      setsYear.value,
      defaultServiceTypeForSets.value,
    )
    if (summary) setsSummary.value = summary
    else if (!isDesktop) setsUnavailable.value = true
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'Past services could not be imported.'
  } finally {
    setsImporting.value = false
  }
}

async function pickLibraryFolder() {
  pickingLibraryFolder.value = true
  operationError.value = ''
  try {
    const folder = await adapter.settings.pickLibraryFolder()
    if (folder && store.machineSettings) store.machineSettings.libraryPath = folder
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : 'The library folder could not be selected.'
  } finally {
    pickingLibraryFolder.value = false
  }
}

function usePortableLibraryFolder() {
  if (store.machineSettings) store.machineSettings.libraryPath = './Library'
}

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
  if (currentStep.value === 'church' && !churchName.value.trim()) {
    validationMessage.value = 'Enter the church or ministry name that should appear on reports.'
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
  if (currentStep.value === 'preferences') await applyFirstServiceType()
  if (stepIndex.value < steps.length - 1) stepIndex.value++
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
    await applyFirstServiceType()
    store.machineSettings.hasCompletedSetup = true
    await store.save()
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
              We’ll configure the basics for planning and presenting your first service. This
              usually takes about three minutes.
            </p>
            <div class="welcome-grid">
              <article>
                <span><v-icon icon="mdi-calendar-check-outline" size="21" /></span>
                <div>
                  <strong>Plan consistently</strong>
                  <p>Choose the service and scripture defaults your team uses most.</p>
                </div>
              </article>
              <article>
                <span><v-icon icon="mdi-presentation-play" size="21" /></span>
                <div>
                  <strong>Present confidently</strong>
                  <p>Confirm which display belongs to the operator and audience.</p>
                </div>
              </article>
              <article>
                <span><v-icon icon="mdi-folder-sync-outline" size="21" /></span>
                <div>
                  <strong>Keep your library</strong>
                  <p>Import existing OpenSong content and choose where files live.</p>
                </div>
              </article>
            </div>
            <div class="optional-note">
              <v-icon icon="mdi-information-outline" size="19" /><span
                >Imports are optional. Roles, people, templates, Canva, and other integrations can
                be configured when you need them.</span
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
                <div class="step-eyebrow">Library & Import</div>
                <h1>Bring your existing work with you</h1>
                <p>Every option on this page is optional and remains available after setup.</p>
              </div>
            </div>
            <div class="import-list">
              <article class="import-card">
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

              <article class="import-card" :class="{ 'import-card--disabled': !isDesktop }">
                <span class="import-icon"
                  ><v-icon icon="mdi-calendar-import-outline" size="23"
                /></span>
                <div class="import-copy">
                  <strong>Past services</strong>
                  <p>Import dated OpenSong Sets and match their songs by title.</p>
                  <span v-if="setsSummary" class="success-note"
                    ><v-icon icon="mdi-check-circle" size="16" />{{
                      setsSummary.servicesCreated
                    }}
                    services imported</span
                  >
                </div>
                <div class="import-selects">
                  <v-select
                    v-model="serviceImportSource"
                    :items="[{ title: 'OpenSong Sets', value: 'opensong-sets' }]"
                    label="Source"
                    variant="outlined"
                    density="compact"
                    hide-details
                  /><v-text-field
                    v-model.number="setsYear"
                    type="number"
                    label="Year"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </div>
                <v-btn
                  variant="outlined"
                  prepend-icon="mdi-folder-open-outline"
                  :loading="setsImporting"
                  :disabled="!isDesktop"
                  @click="importSets"
                  >Choose Folder</v-btn
                >
              </article>
              <v-alert v-if="setsUnavailable" type="info" variant="tonal" density="compact"
                >Past-service folder import is available in the desktop app.</v-alert
              >

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

              <article class="import-card">
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
            <v-alert
              v-if="setsSummary?.unmatchedSongTitles.length"
              type="warning"
              variant="tonal"
              density="compact"
              class="mt-3"
              >{{ setsSummary.unmatchedSongTitles.length }} song titles could not be matched. You
              can review them after setup.</v-alert
            >
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

          <section v-else class="step-panel finish-panel">
            <span class="step-icon step-icon--success"><v-icon icon="mdi-check" size="30" /></span>
            <div class="step-eyebrow">Setup Complete</div>
            <h1>{{ churchName.trim() || 'Your church' }} is ready</h1>
            <p class="step-intro">
              The essentials are configured. You can create a service now or continue shaping the
              planning library.
            </p>
            <div class="finish-summary">
              <article>
                <v-icon icon="mdi-church-outline" size="19" />
                <div>
                  <small>Church</small><strong>{{ churchName.trim() }}</strong>
                </div>
              </article>
              <article>
                <v-icon icon="mdi-book-cross" size="19" />
                <div>
                  <small>Scripture</small><strong>{{ defaultTranslation }}</strong>
                </div>
              </article>
              <article>
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
.welcome-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 27px;
}
.welcome-grid article {
  padding: 15px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.25);
}
.welcome-grid article > span {
  display: grid;
  width: 36px;
  height: 36px;
  margin-bottom: 11px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.welcome-grid strong {
  font-size: 0.78rem;
}
.welcome-grid p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.49);
  font-size: 0.72rem;
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
  .welcome-grid,
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
