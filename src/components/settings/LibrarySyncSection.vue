<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { useSongsStore } from '@/stores/songs'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useThemesStore } from '@/stores/themes'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
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
const confirmDialog = useConfirmDialogStore()

const refreshingSync = ref(false)
async function refreshSyncStatus() {
  refreshingSync.value = true
  try {
    await syncStore.load()
  } finally {
    refreshingSync.value = false
  }
}

const loadingSampleData = ref(false)
const sampleDataLoaded = ref(false)
const clearingData = ref(false)
const dataCleared = ref(false)
const addingStockBackgrounds = ref(false)
const stockBackgroundsAdded = ref<{ mediaAdded: number; themesAdded: number }>()
const stockBackgroundsError = ref('')

// Non-destructive and re-runnable any time — unlike Load Sample Data/Clear Existing Data,
// this only ever adds whichever of the 6 stock images/2 starter themes aren't already present
// (fixed ids make it idempotent), so it needs no confirmation dialog.
async function addStockBackgrounds() {
  addingStockBackgrounds.value = true
  stockBackgroundsError.value = ''
  try {
    stockBackgroundsAdded.value = await getAdapter().media.importStockBackgrounds()
  } catch (error) {
    stockBackgroundsError.value =
      error instanceof Error ? error.message : 'Stock backgrounds could not be added.'
  } finally {
    addingStockBackgrounds.value = false
  }
}

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
      librarySettings.value.collections = [...sampleCollections]
      await store.save()
    }
    sampleDataLoaded.value = true
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
    !(await confirmDialog.confirm(
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
      librarySettings.value.serviceTypes = []
      librarySettings.value.collections = []
      librarySettings.value.roleGroups = []
      librarySettings.value.serviceTemplates = []
      await store.save()
    }
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
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
  <SettingsPanel
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
        color="primary"
        prepend-icon="mdi-image-plus-outline"
        :loading="addingStockBackgrounds"
        @click="addStockBackgrounds"
      >
        Add Stock Backgrounds
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
    <div v-if="stockBackgroundsAdded" class="text-caption text-medium-emphasis mt-2">
      {{ stockBackgroundsAdded.mediaAdded }} background image{{
        stockBackgroundsAdded.mediaAdded === 1 ? '' : 's'
      }}
      and {{ stockBackgroundsAdded.themesAdded }} theme{{
        stockBackgroundsAdded.themesAdded === 1 ? '' : 's'
      }}
      added (already-present ones were skipped).
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
@media (max-width: 700px) {
  .path-setting {
    align-items: stretch;
    grid-template-columns: 1fr;
  }
  .path-setting-actions {
    flex-wrap: wrap;
  }
}
</style>
