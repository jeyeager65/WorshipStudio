<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useTheme } from 'vuetify'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getVersion } from '@tauri-apps/api/app'
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
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'

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

// The splash screen (feature-spec.md "Splash screen") is its own small, borderless native
// window (see tauri.conf.json) rather than an overlay inside the main 1920x1080 window — at
// that size, even a real loading delay looked like an instant, mistake-looking flash. This
// window just shows branding; the main window below does the real loading, hidden, and closes
// this one once it's both ready AND the minimum on-screen duration has elapsed.
const isSplashWindow =
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__ && getCurrentWindow().label === 'splash'

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

// Only top-level pages reachable from the sidebar set meta.title (router/index.ts) — deeper
// pages (song/slide editors, the service workspace, etc.) render their own in-content
// heading instead, often a dynamic one (the actual song/service name), which wouldn't fit
// here.
const pageTitle = computed(() => route.meta.title)

// The dark logo's white wordmark reads fine on the dark theme's near-black sidebar but nearly
// disappears on the light theme's — same swap LandingView used to do before this moved here.
const logoSrc = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

// Shown at the foot of the sidebar — useful when a church reports an issue, so it's clear
// which build they're actually running.
const appVersion = ref('')

// Splash screen (feature-spec.md section "Splash screen") — see the `isSplashWindow` comment
// above for why this now lives in its own window instead of an overlay here. This ref only
// matters for the splash window's own render below; the main window never shows it.
const splashStatus = ref('Starting up…')

// The splash window (see tauri.conf.json) is guaranteed at least this long on screen so a
// fast startup on a small library doesn't just look like a flash/glitch. As the song/set
// library grows, real load time naturally pushes past this floor on its own. E2E specs build
// with VITE_E2E_TEST_MODE (see e2e/package.json's build:app) to skip the wait entirely — with
// 19 spec files each launching a fresh app instance, that floor otherwise adds minutes to a
// full suite run for no test value.
const MIN_SPLASH_MS = import.meta.env.VITE_E2E_TEST_MODE === 'true' ? 0 : 3000
const startedAt = Date.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Custom title bar (see tauri.conf.json's "decorations": false on the main window) — the
// native OS one sat as a redundant second bar above our own app-bar. The maximize icon needs
// to track real window state rather than just flipping on click, since double-clicking the
// drag region or a Windows snap gesture can also change it without going through our button.
const isMaximized = ref(false)
function minimizeWindow() {
  void getCurrentWindow().minimize()
}
function toggleMaximizeWindow() {
  void getCurrentWindow().toggleMaximize()
}
function closeWindow() {
  void getCurrentWindow().close()
}

onMounted(async () => {
  if (isSplashWindow || isPresentationWindow || isIdentifyWindow) return

  const thisWindow = getCurrentWindow()
  isMaximized.value = await thisWindow.isMaximized()
  await thisWindow.onResized(async () => {
    isMaximized.value = await thisWindow.isMaximized()
  })

  await settingsStore.load()
  const machineSettings = settingsStore.machineSettings!
  theme.change(machineSettings.darkMode ? 'worshipDark' : 'worshipLight')

  // First launch (or an upgrade from before this flag existed) — send the operator through
  // the wizard once before anything else. Direct navigation to any other route still works
  // normally afterward; this only fires on the very first paint.
  if (!machineSettings.hasCompletedSetup && router.currentRoute.value.path !== '/setup') {
    router.replace('/setup')
  }

  // Fire-and-forget — a slow/failed sync-status check shouldn't block the rest of startup,
  // and the app-bar badge below just stays hidden until it resolves.
  void syncStore.load()
  void getVersion().then((v) => (appVersion.value = v))

  await servicesStore.load()

  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_SPLASH_MS) await sleep(MIN_SPLASH_MS - elapsed)

  // E2E builds never create this window at all (see lib.rs's setup()) — the harness's
  // WebDriver session otherwise raced the splash webview's own faster startup, so avoiding
  // that race here (rather than hiding-not-closing it, which was tried first) is what actually
  // fixed it. For a real launch, this window does exist and must be actually closed, not just
  // hidden — leaving it merely hidden kept the app running after the operator closed the main
  // window, since Tauri won't quit while any window (even a hidden one) is still open.
  const splashWindow = await WebviewWindow.getByLabel('splash')
  await splashWindow?.close()
  await thisWindow.show()
  await thisWindow.setFocus()
})
</script>

<template>
  <PresentationView v-if="isPresentationWindow" />
  <IdentifyView v-else-if="isIdentifyWindow" :label="identifyLabel" />
  <v-app v-else-if="isSplashWindow">
    <SplashScreen :status-text="splashStatus" />
  </v-app>
  <v-app v-else>
    <v-navigation-drawer v-if="!isSetupWizard" permanent width="224" class="app-nav-no-print">
      <v-list nav density="comfortable" class="pt-2">
        <div class="mx-2 mt-2 mb-4">
          <img :src="logoSrc" alt="Worship Studio" class="sidebar-logo-img" />
        </div>
        <v-list-item to="/" prepend-icon="mdi-home" title="Services" rounded="lg" class="mx-2 mb-1 sidebar-item" />
        <v-list-item to="/library/songs" prepend-icon="mdi-bookshelf" title="Songs" rounded="lg" class="mx-2 mb-1 sidebar-item" />
        <v-list-item to="/library/slides" prepend-icon="mdi-image-multiple" title="Slides" rounded="lg" class="mx-2 mb-1 sidebar-item" />
        <v-list-item to="/library/media" prepend-icon="mdi-file-image-outline" title="Media" rounded="lg" class="mx-2 mb-1 sidebar-item" />
        <v-list-item to="/reports" prepend-icon="mdi-file-chart-outline" title="Reports" rounded="lg" class="mx-2 mb-1 sidebar-item" />
        <v-list-item to="/settings" prepend-icon="mdi-cog" title="Settings" rounded="lg" class="mx-2 mb-1 sidebar-item" />
      </v-list>
      <template #append>
        <div v-if="appVersion" class="pa-3 text-center text-caption text-medium-emphasis">v{{ appVersion }}</div>
      </template>
    </v-navigation-drawer>
    <!-- Always rendered, even during the setup wizard (which hides the sidebar/nav) — this is
         the only window chrome now that decorations are off, so it's what lets the operator
         drag, minimize, or close the window at every point in the app, wizard included. -->
    <v-app-bar density="compact" elevation="0" class="border-b app-bar-no-print">
      <span v-if="pageTitle" class="page-title text-h5 font-weight-bold ml-4">{{ pageTitle }}</span>
      <!-- data-tauri-drag-region only takes effect on the exact element it's applied to (no
           ancestor/child matching), so it has to sit on this actual empty spacer rather than
           the app-bar as a whole — that's what silently made the whole bar undraggable. The
           explicit height is needed too: with no content of its own, the spacer otherwise
           collapses to 0px tall inside the toolbar's flex row, leaving nothing to click. -->
      <v-spacer data-tauri-drag-region class="drag-region-spacer" />
      <template v-if="!isSetupWizard">
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
      </template>
      <v-btn icon="mdi-window-minimize" variant="text" size="small" class="title-bar-btn" @click="minimizeWindow" />
      <v-btn
        :icon="isMaximized ? 'mdi-window-restore' : 'mdi-window-maximize'"
        variant="text"
        size="small"
        class="title-bar-btn"
        @click="toggleMaximizeWindow"
      />
      <v-btn icon="mdi-window-close" variant="text" size="small" class="title-bar-btn title-bar-close" @click="closeWindow" />
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
.sidebar-logo-img {
  display: block;
  width: 100%;
  height: auto;
}
.sidebar-item :deep(.v-list-item-title) {
  font-size: 1rem;
}

/* Custom title bar (tauri.conf.json's "decorations": false) — square corners and a red
   close-hover match the native Windows title bar convention these buttons are replacing. */
.drag-region-spacer {
  height: 100%;
}
.title-bar-btn {
  border-radius: 0;
}
.title-bar-close:hover {
  background-color: #e81123;
  color: white;
}

/* Report screens (e.g. CcliReportView) use the browser/OS "print to PDF" flow rather than a
   bundled PDF library — the persistent app-bar has to disappear for that printout too, not
   just whatever a report screen hides within its own content area. */
@media print {
  .app-bar-no-print,
  .app-nav-no-print {
    display: none !important;
  }
}
</style>
