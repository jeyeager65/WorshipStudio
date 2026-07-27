<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useSongsStore } from '@/stores/songs'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import type { DisplayInfo, DisplayRole, ImportSetsSummary } from '@/adapters/types'

const router = useRouter()
const store = useSettingsStore()
const songsStore = useSongsStore()
const theme = useTheme()

type StepKey = 'welcome' | 'displays' | 'library' | 'preferences' | 'finish'
const steps: { key: StepKey; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'displays', label: 'Displays' },
  { key: 'library', label: 'Library' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'finish', label: 'Finish' },
]
const stepIndex = ref(0)
const currentStep = computed(() => steps[stepIndex.value]!.key)

onMounted(async () => {
  await store.load()
  await loadDisplays()
})

// Display Setup — same reasoning/feature-detection as SettingsView's copy of this: the
// port is entirely absent on builds where it doesn't apply.
const displays = ref<DisplayInfo[]>([])
const roleOptions: { title: string; value: DisplayRole }[] = [
  { title: 'Operator (this window)', value: 'operator' },
  { title: 'Audience Display', value: 'audience' },
  { title: 'Not Used', value: 'not-used' },
]
async function loadDisplays() {
  try {
    displays.value = (await getAdapter().displays?.list()) ?? []
  } catch (e) {
    console.error('Failed to list displays:', e)
    displays.value = []
  }
}
async function assignRole(displayId: string, role: DisplayRole) {
  await getAdapter().displays?.assignRole(displayId, role)
  const display = displays.value.find((d) => d.id === displayId)
  if (display) display.role = role
}
async function identifyDisplay(displayId: string) {
  await getAdapter().displays?.identify(displayId)
}

// Import Library — Import Songs works in both adapters (browser file picker in the mock,
// native file picker in Tauri — see songs.importFromOpenSongFiles).
const importingSongs = ref(false)
const importedSongsCount = ref(0)
async function importSongs() {
  importingSongs.value = true
  try {
    const imported = await songsStore.importFromOpenSong()
    importedSongsCount.value += imported.length
  } finally {
    importingSongs.value = false
  }
}

// OpenSong Sets → Services, current year only (see src-tauri/src/domain/opensong_sets.rs).
// Needs a real folder, so it's a no-op returning undefined in the browser demo.
const setsYear = ref(new Date().getFullYear())
const setsImporting = ref(false)
const setsSummary = ref<ImportSetsSummary>()
const setsUnavailable = ref(false)
const defaultServiceTypeForSets = computed(
  () => store.librarySettings?.serviceTypes[0] ?? 'Sunday Morning Worship',
)
async function importSets() {
  setsImporting.value = true
  setsUnavailable.value = false
  try {
    const summary = await getAdapter().services.importOpenSongSets(
      setsYear.value,
      defaultServiceTypeForSets.value,
    )
    if (summary) {
      setsSummary.value = summary
    } else if (getAdapter().kind === 'mock') {
      setsUnavailable.value = true
    }
  } finally {
    setsImporting.value = false
  }
}

const pickingLibraryFolder = ref(false)
async function pickLibraryFolder() {
  pickingLibraryFolder.value = true
  try {
    const folder = await getAdapter().settings.pickLibraryFolder()
    if (folder && store.machineSettings) store.machineSettings.libraryPath = folder
  } finally {
    pickingLibraryFolder.value = false
  }
}

// Preferences
const darkMode = computed({
  get: () => store.machineSettings?.darkMode ?? true,
  set: (value: boolean) => {
    if (!store.machineSettings) return
    store.machineSettings.darkMode = value
    theme.change(value ? 'worshipDark' : 'worshipLight')
  },
})
// "First Service Type" means whichever entry leads librarySettings.serviceTypes — Create
// Service preselects serviceTypes[0] (see CreateServiceView) — so setting it here means
// moving (or adding) the chosen type to the front rather than tracking it separately.
const firstServiceType = ref('')
function applyFirstServiceType() {
  const settings = store.librarySettings
  const chosen = firstServiceType.value.trim()
  if (!settings || !chosen) return
  const withoutChosen = settings.serviceTypes.filter((t) => t !== chosen)
  settings.serviceTypes = [chosen, ...withoutChosen]
}

async function goNext() {
  if (currentStep.value === 'preferences') applyFirstServiceType()
  if (currentStep.value === 'finish') {
    await finish()
    return
  }
  if (stepIndex.value === 0 && store.librarySettings) {
    firstServiceType.value = store.librarySettings.serviceTypes[0] ?? ''
  }
  stepIndex.value++
}
function goBack() {
  if (stepIndex.value > 0) stepIndex.value--
}
async function finish() {
  if (!store.machineSettings) return
  store.machineSettings.hasCompletedSetup = true
  await store.save()
  router.push('/')
}
async function skipSetup() {
  if (!store.machineSettings) return
  store.machineSettings.hasCompletedSetup = true
  await store.save()
  router.push('/')
}
</script>

<template>
  <div v-if="store.machineSettings && store.librarySettings" class="wizard-shell">
    <v-card class="wizard-card" elevation="8">
      <div class="d-flex justify-center ga-2 pt-6 px-6">
        <template v-for="(step, index) in steps" :key="step.key">
          <div class="d-flex align-center ga-1">
            <v-avatar
              :color="index <= stepIndex ? 'primary' : undefined"
              size="26"
              class="text-caption"
            >
              <v-icon v-if="index < stepIndex" icon="mdi-check" size="16" />
              <span v-else>{{ index + 1 }}</span>
            </v-avatar>
            <span
              class="text-caption"
              :class="index <= stepIndex ? 'text-high-emphasis' : 'text-medium-emphasis'"
            >
              {{ step.label }}
            </span>
          </div>
          <v-divider
            v-if="index < steps.length - 1"
            class="align-self-center"
            style="width: 24px"
          />
        </template>
      </div>

      <v-card-text class="wizard-body">
        <template v-if="currentStep === 'welcome'">
          <div class="text-h2 mb-3">👋</div>
          <h1 class="text-h5 mb-2">Welcome to Worship Studio</h1>
          <p class="text-medium-emphasis">
            Let's get a few things set up before your first service. This takes about 2 minutes.
          </p>
        </template>

        <template v-else-if="currentStep === 'displays'">
          <h1 class="text-h5 mb-2">Set Up Your Displays</h1>
          <p class="text-medium-emphasis mb-4">
            Assign a role to each connected screen. Not sure which is which? Use "Identify."
          </p>
          <v-alert
            v-if="needsSingleMonitorFallback(displays)"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            Only one display detected — the audience output will show in a preview window instead of
            fullscreen until a second display is connected.
          </v-alert>
          <p v-if="displays.length === 0" class="text-medium-emphasis text-body-2">
            No displays detected.
          </p>
          <div v-for="display in displays" :key="display.id" class="d-flex align-center ga-3 mb-3">
            <div class="flex-grow-1">
              <div class="font-weight-bold">{{ display.name }}</div>
              <div class="text-caption text-medium-emphasis">{{ display.resolution }}</div>
            </div>
            <v-btn
              variant="flat"
              color="secondary"
              size="small"
              @click="identifyDisplay(display.id)"
              >Identify</v-btn
            >
            <v-select
              :model-value="display.role"
              :items="roleOptions"
              variant="outlined"
              density="compact"
              style="width: 200px"
              hide-details
              :disabled="needsSingleMonitorFallback(displays)"
              @update:model-value="(role: DisplayRole) => assignRole(display.id, role)"
            />
          </div>
        </template>

        <template v-else-if="currentStep === 'library'">
          <h1 class="text-h5 mb-2">Import Your Library</h1>
          <p class="text-medium-emphasis mb-4">
            Bring in what you already have — you can always do this later from Settings.
          </p>

          <v-card variant="outlined" class="mb-3 pa-4">
            <div class="d-flex align-center ga-3">
              <v-icon icon="mdi-music-note" size="28" />
              <div class="flex-grow-1">
                <div class="font-weight-bold">Import Songs</div>
                <div class="text-caption text-medium-emphasis">
                  From OpenSong XML files
                  <span v-if="importedSongsCount > 0">— {{ importedSongsCount }} imported</span>
                </div>
              </div>
              <v-btn variant="flat" color="primary" :loading="importingSongs" @click="importSongs">
                Choose Files…
              </v-btn>
            </div>
          </v-card>

          <v-card variant="outlined" class="mb-3 pa-4">
            <div class="d-flex align-center ga-3 mb-3">
              <v-icon icon="mdi-calendar-import" size="28" />
              <div class="flex-grow-1">
                <div class="font-weight-bold">Import Past Services</div>
                <div class="text-caption text-medium-emphasis">
                  From OpenSong Sets — matched to your songs by title, current year only
                </div>
              </div>
              <v-text-field
                v-model.number="setsYear"
                type="number"
                label="Year"
                variant="outlined"
                density="compact"
                hide-details
                style="width: 100px"
              />
              <v-btn variant="flat" color="primary" :loading="setsImporting" @click="importSets">
                Choose Sets Folder…
              </v-btn>
            </div>
            <v-alert v-if="setsUnavailable" type="info" variant="tonal" density="compact">
              Not available in this demo build — try the desktop app.
            </v-alert>
            <v-alert v-else-if="setsSummary" type="success" variant="tonal" density="compact">
              <div>
                {{ setsSummary.servicesCreated }} service(s) created,
                {{ setsSummary.songReferencesMatched }} song references matched.
              </div>
              <div v-if="setsSummary.unmatchedSongTitles.length">
                Unmatched songs: {{ setsSummary.unmatchedSongTitles.join(', ') }}
              </div>
              <div v-if="setsSummary.skippedFiles.length">
                Skipped files (no recognizable date): {{ setsSummary.skippedFiles.join(', ') }}
              </div>
            </v-alert>
          </v-card>

          <v-card variant="outlined" class="mb-3 pa-4">
            <div class="d-flex align-center ga-3">
              <v-icon icon="mdi-book-open-page-variant" size="28" />
              <div class="flex-grow-1">
                <div class="font-weight-bold">Bible Translations</div>
                <div class="text-caption text-medium-emphasis">
                  KJV is already included. Add ESV or others in the next step or later in Settings.
                </div>
              </div>
            </div>
          </v-card>

          <v-card variant="outlined" class="pa-4">
            <div class="d-flex align-center ga-3">
              <v-icon icon="mdi-folder-sync" size="28" />
              <div class="flex-grow-1">
                <div class="font-weight-bold">Sync Folder</div>
                <div class="text-caption text-medium-emphasis">
                  {{ store.machineSettings.libraryPath }}
                </div>
              </div>
              <v-btn
                variant="flat"
                color="secondary"
                :loading="pickingLibraryFolder"
                @click="pickLibraryFolder"
              >
                Choose Folder…
              </v-btn>
            </div>
          </v-card>
        </template>

        <template v-else-if="currentStep === 'preferences'">
          <h1 class="text-h5 mb-2">Basic Preferences</h1>
          <p class="text-medium-emphasis mb-4">All of these can be changed later in Settings.</p>

          <div class="d-flex align-center justify-space-between py-3 pref-row">
            <div>
              <div class="font-weight-bold">Default Bible Translation</div>
              <div class="text-caption text-medium-emphasis">
                King James Version is bundled and always available. Add ESV or NIV later in
                Settings → Bible Translations.
              </div>
            </div>
          </div>

          <div class="d-flex align-center justify-space-between py-3 pref-row">
            <div>
              <div class="font-weight-bold">Dark Mode</div>
              <div class="text-caption text-medium-emphasis">
                Recommended for a dim booth environment
              </div>
            </div>
            <v-switch v-model="darkMode" color="primary" hide-details />
          </div>

          <div class="d-flex align-center justify-space-between py-3">
            <div>
              <div class="font-weight-bold">First Service Type</div>
              <div class="text-caption text-medium-emphasis">
                Preselected on Create Service — you can add more later
              </div>
            </div>
            <v-combobox
              v-model="firstServiceType"
              :items="store.librarySettings.serviceTypes"
              variant="outlined"
              density="compact"
              hide-details
              style="width: 220px"
            />
          </div>
        </template>

        <template v-else-if="currentStep === 'finish'">
          <div class="text-h2 mb-3">🎉</div>
          <h1 class="text-h5 mb-2">You're All Set</h1>
          <p class="text-medium-emphasis">Worship Studio is ready to go.</p>
          <v-card variant="tonal" class="mt-4 pa-4">
            <div v-for="display in displays" :key="display.id">
              ✓ {{ display.name }} → {{ display.role }}
            </div>
            <div v-if="importedSongsCount > 0">✓ {{ importedSongsCount }} song(s) imported</div>
            <div v-if="setsSummary">
              ✓ {{ setsSummary.servicesCreated }} past service(s) imported
            </div>
            <div v-if="store.librarySettings.defaultTranslationCode">
              ✓ Default translation: {{ store.librarySettings.defaultTranslationCode }}
            </div>
          </v-card>
        </template>
      </v-card-text>

      <v-card-actions class="wizard-footer px-6 py-4">
        <v-btn variant="text" size="small" @click="skipSetup">Skip setup</v-btn>
        <v-spacer />
        <v-btn v-if="stepIndex > 0" variant="outlined" class="mr-2" @click="goBack">‹ Back</v-btn>
        <v-btn variant="flat" color="primary" @click="goNext">
          {{ currentStep === 'finish' ? 'Finish' : 'Continue ›' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.wizard-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.wizard-card {
  width: 100%;
  max-width: 720px;
}
.wizard-body {
  min-height: 340px;
  padding: 24px !important;
}
.pref-row {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.wizard-footer {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
