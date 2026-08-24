<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import type { ServiceTypeDefinition, SongCollectionDefinition } from '@/models/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import SettingsPageHeader from '@/components/settings/SettingsPageHeader.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import GeneralSection from '@/components/settings/GeneralSection.vue'
import LibrarySyncSection from '@/components/settings/LibrarySyncSection.vue'
import AppearanceSection from '@/components/settings/AppearanceSection.vue'
import BrandingSection from '@/components/settings/BrandingSection.vue'
import AboutSection from '@/components/settings/AboutSection.vue'
import DisplaySetupSection from '@/components/settings/DisplaySetupSection.vue'
import FontSizesSection from '@/components/settings/FontSizesSection.vue'
import ExternalAppsSection from '@/components/settings/ExternalAppsSection.vue'
import RemoteControlSection from '@/components/settings/RemoteControlSection.vue'
import BibleTranslationsSection from '@/components/settings/BibleTranslationsSection.vue'
import CanvaSection from '@/components/settings/CanvaSection.vue'
import SongCollectionsSection from '@/components/settings/SongCollectionsSection.vue'
import ServiceTypesSection from '@/components/settings/ServiceTypesSection.vue'

const route = useRoute()
const store = useSettingsStore()
const { librarySettings, machineSettings, libraryCredentials } = storeToRefs(store)
const serviceTypesStore = useServiceTypesStore()
const songCollectionsStore = useSongCollectionsStore()
const { serviceTypes } = storeToRefs(serviceTypesStore)
const { collections } = storeToRefs(songCollectionsStore)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()
// Service Types' descriptions and Song Collections' abbreviations are edited inline
// (ServiceTypesSection.vue/SongCollectionsSection.vue) but, unlike Add/Remove on those same
// lists, go through this page's own Save button for consistency with every other field here —
// folding their arrays into the same tracked document gets that, plus undo/redo, for free from
// useDocumentHistory's existing deep-diffing rather than a second, parallel dirty-tracking
// mechanism per list.
const settingsDocument = computed({
  get: () =>
    librarySettings.value && machineSettings.value && libraryCredentials.value
      ? {
          library: librarySettings.value,
          machine: machineSettings.value,
          credentials: libraryCredentials.value,
          serviceTypes: serviceTypes.value,
          collections: collections.value,
        }
      : undefined,
  set: (value) => {
    if (!value) return
    librarySettings.value = value.library
    machineSettings.value = value.machine
    libraryCredentials.value = value.credentials
    serviceTypes.value = value.serviceTypes
    collections.value = value.collections
  },
})
const documentHistory = useDocumentHistory(settingsDocument, 'settings')
// What's actually persisted on disk as of the last load/save — Add/Remove on these two lists
// still save immediately (see the two section components), so saveSettings() below only needs
// to persist description/abbreviation edits, and only for entries that actually changed rather
// than unconditionally rewriting both list files on every unrelated Settings save.
let savedServiceTypes: ServiceTypeDefinition[] = []
let savedCollections: SongCollectionDefinition[] = []
// The folder shown in the draft settings can change before Save. Keep the last persisted path
// separately so saving unrelated settings does not produce a reload prompt, while a real
// library switch does—even after the reactive settings object has already been edited.
const savedLibraryPath = ref('')
const savedRemoteControlPort = ref<number>()
const savedRemoteControlHostname = ref<string>()
const savedCanvaCallbackPort = ref<number>()

// Duplicated from CanvaSection.vue's identical computed — needed here to gate saveSettings(),
// and it only reads the shared machineSettings store ref, so plumbing it through a ref/props
// would be more indirection than just recomputing it.
const canvaPortConflict = computed(
  () =>
    !!machineSettings.value?.remoteControlPort &&
    machineSettings.value.remoteControlPort === machineSettings.value.canvaCallbackPort,
)
const canvaSectionRef = ref<InstanceType<typeof CanvaSection>>()
const bibleTranslationsSectionRef = ref<InstanceType<typeof BibleTranslationsSection>>()

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
  // Profile CRUD (name, launch mode, key commands, ...) is shared/synced data and works on
  // every adapter — always shown, unlike Remote Control below, which needs a real Tauri-only
  // capability to be worth showing at all. Only the per-machine executable path (this section's
  // own editor page has an "On This Computer" sub-section for it) is Windows/Tauri-only.
  { key: 'external-apps', label: 'External Apps', group: 'Appearance & Displays' },
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
// Lets ExternalAppProfileEditorView's back button (and anywhere else that navigates here with
// a specific section in mind) land back on that section instead of always resetting to
// General — activeSection is otherwise just local component state, not synced to the route.
const requestedSection = route.query.section
if (typeof requestedSection === 'string' && sections.some((s) => s.key === requestedSection)) {
  activeSection.value = requestedSection as Section
}
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
  canva: 'Configure the church’s Canva integration and connect this computer to a Canva account.',
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
onMounted(async () => {
  await Promise.all([store.load(), serviceTypesStore.load(), songCollectionsStore.load()])
  savedLibraryPath.value = machineSettings.value?.libraryPath ?? ''
  savedRemoteControlPort.value = machineSettings.value?.remoteControlPort
  savedRemoteControlHostname.value = machineSettings.value?.remoteControlHostname
  savedCanvaCallbackPort.value = machineSettings.value?.canvaCallbackPort
  savedServiceTypes = structuredClone(toRaw(serviceTypes.value))
  savedCollections = structuredClone(toRaw(collections.value))
  isDirty.value = false
  // Start history after loading so persisted machine and church settings form the baseline.
  rebaselineHistory()
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveSettings
})

// Re-registers document history against whatever librarySettings/machineSettings currently
// are, discarding any recorded undo entries and clearing dirty state — the correct response to
// something *other* than this page's own Save button already persisting a change on its own
// (LibrarySyncSection.vue's Data Tools actions: Load Sample Data, Clear Existing Data, Add
// Stock Backgrounds, Import OpenSong). Those mutate librarySettings directly and save
// immediately, so without this the page would otherwise show a stale "unsaved changes" prompt,
// or worse, offer an Undo that could only ever revert the settings-list portion of an action
// that already deleted/replaced real library content elsewhere — not a state this editor's
// undo stack could ever correctly restore.
function rebaselineHistory() {
  savedServiceTypes = structuredClone(toRaw(serviceTypes.value))
  savedCollections = structuredClone(toRaw(collections.value))
  documentHistory.start((dirty) => (isDirty.value = dirty))
}
onUnmounted(() => {
  documentHistory.stop()
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
  const canvaCallbackChanged =
    machineSettings.value?.canvaCallbackPort !== savedCanvaCallbackPort.value
  if (canvaPortConflict.value) return
  saving.value = true
  try {
    await store.save()
    // Add/Remove on these two lists already save immediately (see ServiceTypesSection.vue/
    // SongCollectionsSection.vue) — only description/abbreviation edits are deferred to this
    // button, so only persist entries that actually differ from what's on disk.
    const currentServiceTypes = [...serviceTypes.value]
    for (const type of currentServiceTypes) {
      const baseline = savedServiceTypes.find((saved) => saved.id === type.id)
      if (!baseline || JSON.stringify(baseline) !== JSON.stringify(type)) {
        await serviceTypesStore.save(type)
      }
    }
    const currentCollections = [...collections.value]
    for (const collection of currentCollections) {
      const baseline = savedCollections.find((saved) => saved.id === collection.id)
      if (!baseline || JSON.stringify(baseline) !== JSON.stringify(collection)) {
        await songCollectionsStore.save(collection)
      }
    }
    await canvaSectionRef.value?.loadCanvaStatus()
    await bibleTranslationsSectionRef.value?.refreshAvailability()
    savedLibraryPath.value = machineSettings.value?.libraryPath ?? savedLibraryPath.value
    savedRemoteControlPort.value = machineSettings.value?.remoteControlPort
    savedRemoteControlHostname.value = machineSettings.value?.remoteControlHostname
    savedCanvaCallbackPort.value = machineSettings.value?.canvaCallbackPort
    savedServiceTypes = structuredClone(toRaw(serviceTypes.value))
    savedCollections = structuredClone(toRaw(collections.value))
    isDirty.value = false
    if (
      (libraryPathChanged || remoteConnectionChanged || canvaCallbackChanged) &&
      (await confirmDialog.confirm(
        [libraryPathChanged, remoteConnectionChanged, canvaCallbackChanged].filter(Boolean).length >
          1
          ? 'Connection or library settings that require a restart have changed. Reload Worship Studio now to apply them?'
          : libraryPathChanged
            ? 'The library folder has changed. Reload Worship Studio now to load its services and other library content?'
            : remoteConnectionChanged
              ? 'The Remote Control connection settings have changed. Reload Worship Studio now to apply them?'
              : 'The Canva callback port has changed. Reload Worship Studio now to use the new registered address?',
        'Reload Now',
      ))
    ) {
      window.location.reload()
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AsyncLoadState
    v-if="!store.loaded"
    :loading="store.loading"
    :error="store.loadError"
    label="settings"
    class="ma-6"
    @retry="store.load"
  />
  <div v-if="librarySettings && machineSettings && libraryCredentials" class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections">
      <header class="settings-nav-header">
        <span>Configure</span>
        <strong>Worship Studio</strong>
      </header>
      <section v-for="group in groupedSections" :key="group.name" class="settings-nav-group">
        <div class="settings-nav-group-heading">
          <span>{{ group.name }}</span>
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

    <!-- Narrow-width replacement for the nav above: a single menu button instead of the whole
         section list sitting inline (which used to just be a short scrollable box at the top of
         the page). Always in the DOM; a media query picks which one actually shows, same pattern
         as the Slide Editor toolbar's full/compact button groups. -->
    <div class="settings-nav-compact">
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" class="settings-nav-compact-btn" block>
            <v-icon :icon="activeSectionInfo.icon" size="18" start />
            <span class="settings-nav-compact-label">{{ activeSectionInfo.label }}</span>
            <v-spacer />
            <v-icon icon="mdi-menu-down" size="18" end />
          </v-btn>
        </template>
        <v-list density="compact">
          <template v-for="group in groupedSections" :key="group.name">
            <v-list-subheader>{{ group.name }}</v-list-subheader>
            <v-list-item
              v-for="section in group.items"
              :key="section.key"
              :active="activeSection === section.key"
              :title="section.label"
              :prepend-icon="sectionIcons[section.key]"
              @click="selectSettingsSection(section.key)"
            />
          </template>
        </v-list>
      </v-menu>
    </div>

    <div class="settings-content">
      <AsyncLoadState
        v-if="store.loadError"
        :loading="false"
        :error="store.loadError"
        label="updated settings"
        compact
        class="mb-4"
        @retry="store.load"
      />
      <v-alert
        v-if="store.mutationError"
        type="error"
        variant="tonal"
        density="compact"
        closable
        class="mb-4"
        @click:close="store.clearMutationError"
      >
        Settings were not saved: {{ store.mutationError }}
      </v-alert>
      <SettingsPageHeader
        :eyebrow="activeSectionInfo.group"
        :title="activeSectionInfo.label"
        :description="activeSectionInfo.description"
        :icon="activeSectionInfo.icon"
      />

      <!-- Every section component mounts once and stays mounted (v-show, not v-if/v-else-if),
           so switching the active section is instant with no reload — matching the eager
           preload behavior of this page's old single shared onMounted. Adapter-gated sections
           (external apps / remote control / canva) additionally use v-if on that same constant
           feature check the nav itself uses, so they never mount at all on a build/platform
           that doesn't support them. -->
      <GeneralSection v-show="activeSection === 'general'" />
      <LibrarySyncSection
        v-show="activeSection === 'sync'"
        :active="activeSection === 'sync'"
        @bulk-data-change="rebaselineHistory"
      />
      <AboutSection v-show="activeSection === 'about'" />
      <AppearanceSection v-show="activeSection === 'appearance'" />
      <BrandingSection v-show="activeSection === 'branding'" />
      <DisplaySetupSection v-show="activeSection === 'display'" />
      <FontSizesSection v-show="activeSection === 'font-sizes'" />
      <ExternalAppsSection v-show="activeSection === 'external-apps'" />
      <RemoteControlSection
        v-if="getAdapter().kind === 'tauri'"
        v-show="activeSection === 'remote-control'"
      />

      <template v-if="activeSection === 'collections'">
        <SettingsPanel
          title="Available collections"
          description="Songbooks and catalogs a song can belong to, each with its own number."
          icon="mdi-bookshelf"
        >
          <SongCollectionsSection @bulk-data-change="rebaselineHistory" />
        </SettingsPanel>
      </template>

      <BibleTranslationsSection
        v-show="activeSection === 'bible-translations'"
        ref="bibleTranslationsSectionRef"
      />

      <CanvaSection
        v-if="getAdapter().canva"
        v-show="activeSection === 'canva'"
        ref="canvaSectionRef"
      />

      <template v-if="activeSection === 'service-types'">
        <SettingsPanel
          title="Service types"
          description="The choices offered when creating a new service (e.g. Sunday Morning, Wednesday Bible Study)."
          icon="mdi-calendar-multiple"
        >
          <ServiceTypesSection @bulk-data-change="rebaselineHistory" />
        </SettingsPanel>
      </template>
    </div>
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
  margin: 0 9px 5px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.61rem;
  font-weight: 720;
  letter-spacing: 0.075em;
  text-transform: uppercase;
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
.settings-nav-compact {
  display: none;
}
@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 218px minmax(0, 1fr);
  }
  .settings-content {
    padding-inline: 22px;
  }
}
@media (max-width: 700px) {
  .settings-layout {
    display: block;
  }
  .settings-nav {
    display: none;
  }
  .settings-nav-compact {
    display: block;
    position: sticky;
    top: 49px;
    z-index: 1;
    padding: 8px 14px;
    background: rgba(var(--v-theme-surface), 0.92);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
  .settings-nav-compact-btn {
    justify-content: flex-start;
    text-transform: none;
    letter-spacing: normal;
    font-weight: 600;
  }
  .settings-nav-compact-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .settings-content {
    max-width: none;
    padding: 18px 16px 42px;
  }
}
</style>
