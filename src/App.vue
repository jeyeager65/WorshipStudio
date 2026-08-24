<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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
import { useTabletSync } from '@/composables/useTabletSync'
import { usePwaUpdate } from '@/composables/usePwaUpdate'
import { useTauriUpdate } from '@/composables/useTauriUpdate'
import { formatSyncProgressLabel } from '@/utils/syncProgress'
import { logger } from '@/utils/logger'
import appIcon from '@/assets/app-icon.png'

useTabletSync()
const pwaUpdate = usePwaUpdate()
const tauriUpdate = useTauriUpdate()

const { blockedMessage, isPresenting } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler, pageTitleOverride, navCollapseRequested } = storeToRefs(
  useUnsavedChangesStore(),
)
const syncStore = useSyncStore()
const settingsStore = useSettingsStore()
const servicesStore = useServicesStore()
const historyStore = useHistoryStore()
const isTabletBuild = getAdapter().kind === 'tablet'
const hasDesktopBackend = getAdapter().kind === 'tauri'

// The app-bar sync icon is the only always-visible feedback that an automatic background sync
// (useTabletSync.ts) is even running — a bare spinner gave no sense of whether it was doing
// anything or stuck, especially over a slow connection with a large pending batch. Built from
// syncStore.progress, which stores/sync.ts polls from cloudSync.ts's in-memory state while a sync
// is in flight.
const syncProgressLabel = computed(() => formatSyncProgressLabel(syncStore.progress))

const syncTooltipText = computed(() => {
  if (syncStore.syncing) return syncProgressLabel.value || 'Syncing…'
  if (syncStore.status?.lastSyncedAt)
    return `Last synced ${new Date(syncStore.status.lastSyncedAt).toLocaleTimeString()}`
  return 'Not synced yet'
})

// App-wide banner for syncStore.status.needsReconnect, below — the app-bar icon above is easy to
// miss (a small, passive tooltip-only affordance), and this device's reconnect can only ever be
// silent-or-not on app open/focus (useTabletSync.ts), not something the operator gets an active
// prompt for otherwise. A persistent bottom snackbar matches the update banners' own pattern
// (never auto-dismisses, hidden while presenting) so this is genuinely hard to miss without being
// disruptive — reusing the same one-tap reconnectCloud() as LibrarySyncSection.vue (now shared
// via useSyncStore) rather than a second copy of the redirect logic.
const reconnectBannerText = computed(() => {
  const count = syncStore.status?.pendingPushCount
  const provider = settingsStore.machineSettings?.tabletCloudProvider === 'onedrive' ? 'OneDrive' : 'Dropbox'
  const changesNote = count ? ` ${count} change${count === 1 ? '' : 's'} waiting to sync.` : ''
  return `This device needs to reconnect to ${provider}.${changesNote}`
})
function reconnectCloudFromBanner() {
  const machineSettings = settingsStore.machineSettings
  const clientId = machineSettings?.tabletCloudClientId
  if (!clientId) return
  void syncStore.reconnectCloud(
    machineSettings?.tabletCloudProvider ?? 'dropbox',
    clientId,
    machineSettings?.tabletCloudLibraryFolderPath ?? '',
  )
}

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

// Below this width even a collapsed rail (68px) eats space content-heavy routed views can't
// spare (e.g. ServiceWorkspaceView.vue's own tablet breakpoints) — matches Vuetify's own `md`
// breakpoint, the usual point content-heavy layouts start feeling cramped. Below it the nav
// becomes a fully-hidden, hamburger-toggled overlay instead of a permanent rail; at/above it,
// unchanged permanent-drawer/rail-toggle behavior.
const { width } = useDisplay()
const isNarrowWindow = computed(() => width.value < 960)
const manualNavCollapsed = ref(false)
// Rail-collapse is only a meaningful concept in permanent mode — below isNarrowWindow the drawer
// is a temporary overlay instead (see navDrawerOpenNarrow below), always shown at full width
// with labels when open, never collapsed to a rail. navCollapseRequested (unsavedChanges.ts) lets
// a specific content-heavy page ask for the rail below a wider threshold than 960px — see that
// store's own doc comment.
const navigationCollapsed = computed(
  () => !isNarrowWindow.value && (manualNavCollapsed.value || navCollapseRequested.value),
)
const navDrawerOpenNarrow = ref(false)
// The drawer's actual model-value: always true when not narrow (a permanent drawer that's
// visually always open), otherwise follows the hamburger-toggled overlay state. Bound explicitly
// rather than relying on `permanent` alone to keep the drawer visible regardless of model-value —
// safer than assuming that interaction, and it's what actually broke the drawer entirely (at any
// width) when this was left implicit.
const navDrawerVisible = computed({
  get: () => !isNarrowWindow.value || navDrawerOpenNarrow.value,
  set: (value: boolean) => {
    navDrawerOpenNarrow.value = value
  },
})
// Picking a destination from the overlay drawer should close it (it's covering the page the
// operator just navigated to) — permanent/rail mode is unaffected, it ignores this state.
watch(
  () => route.fullPath,
  () => {
    navDrawerOpenNarrow.value = false
  },
)
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

// Resolves to whatever the current route declared (router/index.ts's meta.helpTopic), falling
// back to the help site's own homepage for the rare route that doesn't have one yet.
const helpTopic = computed(() => route.meta.helpTopic ?? 'index')
function openHelp() {
  const [slug, anchor] = helpTopic.value.split('#')
  if (hasDesktopBackend) {
    getAdapter()
      .help.open?.(helpTopic.value)
      .catch((error) => console.error('Failed to open help window:', error))
    return
  }
  // No native help window in the browser build — the help site isn't bundled here the way it
  // is in the Tauri app. On the real GitHub Pages deploy the web/tablet app is served one level
  // under the help site's own root (see release.yml's deploy-pages job), so a relative
  // `../<topic>.html` reaches it correctly in a new tab; in plain local `pnpm dev` there's no
  // sibling help build to reach at all, so this just 404s there (same accepted gap as the help
  // site's own "Try the Web Demo" button, which only resolves for real once actually deployed).
  window.open(`../${slug}.html${anchor ? `#${anchor}` : ''}`, '_blank', 'noopener')
}
function handleHelpShortcut(event: KeyboardEvent) {
  if (event.key !== 'F1') return
  event.preventDefault()
  openHelp()
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

// Feels more like a native desktop app without the browser's own right-click menu (Inspect,
// Reload, etc.) showing up over it.
function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
}

onMounted(async () => {
  // Registered before any of the window-type branching below (splash/presentation/identify all
  // return early out of the rest of this function) so every window this component renders in
  // gets it, not just the main operator window. Tauri-only — the browser/mock demo keeps the
  // default context menu, which is genuinely useful there (e.g. Inspect while debugging it).
  if (hasDesktopBackend) document.addEventListener('contextmenu', handleContextMenu)

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

  logger.info('startup', `Worship Studio starting (adapter: ${getAdapter().kind})`)

  document.addEventListener('keydown', handleSaveShortcut)
  document.addEventListener('keydown', handleHistoryShortcut)
  document.addEventListener('keydown', handleHelpShortcut)

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

  await reportSplashProgress({ step: 2, message: 'Loading services…' }, () => servicesStore.load())

  if (hasDesktopBackend) {
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_SPLASH_MS) await sleep(MIN_SPLASH_MS - elapsed)
    await emit('splash:status', { step: 3, message: 'Ready' } satisfies SplashProgress)
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
  document.removeEventListener('contextmenu', handleContextMenu)
  document.removeEventListener('fullscreenchange', updateBrowserFullscreen)
  document.removeEventListener('keydown', handleSaveShortcut)
  document.removeEventListener('keydown', handleHistoryShortcut)
  document.removeEventListener('keydown', handleHelpShortcut)
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
      v-model="navDrawerVisible"
      :permanent="!isNarrowWindow"
      :temporary="isNarrowWindow"
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
          <template #prepend><v-icon icon="mdi-church-outline" color="primary" /></template>
        </v-list-item>
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Songs' : false"
          to="/library/songs"
          title="Songs"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-music-note" color="teal" /></template>
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
        <v-list-item
          v-tooltip:end="navigationCollapsed ? 'Announcements' : false"
          to="/announcements"
          title="Announcements"
          rounded="lg"
          class="mx-2 mb-1 sidebar-item"
        >
          <template #prepend><v-icon icon="mdi-bullhorn-outline" color="teal" /></template>
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
        :title="
          isNarrowWindow
            ? navDrawerOpenNarrow
              ? 'Close navigation'
              : 'Open navigation'
            : navigationCollapsed
              ? 'Expand navigation'
              : 'Collapse navigation'
        "
        @click="
          isNarrowWindow
            ? (navDrawerOpenNarrow = !navDrawerOpenNarrow)
            : (manualNavCollapsed = !manualNavCollapsed)
        "
      />
      <span class="app-brand" :class="{ 'ml-4': isSetupWizard }">
        <img :src="appIcon" alt="" class="app-brand-icon" />
        <span class="app-brand-text">Worship Studio</span>
      </span>
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
        <!-- Tablet-only — the only build where sync is something happening in the background the
             operator can't otherwise see. Automatic syncs (useTabletSync.ts) are invisible
             without this: no other feedback exists that one is even running, and this is the one
             place visible from every page, not just Settings > Library & Sync. -->
        <v-tooltip
          v-if="isTabletBuild && syncStore.status?.needsReconnect"
          text="This device needs to reconnect — see Settings > Library & Sync"
        >
          <template #activator="{ props }">
            <v-icon v-bind="props" icon="mdi-cloud-alert-outline" color="warning" class="mr-3" />
          </template>
        </v-tooltip>
        <!-- A menu rather than a plain tooltip so "force a sync right now" is reachable from
             every page, not just Settings > Library & Sync (LibrarySyncSection.vue's own "Sync
             Now" button, which this reuses via the same syncStore.runSync()). -->
        <v-menu v-else-if="isTabletBuild" location="bottom">
          <template #activator="{ props }">
            <!-- Progress text is shown inline, not just on open — this runs on touchscreen
                 tablets, where a hover-only tooltip is effectively invisible. -->
            <div v-bind="props" class="sync-indicator mr-3">
              <v-icon
                :icon="syncStore.syncing ? 'mdi-cloud-sync-outline' : 'mdi-cloud-check-outline'"
                :class="{ 'sync-spin': syncStore.syncing }"
              />
              <span v-if="syncStore.syncing && syncProgressLabel" class="sync-progress-text">{{
                syncProgressLabel
              }}</span>
            </div>
          </template>
          <v-card min-width="200" class="pa-3">
            <div class="text-body-2 text-medium-emphasis mb-2">{{ syncTooltipText }}</div>
            <v-btn
              variant="tonal"
              size="small"
              block
              :loading="syncStore.syncing"
              :disabled="syncStore.syncing"
              prepend-icon="mdi-sync"
              @click="syncStore.runSync()"
            >
              Sync Now
            </v-btn>
          </v-card>
        </v-menu>
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
      <v-btn
        icon="mdi-help-circle-outline"
        variant="text"
        size="small"
        class="mr-1"
        title="Help (F1)"
        aria-label="Help"
        aria-keyshortcuts="F1"
        @click="openHelp"
      />
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
    <!-- scrollable: keeps the outer document itself non-scrolling (see index.html's matching
         `overflow: hidden` on html/body) so the app-bar/nav — position:absolute layout items
         within that same document — stay visually pinned instead of getting dragged along by
         the document's own scroll/rubber-band. Without this the whole page was one scrolling
         region, so the native scrollbar ran the full page height through the app-bar, and iOS
         Safari's elastic overscroll at the top could bounce page content above the app-bar into
         the physical status-bar area. -->
    <v-main scrollable>
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

    <!-- Never auto-applies (timeout="-1", no dismiss-on-click-away) — an update reloads the page,
         which would lose an in-progress edit or interrupt a live presentation if it happened on
         its own. The operator applies it when it's actually a safe moment to. -->
    <v-snackbar
      v-if="!hasDesktopBackend"
      :model-value="pwaUpdate.needRefresh.value"
      color="info"
      timeout="-1"
      location="bottom"
    >
      A new version of Worship Studio is available.
      <template #actions>
        <v-btn variant="text" @click="pwaUpdate.applyUpdate">Update Now</v-btn>
      </template>
    </v-snackbar>

    <!-- Same "never surprise mid-service" rule as the PWA snackbar above, and stricter about it:
         a Tauri update needs a full app restart, not just a page reload, so this stays hidden
         entirely while presenting even if an update was already found before presenting started
         — not just skipping the background check (useTauriUpdate.ts), but never tempting a tap
         here either. -->
    <v-snackbar
      v-if="hasDesktopBackend"
      :model-value="tauriUpdate.updateAvailable && !isPresenting"
      color="info"
      timeout="-1"
      location="bottom"
    >
      A new version of Worship Studio is available.
      <template #actions>
        <v-btn variant="text" :loading="tauriUpdate.applying" @click="tauriUpdate.applyUpdate">
          Update Now
        </v-btn>
      </template>
    </v-snackbar>

    <v-snackbar
      v-if="isTabletBuild"
      :model-value="!!syncStore.status?.needsReconnect && !isPresenting"
      color="warning"
      timeout="-1"
      location="bottom"
    >
      {{ reconnectBannerText }}
      <template #actions>
        <v-btn
          variant="text"
          :loading="syncStore.reconnectingCloud"
          @click="reconnectCloudFromBanner"
        >
          Reconnect
        </v-btn>
      </template>
    </v-snackbar>

    <ConfirmDialog />
  </v-app>
</template>

<style scoped>
/* Vuetify measures the app-bar's real rendered height (safe-area padding included, density-
   aware — never a hardcoded guess) into --v-layout-top on this element, .v-main--scrollable —
   but resets that variable back to 0px on its own child .v-main__scroller (and thus every view
   rendered inside it), so a genuinely *nested* layout wouldn't double-count the offset. A page
   whose own sticky sidebar needs a real fixed height to independently scroll within (e.g.
   SettingsView.vue's nav column) captures the real value here, under a name Vuetify's reset
   doesn't touch, so it keeps working however tall the app-bar actually renders. */
:global(.v-main--scrollable) {
  --app-bar-height: var(--v-layout-top);
}
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
/* worshipLight's own `surface` (near-white) sits only ~4% off the page `background` behind it —
 * barely perceptible, so nav/app-bar read as flat white rather than a distinct chrome region
 * (worshipDark's surface/background pairing has enough contrast for this not to be an issue,
 * so it's left alone). Tried a primary-blue tint here first (matching the .app-bar rule below)
 * but it competed with the nav items' own already-colorful icons rather than complementing
 * them — settled on the same neutral surface-variant gray as .app-bar instead, so the two
 * chrome regions read as one cohesive frame and the color story stays with the icons/selection
 * state rather than the panel backgrounds. */
.v-theme--worshipLight .app-nav {
  background: rgb(var(--v-theme-surface-variant));
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.012em;
}
.app-brand-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
}
/* Same width isNarrowWindow already treats as "tight" (forces the nav to an overlay) — the
   brand text is purely decorative once space is already this constrained, but the icon alone
   still identifies the app. The page title (the current route's name, e.g. "Services") and its
   divider go with it — space is too tight here to keep either, and a lone divider with nothing
   after it would look like a stray rendering glitch. */
@media (max-width: 960px) {
  .app-brand-text,
  .app-brand-divider,
  .page-title {
    display: none;
  }
}
.app-bar {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-surface), 0.97);
}
.sync-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sync-progress-text {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  white-space: nowrap;
}
.sync-spin {
  animation: sync-spin-rotate 1.4s linear infinite;
}
@keyframes sync-spin-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
/* Light mode only, same as .app-nav above, but the neutral surface-variant gray rather than the
 * primary tint the sidebar uses (swapped per feedback) — the two chrome regions still read as
 * distinct from the white content area and from each other, without both competing for
 * attention as "the colored one." `surface-variant` is already a real token in the light
 * palette (src/plugins/themeTokens.ts) for exactly this. */
.v-theme--worshipLight .app-bar {
  background: rgb(var(--v-theme-surface-variant));
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
  /* Vuetify defaults an icon prepend's gap to 32px (see VListItem.css's --v-list-prepend-gap) —
     more room than these short nav labels need, and "Announcements" in particular doesn't fit
     without it. */
  --v-list-prepend-gap: 20px;
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

/* Report screens (e.g. SongUsageReportView) use the browser/OS "print to PDF" flow rather than a
   bundled PDF library — the persistent app-bar has to disappear for that printout too, not
   just whatever a report screen hides within its own content area. */
@media print {
  .app-bar-no-print,
  .app-nav-no-print {
    display: none !important;
  }
}
</style>
