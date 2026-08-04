<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDisplay, useTheme } from 'vuetify'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen } from '@tauri-apps/api/event'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SplashScreen from '@/components/SplashScreen.vue'
import PresentationView from '@/views/PresentationView.vue'
import IdentifyView from '@/views/IdentifyView.vue'
import { getAdapter } from '@/adapters'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useSyncStore } from '@/stores/sync'
import { useSettingsStore } from '@/stores/settings'
import { useServicesStore } from '@/stores/services'
import { useHistoryStore } from '@/stores/history'
import { useRemoteServiceSelection } from '@/composables/useRemoteServiceSelection'

const { blockedMessage } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())
const syncStore = useSyncStore()
const settingsStore = useSettingsStore()
const servicesStore = useServicesStore()
const historyStore = useHistoryStore()
const hasDesktopBackend = getAdapter().kind === 'tauri'

// The presentation window (see src/adapters/tauri/index.ts's `live` port) loads this same
// app bundle in a second native window labeled "presentation" — never reached through
// routing, since it isn't the main window at all. Everything else below (app-bar, nav,
// router-view) is only ever what the operator window shows. Checking the Tauri window
// label rather than the URL avoids any question of whether a query string/path survives
// however Tauri serves the bundled frontend to a freshly created window.
const isPresentationWindow =
  typeof window !== 'undefined' &&
  !!window.__TAURI_INTERNALS__ &&
  getCurrentWindow().label === 'presentation'

// Same reasoning as the presentation window above — the Display Setup "Identify" button
// (SettingsView) opens this same bundle in a short-lived window labeled "identify", also
// never reached through routing. Its label text rides along as a real query string (not a
// `#/...` hash — this app uses path-based createWebHistory routing, so a hash fragment would
// be inert) since Tauri's WebviewWindowOptions has no field for arbitrary custom data.
const isIdentifyWindow =
  typeof window !== 'undefined' &&
  !!window.__TAURI_INTERNALS__ &&
  getCurrentWindow().label === 'identify'
const identifyLabel =
  typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('identify') ?? '')
    : ''

// The splash screen (feature-spec.md "Splash screen") is its own small, borderless native
// window (see tauri.conf.json) rather than an overlay inside the main 1920x1080 window — at
// that size, even a real loading delay looked like an instant, mistake-looking flash. This
// window shows branding plus real loading status (via the splash:status event below); the
// main window does the real loading, hidden, and closes this one once it's both done AND the
// minimum on-screen duration has elapsed.
const isSplashWindow =
  typeof window !== 'undefined' &&
  !!window.__TAURI_INTERNALS__ &&
  getCurrentWindow().label === 'splash'

useRemoteServiceSelection(!isPresentationWindow && !isIdentifyWindow && !isSplashWindow)

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
// here. A page that still wants a dynamic app-bar title (e.g. Assignments) can register one
// via pageTitleOverride instead — see unsavedChanges.ts's doc comment.
const pageTitle = computed(() => pageTitleOverride.value ?? route.meta.title)

// Below this width the expanded drawer eats too much of the content area, so it's forced into
// rail mode regardless of the operator's own manual preference — matches Vuetify's own `md`
// breakpoint, the usual point content-heavy layouts start feeling cramped.
const { width } = useDisplay()
const isNarrowWindow = computed(() => width.value < 960)
const manualNavCollapsed = ref(false)
const navigationCollapsed = computed(() => isNarrowWindow.value || manualNavCollapsed.value)
const showSavedConfirmation = ref(false)
const saveShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S'
const undoShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'
const redoShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘Shift+Z'
  : 'Ctrl+Y / Ctrl+Shift+Z'
let savedConfirmationTimer: ReturnType<typeof setTimeout> | undefined

async function runSave() {
  const handler = saveHandler.value
  if (!handler || !isDirty.value || saving.value) return
  showSavedConfirmation.value = false
  if (savedConfirmationTimer) clearTimeout(savedConfirmationTimer)
  try {
    await handler()
    // Validation failures and write failures deliberately leave the editor dirty. Only confirm
    // a save after the registered editor says its changes were actually persisted.
    if (isDirty.value) return
    historyStore.markSaved()
    showSavedConfirmation.value = true
    savedConfirmationTimer = setTimeout(() => {
      showSavedConfirmation.value = false
      savedConfirmationTimer = undefined
    }, 1800)
  } catch (error) {
    // Editors own their specific, actionable error message; this keeps a rejected handler from
    // becoming an unhandled promise while preserving the dirty state and enabled Save action.
    console.error('Save failed:', error)
  }
}

function handleHistoryShortcut(event: KeyboardEvent) {
  if (!historyStore.active || !(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  const wantsUndo = key === 'z' && !event.shiftKey
  const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey)
  if (!wantsUndo && !wantsRedo) return
  event.preventDefault()
  if (wantsUndo) historyStore.undo()
  else historyStore.redo()
}

function handleSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return
  if (!saveHandler.value) return
  event.preventDefault()
  void runSave()
}

// Splash screen (feature-spec.md section "Splash screen") — see the `isSplashWindow` comment
// above for why this now lives in its own window instead of an overlay here. This ref only
// matters for the splash window's own render below; the main window never shows it.
interface SplashProgress {
  step: number
  message: string
}

const splashProgress = ref<SplashProgress>({ step: 0, message: 'Starting Worship Studio…' })

// The splash window (see tauri.conf.json) stays on screen at least this long, so branding is
// actually perceptible rather than a one-frame flash — splashStatus below is updated with each
// real loading step as it actually happens, so as the services library grows over time, the
// screen stays up for as long as loading genuinely takes (past this floor) and says what it's
// doing, rather than a static message timed to a fake minimum. E2E specs build with
// VITE_E2E_TEST_MODE (see e2e/package.json's build:app) to skip even this floor — with 19 spec
// files each launching a fresh app instance, any wait here adds real minutes to a full suite
// run for no test value.
const MIN_SPLASH_MS = import.meta.env.VITE_E2E_TEST_MODE === 'true' ? 0 : 2000
// Shown once loading finishes, on top of MIN_SPLASH_MS — without this, a load that already ran
// past the floor would replace "Loading services…" with "Loading complete" for zero perceptible
// time before the window closes.
const READY_DISPLAY_MS = import.meta.env.VITE_E2E_TEST_MODE === 'true' ? 0 : 500
// Keep quick disk reads legible. This does not add to the two-second splash floor; it spreads
// that existing floor across the real work instead of spending nearly all of it on the final
// status. Longer operations still take exactly as long as they need.
const MIN_STEP_MS = import.meta.env.VITE_E2E_TEST_MODE === 'true' ? 0 : 300
const startedAt = Date.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function reportSplashProgress(progress: SplashProgress, work?: () => Promise<unknown>) {
  const stepStartedAt = Date.now()
  if (hasDesktopBackend) await emit('splash:status', progress)
  await work?.()
  if (!hasDesktopBackend) return
  const elapsed = Date.now() - stepStartedAt
  if (elapsed < MIN_STEP_MS) await sleep(MIN_STEP_MS - elapsed)
}

// Custom title bar (see tauri.conf.json's "decorations": false on the main window) — the
// native OS one sat as a redundant second bar above our own app-bar. The maximize icon needs
// to track real window state rather than just flipping on click, since double-clicking the
// drag region or a Windows snap gesture can also change it without going through our button.
const isMaximized = ref(false)
const isBrowserFullscreen = ref(false)
function minimizeWindow() {
  if (hasDesktopBackend) void getCurrentWindow().minimize()
}
function toggleMaximizeWindow() {
  if (hasDesktopBackend) void getCurrentWindow().toggleMaximize()
}
function closeWindow() {
  if (hasDesktopBackend) void getCurrentWindow().close()
}
async function toggleBrowserFullscreen() {
  if (hasDesktopBackend) return
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: 'landscape') => Promise<void>
    unlock?: () => void
  }
  if (document.fullscreenElement) {
    orientation.unlock?.()
    await document.exitFullscreen()
  } else {
    await document.documentElement.requestFullscreen()
    // Orientation locking is intentionally best-effort: browsers that implement it generally
    // require fullscreen first, while desktop browsers and iOS may reject or omit it entirely.
    await orientation.lock?.('landscape').catch(() => undefined)
  }
}

function updateBrowserFullscreen() {
  isBrowserFullscreen.value = !!document.fullscreenElement
}

onMounted(async () => {
  // The splash and main windows are two separate native windows, each running its own
  // independent copy of this same app bundle — a ref set in one has no effect on the other,
  // so real progress has to cross via a Tauri event (same pattern as live:slide-changed for
  // the presentation window) rather than shared reactive state.
  if (isSplashWindow) {
    await listen<SplashProgress>('splash:status', (event) => {
      splashProgress.value = event.payload
    })
    // Whichever webview mounts first, this two-way handshake guarantees that the main window
    // does not send its first (usually very fast) loading step before this listener exists.
    await listen('splash:probe', () => {
      void emit('splash:ready')
    })
    await emit('splash:ready')
    return
  }
  if (isPresentationWindow || isIdentifyWindow) return

  document.addEventListener('keydown', handleSaveShortcut)
  document.addEventListener('keydown', handleHistoryShortcut)

  if (!hasDesktopBackend) {
    updateBrowserFullscreen()
    document.addEventListener('fullscreenchange', updateBrowserFullscreen)
  }

  const thisWindow = hasDesktopBackend ? getCurrentWindow() : undefined
  if (thisWindow) {
    isMaximized.value = await thisWindow.isMaximized()
    await thisWindow.onResized(async () => {
      isMaximized.value = await thisWindow.isMaximized()
    })
  }

  // In E2E builds lib.rs deliberately creates no splash window, so there is nothing to wait
  // for. In normal builds, listening before probing covers both possible webview mount orders.
  if (hasDesktopBackend && import.meta.env.VITE_E2E_TEST_MODE !== 'true') {
    let markSplashReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      markSplashReady = resolve
    })
    const unlistenReady = await listen('splash:ready', () => markSplashReady?.())
    await emit('splash:probe')
    await Promise.race([ready, sleep(1000)])
    unlistenReady()
  }

  await reportSplashProgress({ step: 1, message: 'Loading preferences…' }, () =>
    settingsStore.load(),
  )
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

  await reportSplashProgress({ step: 2, message: 'Checking your library…' }, () =>
    getAdapter().services.migrateLegacySermonFields(),
  )

  await reportSplashProgress({ step: 3, message: 'Loading services…' }, () => servicesStore.load())

  if (hasDesktopBackend) {
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_SPLASH_MS) await sleep(MIN_SPLASH_MS - elapsed)
    await emit('splash:status', { step: 4, message: 'Ready' } satisfies SplashProgress)
    await sleep(READY_DISPLAY_MS)
  }

  // E2E builds never create this window at all (see lib.rs's setup()) — the harness's
  // WebDriver session otherwise raced the splash webview's own faster startup, so avoiding
  // that race here (rather than hiding-not-closing it, which was tried first) is what actually
  // fixed it. For a real launch, this window does exist and must be actually closed, not just
  // hidden — leaving it merely hidden kept the app running after the operator closed the main
  // window, since Tauri won't quit while any window (even a hidden one) is still open.
  if (thisWindow) {
    const splashWindow = await WebviewWindow.getByLabel('splash')
    await splashWindow?.close()
    await thisWindow.show()
    await thisWindow.setFocus()
  }
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', updateBrowserFullscreen)
  document.removeEventListener('keydown', handleSaveShortcut)
  document.removeEventListener('keydown', handleHistoryShortcut)
  if (savedConfirmationTimer) clearTimeout(savedConfirmationTimer)
})
</script>

<template>
  <PresentationView v-if="isPresentationWindow" />
  <IdentifyView v-else-if="isIdentifyWindow" :label="identifyLabel" />
  <v-app v-else-if="isSplashWindow">
    <SplashScreen :status-text="splashProgress.message" :step="splashProgress.step" />
  </v-app>
  <v-app v-else>
    <v-navigation-drawer
      v-if="!isSetupWizard"
      permanent
      :rail="navigationCollapsed"
      :width="224"
      :rail-width="68"
      class="app-nav app-nav-no-print"
      :class="{ 'app-nav--collapsed': navigationCollapsed }"
    >
      <v-list nav density="comfortable" class="pt-2">
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Services' : false"
          to="/"
          title="Services"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-home" color="primary" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Songs' : false"
          to="/library/songs"
          title="Songs"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-bookshelf" color="teal" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Slides' : false"
          to="/library/slides"
          title="Slides"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-image-multiple" color="violet" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Media' : false"
          to="/library/media"
          title="Media"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-file-image-outline" color="rose" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'People' : false"
          to="/people"
          title="People"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-account-multiple" color="amber" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Roles' : false"
          to="/roles"
          title="Roles"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend
            ><v-icon icon="mdi-account-badge-outline" color="terracotta"
          /></template>
        </v-list-item>
        <v-divider class="mx-2 mt-2 mb-1" />
        <v-list-subheader v-if="!navigationCollapsed" class="design-nav-heading">
          Design
        </v-list-subheader>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Templates' : false"
          to="/library/service-templates"
          title="Templates"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-file-tree-outline" color="orange" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Themes' : false"
          to="/library/themes"
          title="Themes"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-palette-outline" color="indigo" /></template>
        </v-list-item>
      </v-list>
      <template #append>
        <v-divider class="mb-2" />
        <v-list nav density="comfortable" class="py-0">
          <v-list-item
            v-tooltip:end="navigationCollapsed ? 'Reports' : false"
            to="/reports"
            title="Reports"
            rounded="lg"
            class="mx-2 mb-1 sidebar-item"
          >
            <template #prepend><v-icon icon="mdi-file-chart-outline" color="secondary" /></template>
          </v-list-item>
          <v-list-item
            v-tooltip:end="navigationCollapsed ? 'Settings' : false"
            to="/settings"
            title="Settings"
            rounded="lg"
            class="mx-2 mb-1 sidebar-item"
          >
            <template #prepend><v-icon icon="mdi-cog" color="slate" /></template>
          </v-list-item>
        </v-list>
      </template>
    </v-navigation-drawer>
    <!-- Always rendered, even during the setup wizard (which hides the sidebar/nav) — this is
         the only window chrome now that decorations are off, so it's what lets the operator
         drag, minimize, or close the window at every point in the app, wizard included. -->
    <v-app-bar order="-1" density="compact" elevation="0" class="app-bar app-bar-no-print">
      <v-btn
        v-if="!isSetupWizard"
        icon="mdi-menu"
        variant="text"
        class="navigation-toggle ml-1"
        :disabled="isNarrowWindow"
        :title="
          isNarrowWindow
            ? 'Widen the window to expand navigation'
            : navigationCollapsed
              ? 'Expand navigation'
              : 'Collapse navigation'
        "
        @click="manualNavCollapsed = !manualNavCollapsed"
      />
      <span class="app-brand" :class="{ 'ml-4': isSetupWizard }">Worship Studio</span>
      <v-divider v-if="pageTitle" vertical inset class="app-brand-divider mx-3" />
      <span v-if="pageTitle" class="page-title">{{ pageTitle }}</span>
      <!-- data-tauri-drag-region only takes effect on the exact element it's applied to (no
           ancestor/child matching), so it has to sit on this actual empty spacer rather than
           the app-bar as a whole — that's what silently made the whole bar undraggable. The
           explicit height is needed too: with no content of its own, the spacer otherwise
           collapses to 0px tall inside the toolbar's flex row, leaving nothing to click. -->
      <v-spacer data-tauri-drag-region class="drag-region-spacer" />
      <template v-if="!isSetupWizard">
        <div v-if="historyStore.active" class="app-history-controls mr-2">
          <v-tooltip
            :text="`${historyStore.undoLabel ? `Undo ${historyStore.undoLabel}` : 'Undo'} (${undoShortcutLabel})`"
            location="bottom end"
            :open-delay="350"
            content-class="app-save-tooltip"
          >
            <template #activator="{ props: tooltipProps }">
              <span v-bind="tooltipProps">
                <v-btn
                  variant="tonal"
                  class="app-history-button"
                  :disabled="!historyStore.canUndo"
                  aria-label="Undo"
                  aria-keyshortcuts="Control+Z Meta+Z"
                  @click="historyStore.undo"
                >
                  <v-icon icon="mdi-undo" size="18" />
                  <span>Undo</span>
                </v-btn>
              </span>
            </template>
          </v-tooltip>
          <v-tooltip
            :text="`${historyStore.redoLabel ? `Redo ${historyStore.redoLabel}` : 'Redo'} (${redoShortcutLabel})`"
            location="bottom end"
            :open-delay="350"
            content-class="app-save-tooltip"
          >
            <template #activator="{ props: tooltipProps }">
              <span v-bind="tooltipProps">
                <v-btn
                  variant="tonal"
                  class="app-history-button"
                  :disabled="!historyStore.canRedo"
                  aria-label="Redo"
                  aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
                  @click="historyStore.redo"
                >
                  <v-icon icon="mdi-redo" size="18" />
                  <span>Redo</span>
                </v-btn>
              </span>
            </template>
          </v-tooltip>
        </div>
        <v-tooltip
          v-if="saveHandler"
          :text="`Save changes (${saveShortcutLabel})`"
          location="bottom end"
          :open-delay="450"
          content-class="app-save-tooltip"
        >
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="app-save-wrap mr-3">
              <v-btn
                variant="tonal"
                color="primary"
                class="app-save-button"
                :class="{ 'app-save-button--dirty': isDirty }"
                :disabled="!isDirty || saving"
                aria-keyshortcuts="Control+S Meta+S"
                @click="runSave"
              >
                <v-progress-circular v-if="saving" indeterminate size="15" width="2" class="mr-2" />
                <v-icon
                  v-else
                  :icon="
                    showSavedConfirmation && !isDirty
                      ? 'mdi-check'
                      : isDirty
                        ? 'mdi-content-save'
                        : 'mdi-content-save-outline'
                  "
                  size="18"
                  class="mr-2"
                />
                {{ saving ? 'Saving…' : showSavedConfirmation && !isDirty ? 'Saved' : 'Save' }}
              </v-btn>
            </span>
          </template>
        </v-tooltip>
        <v-divider v-if="saveHandler" vertical inset class="mr-3" />
        <v-tooltip
          v-if="syncStore.status && !syncStore.status.folderReadable"
          text="Library folder isn't readable — check the sync setup in Settings"
        >
          <template #activator="{ props }">
            <v-icon v-bind="props" icon="mdi-folder-alert-outline" color="error" class="mr-3" />
          </template>
        </v-tooltip>
        <v-btn
          v-if="
            syncStore.status &&
            (syncStore.status.conflictCount > 0 || syncStore.status.recoveryCount > 0)
          "
          to="/sync-conflicts"
          variant="flat"
          :color="syncStore.status.recoveryCount > 0 ? 'error' : 'warning'"
          class="mr-3"
          prepend-icon="mdi-database-alert-outline"
        >
          {{ syncStore.status.conflictCount + syncStore.status.recoveryCount }} library issue{{
            syncStore.status.conflictCount + syncStore.status.recoveryCount === 1 ? '' : 's'
          }}
        </v-btn>
      </template>
      <template v-if="hasDesktopBackend">
        <v-btn
          icon="mdi-window-minimize"
          variant="text"
          size="small"
          class="title-bar-btn"
          @click="minimizeWindow"
        />
        <v-btn
          :icon="isMaximized ? 'mdi-window-restore' : 'mdi-window-maximize'"
          variant="text"
          size="small"
          class="title-bar-btn"
          @click="toggleMaximizeWindow"
        />
        <v-btn
          icon="mdi-window-close"
          variant="text"
          size="small"
          class="title-bar-btn title-bar-close"
          @click="closeWindow"
        />
      </template>
      <v-btn
        v-else
        :icon="isBrowserFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
        variant="text"
        size="small"
        class="browser-fullscreen-btn mr-1"
        :title="isBrowserFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
        :aria-label="isBrowserFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
        @click="toggleBrowserFullscreen"
      />
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
  </v-app>
</template>

<style scoped>
:global(.v-tooltip > .v-overlay__content) {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  background: rgb(var(--v-theme-surface-variant));
  box-shadow: 0 7px 20px rgba(0, 0, 0, 0.32);
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
  font-weight: 650;
}
.app-nav {
  background: rgb(var(--v-theme-surface));
  border-right-color: rgba(var(--v-theme-on-surface), 0.08);
}
.sidebar-item :deep(.v-list-item-title) {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.design-nav-heading {
  min-height: 28px;
  padding-inline: 18px !important;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.app-brand {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.012em;
}
.app-bar {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-surface), 0.97);
}
.app-save-wrap {
  display: inline-flex;
}
.app-history-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.app-history-button {
  min-width: 76px;
  height: 34px;
  padding-inline: 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 7px;
  font-size: 0.76rem;
  font-weight: 620;
  letter-spacing: 0;
  text-transform: none;
  box-shadow: none;
}
.app-history-button .v-icon {
  margin-right: 6px;
}
.app-save-button {
  min-width: 94px;
  height: 34px;
  padding-inline: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 7px;
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: none;
  box-shadow: none;
}
.app-save-button--dirty {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.16);
}
:global(.app-save-tooltip) {
  padding: 7px 10px !important;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 7px !important;
  background: #202833 !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34) !important;
  color: #f5f7fa !important;
  font-size: 0.72rem !important;
  font-weight: 550;
  letter-spacing: 0;
}
@media (max-width: 1180px) {
  .app-history-button {
    min-width: 38px;
    padding-inline: 9px;
  }
  .app-history-button span {
    display: none;
  }
  .app-history-button .v-icon {
    margin-right: 0;
  }
}
.navigation-toggle {
  margin-right: 6px;
  color: rgba(var(--v-theme-on-surface), 0.74);
}
.app-brand-divider {
  opacity: 0.6;
}
.page-title {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.82rem;
  font-weight: 550;
}
.sidebar-item {
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
.sidebar-item.v-list-item--active {
  background: rgba(var(--v-theme-primary), 0.14);
}
.sidebar-item.v-list-item--active::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: rgb(var(--v-theme-primary));
  content: '';
}
.app-nav--collapsed .sidebar-item {
  width: 40px;
  min-height: 40px;
  margin-right: auto !important;
  margin-bottom: 6px !important;
  margin-left: auto !important;
  padding-inline: 8px !important;
  border: 1px solid transparent;
  border-radius: 9px !important;
  grid-template-columns: 24px !important;
  grid-template-areas: 'prepend' !important;
  justify-content: center;
}
.app-nav--collapsed .sidebar-item :deep(.v-list-item__prepend) {
  width: 24px;
  justify-content: center;
}
.app-nav--collapsed .sidebar-item :deep(.v-list-item__prepend .v-list-item__spacer),
.app-nav--collapsed .sidebar-item :deep(.v-list-item__content) {
  display: none;
}
.app-nav--collapsed .sidebar-item :deep(.v-icon) {
  opacity: 0.82;
}
.app-nav--collapsed .sidebar-item:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.055);
}
.app-nav--collapsed .sidebar-item.v-list-item--active {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgba(var(--v-theme-primary), 0.18);
}
.app-nav--collapsed .sidebar-item.v-list-item--active::before {
  display: none;
}
.app-nav--collapsed .sidebar-item.v-list-item--active :deep(.v-icon) {
  opacity: 1;
}
.app-nav--collapsed :deep(.v-list > .v-divider) {
  width: 40px;
  margin-right: auto !important;
  margin-left: auto !important;
}
.app-nav--collapsed :deep(.v-navigation-drawer__append > .v-divider) {
  width: 40px;
  margin-right: auto;
  margin-left: auto;
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
.browser-fullscreen-btn {
  color: rgba(var(--v-theme-on-surface), 0.72);
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
