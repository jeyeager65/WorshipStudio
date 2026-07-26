<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useTheme } from 'vuetify'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import UndoToastStack from '@/components/UndoToastStack.vue'
import SplashScreen from '@/components/SplashScreen.vue'
import PresentationView from '@/views/PresentationView.vue'
import IdentifyView from '@/views/IdentifyView.vue'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useSyncStore } from '@/stores/sync'
import { useSettingsStore } from '@/stores/settings'
import { useServicesStore } from '@/stores/services'

const { blockedMessage } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const syncStore = useSyncStore()
const settingsStore = useSettingsStore()
const servicesStore = useServicesStore()

// The presentation window (see src/adapters/tauri/index.ts's `live` port) loads this same
// app bundle in a second native window labeled "presentation" — never reached through
// routing, since it isn't the main window at all. Everything else below (app-bar, nav,
// router-view) is only ever what the operator window shows. Checking the Tauri window
// label rather than the URL avoids any question of whether a query string/path survives
// however Tauri serves the bundled frontend to a freshly created window.
const isPresentationWindow =
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__ && getCurrentWindow().label === 'presentation'

// Same reasoning as the presentation window above — the Display Setup "Identify" button
// (SettingsView) opens this same bundle in a short-lived window labeled "identify", also
// never reached through routing. Its label text rides along as a real query string (not a
// `#/...` hash — this app uses path-based createWebHistory routing, so a hash fragment would
// be inert) since Tauri's WebviewWindowOptions has no field for arbitrary custom data.
const isIdentifyWindow =
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__ && getCurrentWindow().label === 'identify'
const identifyLabel = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('identify') ?? '') : ''

// The router guard (router/index.ts) covers in-app navigation; this covers closing the
// tab/window entirely, which a route guard can't intercept.
window.addEventListener('beforeunload', (event) => {
  if (isDirty.value) event.preventDefault()
})

// Dark mode (Settings → General) is a per-machine preference, applied once at startup
// here rather than re-read on every screen — SettingsView just needs to update
// theme.global.name itself when the user flips the toggle.
const theme = useTheme()
const router = useRouter()
const route = useRoute()
// The wizard is a forced, standalone first-run flow (see App.vue's redirect below and
// SettingsView's "Run First-Time Setup Wizard") — showing the normal nav alongside it would
// let the operator wander off mid-setup, defeating the point.
const isSetupWizard = computed(() => route.name === 'setup-wizard')

// Splash screen (feature-spec.md section "Splash screen"): shown only for the normal
// operator-window startup path, not the presentation/identify windows or the first-run
// wizard (which has its own onboarding UI and nothing meaningful to preload yet).
const showingSplash = ref(!isPresentationWindow && !isIdentifyWindow)
const splashStatus = ref('Loading settings…')

onMounted(async () => {
  await settingsStore.load()
  const machineSettings = settingsStore.machineSettings!
  theme.change(machineSettings.darkMode ? 'worshipDark' : 'worshipLight')

  // First launch (or an upgrade from before this flag existed) — send the operator through
  // the wizard once before anything else. Direct navigation to any other route still works
  // normally afterward; this only fires on the very first paint.
  if (
    !isPresentationWindow &&
    !isIdentifyWindow &&
    !machineSettings.hasCompletedSetup &&
    router.currentRoute.value.path !== '/setup'
  ) {
    router.replace('/setup')
    showingSplash.value = false
  }

  // Fire-and-forget — a slow/failed sync-status check shouldn't block the rest of startup,
  // and the app-bar badge below just stays hidden until it resolves.
  if (!isPresentationWindow && !isIdentifyWindow) void syncStore.load()

  if (showingSplash.value) {
    splashStatus.value = 'Loading library…'
    await servicesStore.load()
    showingSplash.value = false
  }
})
</script>

<template>
  <PresentationView v-if="isPresentationWindow" />
  <IdentifyView v-else-if="isIdentifyWindow" :label="identifyLabel" />
  <v-app v-else>
    <SplashScreen
      v-if="showingSplash"
      :church-name="settingsStore.librarySettings?.branding.churchName"
      :primary-color="settingsStore.librarySettings?.branding.primaryColor"
      :secondary-color="settingsStore.librarySettings?.branding.secondaryColor"
      :status-text="splashStatus"
    />
    <v-app-bar v-if="!isSetupWizard" density="compact" elevation="0" class="border-b app-bar-no-print">
      <v-spacer />
      <span v-if="saveHandler" class="text-caption text-medium-emphasis mr-3">
        {{ saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'All changes saved' }}
      </span>
      <v-btn
        v-if="saveHandler"
        variant="flat"
        color="primary"
        class="mr-3"
        prepend-icon="mdi-content-save"
        :loading="saving"
        :disabled="!isDirty"
        @click="saveHandler"
      >
        Save
      </v-btn>
      <v-divider v-if="saveHandler" vertical inset class="mr-3" />
      <v-tooltip v-if="syncStore.status && !syncStore.status.folderReadable" text="Library folder isn't readable — check the sync setup in Settings">
        <template #activator="{ props }">
          <v-icon v-bind="props" icon="mdi-folder-alert-outline" color="error" class="mr-3" />
        </template>
      </v-tooltip>
      <v-btn
        v-if="syncStore.status && syncStore.status.conflictCount > 0"
        to="/sync-conflicts"
        variant="flat"
        color="warning"
        class="mr-3"
        prepend-icon="mdi-alert"
      >
        {{ syncStore.status.conflictCount }} conflict{{ syncStore.status.conflictCount === 1 ? '' : 's' }}
      </v-btn>
      <v-btn to="/" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-home">Home</v-btn>
      <v-btn to="/library/songs" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-bookshelf">
        Library
      </v-btn>
      <v-btn to="/library/slides" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-image-multiple">
        Slides
      </v-btn>
      <v-btn to="/library/media" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-file-image-outline">
        Media
      </v-btn>
      <v-btn to="/reports" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-file-chart-outline">
        Reports
      </v-btn>
      <v-btn to="/settings" variant="flat" color="secondary" class="mr-3" prepend-icon="mdi-cog">
        Settings
      </v-btn>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>

    <v-snackbar
      :model-value="!!blockedMessage"
      color="error"
      timeout="4000"
      @update:model-value="(open: boolean) => !open && (blockedMessage = undefined)"
    >
      {{ blockedMessage }}
    </v-snackbar>

    <ConfirmDialog />
    <UndoToastStack />
  </v-app>
</template>

<style scoped>
/* Report screens (e.g. CcliReportView) use the browser/OS "print to PDF" flow rather than a
   bundled PDF library — the persistent app-bar has to disappear for that printout too, not
   just whatever a report screen hides within its own content area. */
@media print {
  .app-bar-no-print {
    display: none !important;
  }
}
</style>
