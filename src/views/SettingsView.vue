<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useUndoStore } from '@/stores/undo'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import ManagedStringList from '@/components/settings/ManagedStringList.vue'
import type { DisplayInfo, DisplayRole } from '@/adapters/types'
import type { LibrarySettings } from '@/models/settings'

const store = useSettingsStore()
const router = useRouter()
const { librarySettings, machineSettings } = storeToRefs(store)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()

type Section = 'general' | 'display' | 'service-types' | 'preachers' | 'collections' | 'bible-translations' | 'themes'
const activeSection = ref<Section>('general')
const sections: { key: Section; label: string; group: string }[] = [
  { key: 'general', label: 'General', group: 'App' },
  { key: 'display', label: 'Display Setup', group: 'Display' },
  { key: 'service-types', label: 'Service Types', group: 'Content Library' },
  { key: 'preachers', label: 'Preachers', group: 'Content Library' },
  { key: 'collections', label: 'Song Collections', group: 'Content Library' },
  { key: 'bible-translations', label: 'Bible Translations', group: 'Content Library' },
  { key: 'themes', label: 'Themes', group: 'Content Library' },
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
</style>
