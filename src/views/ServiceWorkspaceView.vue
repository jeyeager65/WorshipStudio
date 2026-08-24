<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { convertFileSrc } from '@tauri-apps/api/core'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import EditorNotFoundState from '@/components/EditorNotFoundState.vue'
import ExternalAppFailureAlert from '@/components/service-workspace/ExternalAppFailureAlert.vue'
import ServiceDetailsDialog from '@/components/service-workspace/ServiceDetailsDialog.vue'
import ReadinessDialog from '@/components/service-workspace/ReadinessDialog.vue'
import LiveTransportBar from '@/components/service-workspace/LiveTransportBar.vue'
import AudiencePresentationDialog from '@/components/service-workspace/AudiencePresentationDialog.vue'
import AddServiceItemDialog, {
  type AddItemType,
} from '@/components/service-workspace/AddServiceItemDialog.vue'
import ServiceOrderList from '@/components/service-workspace/ServiceOrderList.vue'
import PropertyInspector from '@/components/service-workspace/PropertyInspector.vue'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import type { ScriptureReferenceValue } from '@/components/ScriptureReferencePicker.vue'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { useMediaStore } from '@/stores/media'
import { useThemesStore } from '@/stores/themes'
import { useExternalAppsStore } from '@/stores/externalApps'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { usePeopleStore } from '@/stores/people'
import { useSyncStore } from '@/stores/sync'
import { flattenService, type FlatSlide } from '@/utils/flattenService'
import { colorForBlockLabel, colorForItemType } from '@/utils/contentColors'
import { findSermonItem, sermonMainReference, sermonPreacherId } from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'
import { returnPath, routeWithReturnTo } from '@/utils/returnNavigation'
import { errorMessage as asyncErrorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { useExternalAppHandoff } from '@/composables/useExternalAppHandoff'
import { useLiveTransport } from '@/composables/useLiveTransport'
import { evaluateServiceReadiness, type ReadinessIssue } from '@/utils/serviceReadiness'
import { personOptionsForRole } from '@/utils/personOptions'
import { roleOptionsFor } from '@/utils/roleOptions'
import type { SermonPassage, Service, ServiceItem } from '@/models/service'
import type { Song, SongBlock } from '@/models/song'
import type { LibrarySlide, PresentationThemeTarget } from '@/models/library'
import { personFormalName } from '@/models/library'
import { scenePlainText } from '@/utils/slideScene'
import {
  isPresentationThemeAvailableFor,
  isPresentationThemeDefaultFor,
  presentationThemeTargetForItem,
  resolvePresentationTheme,
} from '@/utils/presentationTheme'
import type { ScripturePassage, ScriptureTranslation } from '@/adapters/types'

const route = useRoute()
const router = useRouter()
const backTo = computed(() => returnPath(route.query.returnTo, '/'))
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const mediaStore = useMediaStore()
const themesStore = useThemesStore()
const externalAppsStore = useExternalAppsStore()
const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()
const songCollectionsStore = useSongCollectionsStore()
const peopleStore = usePeopleStore()
const syncStore = useSyncStore()
const { isPresenting } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler, navCollapseRequested } = storeToRefs(
  useUnsavedChangesStore(),
)
const confirmDialog = useConfirmDialogStore()

// Responsive breakpoints for this view's own toolbar/layout, chosen against real device CSS
// viewport measurements (iPad 9th gen ~1080x810 landscape/~810x1080 portrait, Galaxy Tab S7+
// ~1064x664 landscape/~664x1064 portrait) rather than arbitrary numbers — see the tablet-fit
// plan for the full reasoning behind each one.
const { width, height, mdAndDown: isPreviewCompact } = useDisplay()
// Below a wider threshold than isNarrowActions below, ask App.vue's nav to give up its rail
// labels rather than this view giving up the Service Order List column — reclaiming the nav's
// own space is worth more here than what collapsing it costs elsewhere. Registered/cleared the
// same way pageTitleOverride is (unsavedChanges.ts) — see that store's own doc comment. This one
// is deliberately still keyed off the raw window width (not toolbarWidth below) — it's asking
// for room back from the nav, so it can't itself depend on how much room the nav is giving.
const wantsNavCollapsed = computed(() => width.value < 1500)
watch(wantsNavCollapsed, (wants) => (navCollapseRequested.value = wants), { immediate: true })
onUnmounted(() => {
  navCollapseRequested.value = false
})
// The toolbar's own rendered width, not the window's — window width is a poor proxy here since
// App.vue's nav rail can be a full labeled drawer, a collapsed 68px rail, or fully hidden
// depending on both window width and the operator's own manual toggle, so the same window width
// can leave this toolbar very different amounts of room. Everything below reads this instead of
// the raw `width` above, so the compacting cascade tracks what the toolbar can actually fit
// rather than a window-width number that only loosely correlates with it.
const toolbarRef = ref<HTMLElement>()
const toolbarWidth = ref(1024)
let toolbarResizeObserver: ResizeObserver | undefined
// The toolbar sits behind `v-else-if="service"` further down, which only starts rendering once
// the service finishes its own async load — plain onMounted runs well before that, so
// toolbarRef.value would still be unset and .observe() would silently watch nothing, forever.
// Watching the ref directly instead fires exactly when Vue actually attaches the real element.
watch(toolbarRef, (el) => {
  if (!el || typeof ResizeObserver === 'undefined') return
  toolbarResizeObserver ??= new ResizeObserver(([entry]) => {
    if (entry) toolbarWidth.value = entry.contentRect.width
  })
  toolbarResizeObserver.observe(el)
})
onUnmounted(() => toolbarResizeObserver?.disconnect())
// Planning/Assignments/Bulletin collapse into an overflow menu below this width. Deliberately
// generous — three full buttons are by far the biggest space cost in this row (~350px+), so
// giving them up first, well before the row is actually tight, is what leaves the title enough
// room instead of both staying full-size while the title gets crushed to a couple characters.
const isNarrowActions = computed(() => toolbarWidth.value < 1200)
// The toolbar's service-context and actions rows collide below this width without wrapping.
const isNarrowToolbar = computed(() => toolbarWidth.value < 700)
// First line of defense before isNarrowToolbar's wrap — trade the readiness badge and present
// button's own text for icon-only versions so a single row keeps fitting a bit longer.
const isCompactActions = computed(() => toolbarWidth.value < 820)
// Toolbar/heading chrome eats too much of a short landscape-tablet viewport below this height.
const isShortViewport = computed(() => height.value < 700)
// The Service Order List becomes a drawer at a narrower width than the preview panel does
// (isPreviewCompact, Vuetify's mdAndDown/1280px) — the order list is what the operator actually
// needs open most of the time, so it should give up its permanent column later (i.e. survive
// down to a narrower width) than the preview panel, rather than both vanishing together. Chosen
// so both target tablets' landscape widths (iPad ~1080px, Tab S7+ ~1064px) sit above this and
// below isPreviewCompact — order list permanent, preview a drawer, in landscape on both devices.
const isOrderCompact = computed(() => width.value < 1000)

// Below their respective thresholds above, the Service Order List and preview panel become
// toggleable overlay drawers instead of permanent grid columns — a single ref (rather than two
// booleans) gives mutual exclusivity for free, since opening one always replaces whatever the
// other held. (isOrderCompact is always true whenever isPreviewCompact is, since 1000 < 1280, so
// "order open while preview permanent" never needs handling.)
type WorkspaceDrawer = 'order' | 'preview'
const openDrawer = ref<WorkspaceDrawer | null>(null)
function toggleWorkspaceDrawer(drawer: WorkspaceDrawer) {
  openDrawer.value = openDrawer.value === drawer ? null : drawer
}
// Window widened back past a threshold (resize, rotation) — don't leave that drawer's state
// stuck open once it's no longer a drawer at all.
watch(isOrderCompact, (compact) => {
  if (!compact && openDrawer.value === 'order') openDrawer.value = null
})
watch(isPreviewCompact, (compact) => {
  if (!compact && openDrawer.value === 'preview') openDrawer.value = null
})
function onWorkspaceDrawerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openDrawer.value) openDrawer.value = null
}
onMounted(() => window.addEventListener('keydown', onWorkspaceDrawerKeydown))
onUnmounted(() => window.removeEventListener('keydown', onWorkspaceDrawerKeydown))

const service = ref<Service>()
const serviceTypeName = computed(
  () =>
    serviceTypesStore.serviceTypes.find((t) => t.id === service.value?.serviceTypeId)?.name ?? '',
)
const workspaceLoading = ref(true)
const workspaceLoadError = ref('')
const notFound = ref(false)
const documentHistory = useDocumentHistory(service, 'service')
const selectedItemIndex = ref(0)
// Operator picked a different item while the order-list drawer was open — reveal the editor
// they came for instead of leaving it covered.
watch(selectedItemIndex, () => {
  if (openDrawer.value === 'order') openDrawer.value = null
})

const serviceDetailsDialogOpen = ref(false)

const preacherName = computed(() => {
  const currentService = service.value
  if (!currentService) return undefined
  const person = peopleStore.people.find((p) => p.id === sermonPreacherId(currentService))
  return person ? personFormalName(person) : undefined
})
// Matches the "weekday, month day, year" format already used for the Order of Worship export
// and planning report headers (see utils/orderOfWorship.ts/planningReport.ts) — one consistent
// date presentation across the app instead of the raw "YYYY-MM-DD" stored on disk.
const serviceDateLabel = computed(() => {
  if (!service.value) return ''
  const date = new Date(`${service.value.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const time = formatServiceTime(service.value.time)
  return time ? `${date} · ${time}` : date
})
// Same combine-and-skip-blanks pattern as ServiceCard's own subtitle line.
const serviceSubtitle = computed(() => {
  if (!service.value) return ''
  const sermonItem = findSermonItem(service.value)
  const passage = sermonItem ? sermonMainReference(sermonItem) : ''
  return [sermonItem?.title, passage, preacherName.value].filter(Boolean).join(' · ')
})

const addDialogOpen = ref(false)

// A rejected Tauri invoke() surfaces its Rust Err(String) payload as a plain JS string, not an
// Error instance — `e instanceof Error` is always false for it, silently discarding the real
// message in favor of a generic fallback. Every catch block below that talks to the backend
// needs to handle both shapes.
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

// Resolved scripture passages, keyed by service item id — reactive() rather than ref() so
// Map.set()/.delete() are tracked directly without reassigning the whole map.
const scriptureById = reactive(new Map<string, ScripturePassage>())
const scriptureErrors = reactive(new Map<string, string>())

async function resolvePassage(key: string, reference: string, translation: string) {
  try {
    const passage = await getAdapter().scripture.resolve(reference, translation)
    scriptureById.set(key, passage)
    scriptureErrors.delete(key)
  } catch (e) {
    scriptureErrors.set(key, errorMessage(e, 'Failed to resolve passage.'))
  }
}

// A `scripture` item resolves under its own id; a `sermon` item can hold several passages, so
// each resolves under a composite `itemId:passageId` key in the same maps instead.
async function resolveScriptureItem(item: ServiceItem) {
  if (item.type === 'scripture') {
    if (item.displayMode === 'reference-only') return
    await resolvePassage(item.id, item.reference, item.translation)
  } else if (item.type === 'sermon') {
    await Promise.all(
      item.passages
        .filter((passage) => passage.displayMode !== 'reference-only')
        .map((passage) =>
          resolvePassage(`${item.id}:${passage.id}`, passage.reference, passage.translation),
        ),
    )
  }
}

// Switching translations after the item's already been added — e.g. the operator originally
// picked KJV and now wants ESV instead — re-resolves in place rather than requiring a
// delete-and-re-add, same as any other post-add edit already possible in this view.
async function updateScriptureTranslation(itemId: string, translation: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'scripture') return
  item.translation = translation
  await resolveScriptureItem(item)
}
async function updateSermonPassageTranslation(
  itemId: string,
  passageId: string,
  translation: string,
) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const passage = item.passages.find((p) => p.id === passageId)
  if (!passage) return
  passage.translation = translation
  if (passage.displayMode !== 'reference-only')
    await resolvePassage(`${itemId}:${passageId}`, passage.reference, translation)
}

// Switching to/from reference-only after the item's already been added — same "re-resolve in
// place" reasoning as translation above. Switching TO 'full' needs a fresh resolve, since
// reference-only never resolves verse text in the first place.
async function updateScriptureDisplayMode(itemId: string, displayMode: 'full' | 'reference-only') {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'scripture') return
  item.displayMode = displayMode
  if (displayMode === 'full') await resolveScriptureItem(item)
}
async function updateSermonPassageDisplayMode(
  itemId: string,
  passageId: string,
  displayMode: 'full' | 'reference-only',
) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const passage = item.passages.find((p) => p.id === passageId)
  if (!passage) return
  passage.displayMode = displayMode
  if (displayMode === 'full')
    await resolvePassage(`${itemId}:${passageId}`, passage.reference, passage.translation)
}

// Resolved media file src, keyed by MediaItem id (not service item id — several service items
// could reuse the same media). getFilePath is a real Rust round trip (only the Rust side
// knows library_root/local_media_root), so this can't happen inside flattenService's
// otherwise-synchronous walk — resolved once up front instead, same pattern as scripture above.
// getFilePath is Tauri-only; every adapter (including mock and the web build) still implements
// getPreviewUrl, so that's the fallback rather than silently never resolving anything.
const mediaUrlById = reactive(new Map<string, string>())
const mediaErrors = reactive(new Map<string, string>())

async function resolveMediaItem(mediaId: string) {
  if (mediaUrlById.has(mediaId)) return
  try {
    const adapter = getAdapter()
    const url = adapter.media.getFilePath
      ? convertFileSrc(await adapter.media.getFilePath(mediaId))
      : await adapter.media.getPreviewUrl(mediaId)
    if (url) mediaUrlById.set(mediaId, url)
    mediaErrors.delete(mediaId)
  } catch (e) {
    mediaErrors.set(mediaId, errorMessage(e, 'Failed to load media file.'))
  }
}

onMounted(async () => {
  if (!songsStore.loaded) await songsStore.load()
  if (!slidesStore.loaded) await slidesStore.load()
  if (!mediaStore.loaded) await mediaStore.load()
  if (!themesStore.loaded) await themesStore.load()
  if (!externalAppsStore.loaded) await externalAppsStore.load()
  if (!peopleStore.loaded) await peopleStore.load()
  if (!settingsStore.loaded) await settingsStore.load()
  if (!serviceTypesStore.loaded) await serviceTypesStore.load()
  if (!roleGroupsStore.loaded) await roleGroupsStore.load()
  if (!rolesStore.loaded) await rolesStore.load()
  if (!songCollectionsStore.loaded) await songCollectionsStore.load()
  const dependencyLoadError =
    songsStore.loadError ||
    slidesStore.loadError ||
    mediaStore.loadError ||
    themesStore.loadError ||
    externalAppsStore.loadError ||
    peopleStore.loadError ||
    settingsStore.loadError ||
    serviceTypesStore.loadError ||
    roleGroupsStore.loadError ||
    rolesStore.loadError ||
    songCollectionsStore.loadError
  if (dependencyLoadError) {
    workspaceLoadError.value = dependencyLoadError
    workspaceLoading.value = false
    return
  }
  // A just-created service arrives via the store instead of disk — see CreateServiceView —
  // so it's never persisted until Save is actually pressed.
  const isDraft = servicesStore.draftService?.id === route.params.id
  if (isDraft) {
    service.value = servicesStore.draftService
    servicesStore.draftService = undefined
  } else {
    try {
      service.value = await getAdapter().services.get(route.params.id as string)
    } catch (error) {
      workspaceLoadError.value = asyncErrorMessage(error)
      workspaceLoading.value = false
      return
    }
  }
  if (!service.value) {
    notFound.value = true
    workspaceLoading.value = false
    return
  }
  // A freshly created service is inherently unsaved — starting dirty (rather than false, as
  // for an existing service) enables the Save button and the router guard's
  // leave-without-saving warning immediately, so it's never silently lost with no way to
  // recover it.
  isDirty.value = isDraft
  // Start history after loading so the persisted service is the baseline. Live transport
  // state is held outside the service document and therefore never becomes an undo step.
  documentHistory.start((dirty) => (isDirty.value = dirty), isDraft)
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveService

  // Scripture resolution isn't wired to a real command on the native Tauri backend yet
  // (README's adapter-status note) — best-effort and last, so a rejected invoke() here can
  // never take down the wiring above it and silently break Save for every service.
  try {
    // "English Standard Version (ESV)" rather than just the full name — makes the abbreviation
    // shown elsewhere (the slide footer, the required ESV attribution tag) recognizable here
    // too, instead of only spelled out in full.
    scriptureTranslations.value = (await getAdapter().scripture.listTranslations()).map((t) => ({
      ...t,
      name: `${t.name} (${t.code})`,
    }))
    const defaultCode = settingsStore.librarySettings?.defaultTranslationCode
    const defaultAvailable = scriptureTranslations.value.some((t) => t.code === defaultCode)
    // Seeds the Scripture tab's initial translation choice — ScriptureReferencePicker falls
    // back to the first available translation itself if this is left unset, but the church's
    // configured default (if any) should win over an arbitrary first-in-list one.
    if (defaultAvailable && defaultCode) scriptureDraft.value.translation = defaultCode
    else if (scriptureTranslations.value.length > 0)
      scriptureDraft.value.translation = scriptureTranslations.value[0].code
    await Promise.all((service.value?.items ?? []).map(resolveScriptureItem))
  } catch (e) {
    console.error('Failed to load scripture translations/passages:', e)
  }

  const mediaIds = (service.value?.items ?? [])
    .filter((item) => item.type === 'media' || item.type === 'video')
    .map((item) => item.mediaId)
  const themeMediaIds = themesStore.themes
    .map((theme) => theme.backgroundId)
    .filter((id): id is string => !!id && id !== 'brand-primary' && id !== 'brand-secondary')
  await Promise.all([...new Set([...mediaIds, ...themeMediaIds])].map(resolveMediaItem))
  workspaceLoading.value = false
  // Only now does the template actually switch from <AsyncLoadState> to the real workspace (see
  // `v-if="workspaceLoading || workspaceLoadError"` above it) and render .preview-panel — calling
  // this any earlier (as it used to, right after loading the service itself) found nothing to
  // observe, since the element didn't exist in the DOM yet, and this is only ever called once.
  await nextTick()
  observePreviewPanel()
})

function reloadWorkspace() {
  window.location.reload()
}
onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveService() {
  if (!service.value || saving.value) return
  saving.value = true
  try {
    await servicesStore.save(service.value)
    isDirty.value = false
    // Saving a service silently updates any of its songs' usage stats on the backend (see
    // songs::recompute_usage) — refresh the shared songs store so that shows up immediately
    // (e.g. on the Songs list) rather than only after some unrelated reload.
    await songsStore.load()
  } finally {
    saving.value = false
  }
}

const songsById = computed(() => new Map(songsStore.songs.map((song) => [song.id, song])))
const slidesById = computed(() => new Map(slidesStore.slides.map((item) => [item.id, item])))
const mediaById = computed(() => new Map(mediaStore.items.map((item) => [item.id, item])))
const externalAppProfilesById = computed(
  () => new Map(externalAppsStore.profiles.map((profile) => [profile.id, profile])),
)
// False on a device that can never launch an external app at all (web/tablet — no `launch`
// method on this adapter's port), as opposed to one that can launch but isn't set up for this
// particular profile yet. Drives both the readiness warning (see the readiness computed below)
// and the live-item panel's own note in place of dead Reopen/Close/Launch Now buttons.
const externalAppLaunchAvailable = computed(() => !!getAdapter().externalApps.launch)
// The always-present manual buttons (spec section 12's Basic Remote Controls) for whichever
// external-app item is currently selected — every command with a real keyCombo, regardless of
// whether it also has a triggerKey. The phone Remote Control shows the same set (see
// useLiveTransport.ts's pushRemoteLiveState).
const selectedItemExternalAppCommands = computed(() => {
  if (!selectedItem.value || selectedItem.value.type !== 'external-app') return []
  return (
    externalAppProfilesById.value
      .get(selectedItem.value.profileId)
      ?.keyCommands.filter((command) => command.keyCombo.trim()) ?? []
  )
})
const peopleById = computed(() => new Map(peopleStore.people.map((person) => [person.id, person])))
const readiness = computed(() =>
  service.value
    ? evaluateServiceReadiness(service.value, {
        songs: songsById.value,
        slides: slidesById.value,
        media: mediaById.value,
        themes: themesStore.themes,
        people: peopleById.value,
        externalApps: externalAppProfilesById.value,
        externalAppImplementations: externalAppsStore.implementations,
        externalAppLaunchAvailable: externalAppLaunchAvailable.value,
        resolvedScriptureKeys: new Set(scriptureById.keys()),
        scriptureErrorKeys: new Set(scriptureErrors.keys()),
        resolvedMediaIds: new Set(mediaUrlById.keys()),
        mediaErrorIds: new Set(mediaErrors.keys()),
        mediaAvailabilityChecked: !!getAdapter().media.getFilePath,
        verifiedExternalAppItemIds: new Set(verifiedExternalAppItemIds),
        externalAppErrors: new Map(externalAppReadinessErrors),
        externalAppVerificationAvailable: externalAppVerificationAvailable.value,
        libraryConflictLabels: new Map(
          syncStore.conflicts.map((conflict) => [
            `${conflict.kind}:${conflict.id}`,
            conflict.label,
          ]),
        ),
        audienceDisplayAvailable: audienceDisplayAvailable.value,
        roleNames: new Map(rolesStore.roles.map((role) => [role.id, role.name])),
      })
    : { issues: [], blockers: [], warnings: [], ready: false },
)
const readinessDialogOpen = ref(false)
const readinessColor = computed(() =>
  readiness.value.blockers.length
    ? 'error'
    : readiness.value.warnings.length
      ? 'warning'
      : 'success',
)
const readinessIcon = computed(() =>
  readiness.value.blockers.length
    ? 'mdi-alert-circle-outline'
    : readiness.value.warnings.length
      ? 'mdi-check-circle-outline'
      : 'mdi-check-circle',
)
const readinessLabel = computed(() => {
  const blockers = readiness.value.blockers.length
  const warnings = readiness.value.warnings.length
  if (blockers) return `${blockers} ${blockers === 1 ? 'blocker' : 'blockers'}`
  if (warnings) return `Ready · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
  return 'Ready to Present'
})
const readinessMediaIds = computed(() => {
  const ids = new Set<string>()
  for (const item of service.value?.items ?? []) {
    if (item.type === 'media' || item.type === 'video' || item.type === 'audio')
      ids.add(item.mediaId)
    if (item.type === 'slide-ref') {
      const presentation = slidesById.value.get(item.slideId)
      for (const slide of presentation?.slides ?? []) {
        if (slide.source.type === 'canva') ids.add(slide.source.renderedMediaId)
        if (slide.scene.background.mediaId) ids.add(slide.scene.background.mediaId)
        for (const element of slide.scene.elements) {
          if (element.type === 'image') ids.add(element.mediaId)
        }
      }
    }
    const target = presentationThemeTargetForItem(item)
    const theme = resolvePresentationTheme(item, target, themesStore.themes)
    if (
      theme?.backgroundId &&
      theme.backgroundId !== 'brand-primary' &&
      theme.backgroundId !== 'brand-secondary'
    )
      ids.add(theme.backgroundId)
  }
  return [...ids]
})
watch(
  readinessMediaIds,
  (ids) => {
    void Promise.all(ids.map(resolveMediaItem))
  },
  { immediate: true },
)
async function openReadinessIssue(issue: ReadinessIssue) {
  if (issue.action === 'display') {
    readinessDialogOpen.value = false
    await openPresentationDisplayDialog()
    return
  }
  if (issue.action === 'assignments') {
    readinessDialogOpen.value = false
    await router.push(
      routeWithReturnTo(`/service/${service.value?.id}/assignments`, route.fullPath),
    )
    return
  }
  if (issue.action === 'library-health') {
    readinessDialogOpen.value = false
    await router.push('/sync-conflicts')
    return
  }
  const index = service.value?.items.findIndex((item) => item.id === issue.itemId) ?? -1
  if (index >= 0) {
    selectedItemIndex.value = index
    readinessDialogOpen.value = false
    await nextTick()
    document
      .querySelector(`[data-service-item-id="${CSS.escape(issue.itemId ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}
const scriptureFontRange = computed(() => ({
  minPx: settingsStore.librarySettings?.fontSizesPx.scripture.min ?? 72,
  maxPx: settingsStore.librarySettings?.fontSizesPx.scripture.max ?? 120,
}))
const songFontRange = computed(() => ({
  minPx: settingsStore.librarySettings?.fontSizesPx.song.min ?? 16,
  maxPx: settingsStore.librarySettings?.fontSizesPx.song.max ?? 120,
}))
const flatSlides = computed<FlatSlide[]>(() =>
  service.value
    ? flattenService(
        service.value,
        songsById.value,
        scriptureById,
        slidesById.value,
        externalAppProfilesById.value,
        scriptureFontRange.value,
        songFontRange.value,
        songCollectionsStore.collections,
      )
    : [],
)

const selectedItem = computed<ServiceItem | undefined>(
  () => service.value?.items[selectedItemIndex.value],
)
// The selected item's own run of flat slides, in page order — lets a per-type editor branch
// render one selector per actual auto-split page (e.g. a long scripture passage split across
// several slides) instead of one undifferentiated block for the whole item.
const selectedItemFlatSlides = computed(() =>
  flatSlides.value.filter((s) => s.itemIndex === selectedItemIndex.value),
)
// PropertyInspector's own auto-advance override only applies to slide-ref/text-slide items; for
// slide-ref specifically, this is what it falls back to (and shows as a hint) when no override
// is set — see useLiveTransport.ts's liveItemAutoAdvance, which resolves the exact same way.
const selectedItemLibraryAutoAdvance = computed(() => {
  const item = selectedItem.value
  if (item?.type !== 'slide-ref') return undefined
  return slidesById.value.get(item.slideId)?.autoAdvance
})

const themeTargetLabels: Record<PresentationThemeTarget, string> = {
  songs: 'Songs',
  scripture: 'Scripture',
  sermon: 'Sermons',
  'text-slides': 'Text Slides',
}

function defaultThemeFor(target: PresentationThemeTarget) {
  return themesStore.themes.find(
    (theme) =>
      isPresentationThemeAvailableFor(theme, target) &&
      isPresentationThemeDefaultFor(theme, target),
  )
}

const selectedThemeTarget = computed(() => presentationThemeTargetForItem(selectedItem.value))
const selectedDefaultTheme = computed(() =>
  selectedThemeTarget.value ? defaultThemeFor(selectedThemeTarget.value) : undefined,
)
const themeOverrideOptions = computed(() => [
  {
    title: `Use default${selectedDefaultTheme.value ? ` — ${selectedDefaultTheme.value.name}` : ''}`,
    value: '',
  },
  ...themesStore.themes
    .filter(
      (theme) =>
        !selectedThemeTarget.value ||
        isPresentationThemeAvailableFor(theme, selectedThemeTarget.value),
    )
    .map((theme) => ({ title: theme.name, value: theme.id })),
])

// Changing a reference after the item's already been added — e.g. the operator picked the
// wrong verse range. A local draft (rather than binding straight to the item, like bulletinLabel
// does elsewhere in this view) so re-resolving — a real backend/API call, unlike a plain text
// field — only fires once on blur, not on every keystroke while typing a whole reference.
const scriptureReferenceDraft = ref('')
const sermonPassageReferenceDrafts = reactive<Record<string, string>>({})
// Toggles a passage between its condensed (reference + text preview only) and expanded
// (reference field, display-mode toggle, translation picker) states.
const editingSermonPassageId = ref<string>()
// Which one supporting passage (if any) currently has its verse preview expanded — an
// accordion, not independent per-passage toggles, so a sermon with several supporting passages
// stays scannable instead of showing every passage's full text at once. The Main Passage isn't
// part of this — it's always shown expanded, since there's only ever one.
const expandedSupportingPassageId = ref<string>()
const expandedMainSermonPassage = ref(true)
// Same edit/expand split as passages above, applied to outline points.
const editingSermonOutlineId = ref<string>()
const expandedSermonOutlineId = ref<string>()

function selectMainSermonFlow() {
  const expanding = !expandedMainSermonPassage.value
  expandedMainSermonPassage.value = expanding
  if (expanding) {
    expandedSupportingPassageId.value = undefined
    expandedSermonOutlineId.value = undefined
  }
}
function selectSermonFlowPassage(passageId: string) {
  const expanding = expandedSupportingPassageId.value !== passageId
  expandedSupportingPassageId.value = expanding ? passageId : undefined
  if (expanding) {
    expandedMainSermonPassage.value = false
    expandedSermonOutlineId.value = undefined
  }
}
function selectSermonFlowOutline(outlineId: string) {
  const expanding = expandedSermonOutlineId.value !== outlineId
  expandedSermonOutlineId.value = expanding ? outlineId : undefined
  if (expanding) {
    expandedMainSermonPassage.value = false
    expandedSupportingPassageId.value = undefined
  }
}
watch(
  selectedItem,
  (item) => {
    if (item?.type === 'scripture') scriptureReferenceDraft.value = item.reference
    if (item?.type === 'sermon') {
      for (const passage of item.passages)
        sermonPassageReferenceDrafts[passage.id] = passage.reference
    }
    // Switching to a different item (or away from this sermon entirely) shouldn't leave a
    // stale passage/outline point expanded or mid-edit for whatever's selected next.
    editingSermonPassageId.value = undefined
    expandedMainSermonPassage.value = true
    expandedSupportingPassageId.value = undefined
    editingSermonOutlineId.value = undefined
    expandedSermonOutlineId.value = undefined
  },
  { immediate: true },
)
async function commitScriptureReference(itemId: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'scripture') return
  const reference = scriptureReferenceDraft.value.trim()
  if (!reference || reference === item.reference) return
  item.reference = reference
  await resolveScriptureItem(item)
}
async function commitSermonPassageReference(itemId: string, passageId: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const passage = item.passages.find((p) => p.id === passageId)
  const reference = sermonPassageReferenceDrafts[passageId]?.trim()
  if (!passage || !reference || reference === passage.reference) return
  passage.reference = reference
  if (passage.displayMode !== 'reference-only')
    await resolvePassage(`${itemId}:${passageId}`, reference, passage.translation)
}

// Adding/removing passages and outline points after a sermon item already exists — same
// operations the Add dialog offers at creation time, now also available in place, so a
// passage added mid-week (or an outline point that needs editing) doesn't require deleting
// and re-adding the whole sermon item.
function addSermonPassage(itemId: string, asMain = false) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const id = `passage-${crypto.randomUUID()}`
  item.passages.push({
    id,
    reference: '',
    translation: scriptureDraft.value.translation,
    displayMode: 'full',
  })
  item.flow = item.flow ?? [
    ...item.passages
      .slice(0, -1)
      .filter((passage) => passage.id !== item.mainPassageId)
      .map((passage) => ({ type: 'passage', passageId: passage.id }) as const),
    ...item.outline.map((block) => ({ type: 'outline', outlineId: block.id }) as const),
  ]
  if (asMain) {
    item.mainPassageId = id
    item.presentMainPassage = true
  } else {
    item.flow.push({ type: 'passage', passageId: id })
  }
  sermonPassageReferenceDrafts[id] = ''
  // Straight into edit mode — a freshly added passage has no reference yet, so there's nothing
  // useful to look at until it's actually been given one (matches "Add Outline Point"'s own
  // behavior below).
  editingSermonPassageId.value = id
  expandedMainSermonPassage.value = asMain
  expandedSupportingPassageId.value = asMain ? undefined : id
  expandedSermonOutlineId.value = undefined
}
function addMainSermonPassage(itemId: string) {
  const item = service.value?.items.find((candidate) => candidate.id === itemId)
  if (!item || item.type !== 'sermon') return
  const existing = item.passages.find((passage) => passage.id === item.mainPassageId)
  if (!existing) {
    addSermonPassage(itemId, true)
    return
  }
  item.presentMainPassage = true
  sermonPassageReferenceDrafts[existing.id] = existing.reference
  editingSermonPassageId.value = existing.id
  expandedMainSermonPassage.value = true
  expandedSupportingPassageId.value = undefined
  expandedSermonOutlineId.value = undefined
}
async function removeSermonPassage(itemId: string, passageId: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const index = item.passages.findIndex((p) => p.id === passageId)
  if (index === -1) return
  if (!(await confirmDialog.confirm('Remove this passage?', 'Remove'))) return
  item.passages.splice(index, 1)
  item.flow = item.flow?.filter(
    (entry) => entry.type !== 'passage' || entry.passageId !== passageId,
  )
  delete sermonPassageReferenceDrafts[passageId]
  scriptureById.delete(`${itemId}:${passageId}`)
  scriptureErrors.delete(`${itemId}:${passageId}`)
  if (item.mainPassageId === passageId) {
    item.mainPassageId = ''
    item.presentMainPassage = false
    expandedMainSermonPassage.value = false
  }
}
// The sermon's own title — also settable from the "Edit Service Details" header dialog
// (ServiceDetailsDialog.vue, via applySermonEdit), but that's a roundabout path when you're
// already looking at the sermon item itself in the order of service.
function updateSermonTitle(itemId: string, title: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  item.title = title || undefined
}
// Entering edit mode always expands the passage too (there's nowhere to show the edit fields
// otherwise) — for the Main Passage this is a no-op read, since it's never gated by expansion.
function toggleSermonPassageEdit(passageId: string) {
  const turningOn = editingSermonPassageId.value !== passageId
  editingSermonPassageId.value = turningOn ? passageId : undefined
  if (turningOn) {
    if (passageId === mainSermonPassage.value.id) {
      expandedMainSermonPassage.value = true
      expandedSupportingPassageId.value = undefined
    } else {
      expandedMainSermonPassage.value = false
      expandedSupportingPassageId.value = passageId
    }
    expandedSermonOutlineId.value = undefined
  }
}
function toggleSupportingPassageExpanded(passageId: string) {
  expandedSupportingPassageId.value =
    expandedSupportingPassageId.value === passageId ? undefined : passageId
}
function toggleSermonOutlineEdit(blockId: string) {
  const turningOn = editingSermonOutlineId.value !== blockId
  editingSermonOutlineId.value = turningOn ? blockId : undefined
  if (turningOn) {
    expandedMainSermonPassage.value = false
    expandedSupportingPassageId.value = undefined
    expandedSermonOutlineId.value = blockId
  }
}
// Expanding an outline point doubles as selecting it for presentation — there's no separate
// "preview vs. live" row the way passages have several auto-split pages, so opening the one
// card IS the point of going live on it. Collapsing it back just closes the card; whatever was
// last live stays live, same as selecting away from any other item elsewhere in this view.
function toggleSermonOutlineLive(
  item: Extract<ServiceItem, { type: 'sermon' }>,
  blockId: string,
  index: number,
) {
  const turningOn = expandedSermonOutlineId.value !== blockId
  expandedSermonOutlineId.value = turningOn ? blockId : undefined
  if (turningOn) goLive(sermonOutlineFlatIndex(item, index))
}
function addSermonOutlineBlock(itemId: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const id = `outline-${crypto.randomUUID()}`
  item.outline.push({ id, label: '', text: '' })
  item.flow = item.flow ?? [
    ...item.passages
      .filter((passage) => passage.id !== item.mainPassageId)
      .map((passage) => ({ type: 'passage', passageId: passage.id }) as const),
    ...item.outline
      .slice(0, -1)
      .map((block) => ({ type: 'outline', outlineId: block.id }) as const),
  ]
  item.flow.push({ type: 'outline', outlineId: id })
  // Straight into edit mode — a freshly added point is still an empty placeholder, so there's
  // nothing useful to look at until it's actually been titled and filled in.
  expandedSermonOutlineId.value = id
  expandedMainSermonPassage.value = false
  expandedSupportingPassageId.value = undefined
  editingSermonOutlineId.value = id
}
async function removeSermonOutlineBlock(itemId: string, index: number) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const target = item.outline[index]
  if (!target) return
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  item.outline.splice(index, 1)
  item.flow = item.flow?.filter(
    (entry) => entry.type !== 'outline' || entry.outlineId !== target.id,
  )
}
// The Main Passage (index 0) is fixed in place — only the passages after it are reorderable, so
// VueDraggable gets a writable slice rather than the item's own full passages array.
const mainSermonPassage = computed<SermonPassage>(() => {
  const item = selectedItem.value
  return item?.type === 'sermon'
    ? (item.passages.find((passage) => passage.id === item.mainPassageId) ?? {
        id: '',
        reference: '',
        translation: '',
        displayMode: 'full',
      })
    : { id: '', reference: '', translation: '', displayMode: 'full' }
})
const supportingSermonPassages = computed<SermonPassage[]>({
  get: () =>
    selectedItem.value?.type === 'sermon'
      ? selectedItem.value.passages.filter((passage) => passage.id !== mainSermonPassage.value?.id)
      : [],
  set: (value) => {
    const item = selectedItem.value
    const main = mainSermonPassage.value
    if (!item || item.type !== 'sermon' || !main.id) return
    item.passages = [main, ...value]
  },
})
type SermonFlowRow = { key: string; type: 'passage' | 'outline'; label: string; detail: string }
const sermonFlow = computed({
  get: (): SermonFlowRow[] => {
    const item = selectedItem.value
    if (!item || item.type !== 'sermon') return []
    const main = mainSermonPassage.value
    const legacy = [
      ...item.passages
        .filter((passage) => passage.id !== main?.id)
        .map((passage) => ({ type: 'passage' as const, passageId: passage.id })),
      ...item.outline.map((block) => ({ type: 'outline' as const, outlineId: block.id })),
    ]
    const rows: SermonFlowRow[] = []
    for (const entry of item.flow ?? legacy) {
      if (entry.type === 'passage') {
        const passage = item.passages.find((candidate) => candidate.id === entry.passageId)
        if (passage && passage.id !== main?.id)
          rows.push({
            key: `passage:${passage.id}`,
            type: 'passage',
            label: passage.reference || 'Untitled scripture',
            detail: passage.displayMode === 'full' ? 'Full text' : 'Reference only',
          })
        continue
      }
      const block = item.outline.find((candidate) => candidate.id === entry.outlineId)
      if (block)
        rows.push({
          key: `outline:${block.id}`,
          type: 'outline',
          label: block.label || 'Untitled point',
          detail: block.text || 'Outline point',
        })
    }
    return rows
  },
  set: (rows: SermonFlowRow[]) => {
    const item = selectedItem.value
    if (!item || item.type !== 'sermon') return
    item.flow = rows.map((row) =>
      row.type === 'passage'
        ? { type: 'passage', passageId: row.key.slice('passage:'.length) }
        : { type: 'outline', outlineId: row.key.slice('outline:'.length) },
    )
  },
})
function sermonFlowPassage(entry: SermonFlowRow) {
  if (entry.type !== 'passage' || selectedItem.value?.type !== 'sermon') return undefined
  return selectedItem.value.passages.find(
    (passage) => passage.id === entry.key.slice('passage:'.length),
  )
}
function sermonFlowOutline(entry: SermonFlowRow) {
  if (entry.type !== 'outline' || selectedItem.value?.type !== 'sermon') return undefined
  return selectedItem.value.outline.find((block) => block.id === entry.key.slice('outline:'.length))
}
function sermonFlowOutlineIndex(entry: SermonFlowRow) {
  const item = selectedItem.value
  return entry.type === 'outline' && item?.type === 'sermon'
    ? item.outline.findIndex((block) => block.id === entry.key.slice('outline:'.length))
    : -1
}
function selectedSermonId() {
  return selectedItem.value?.type === 'sermon' ? selectedItem.value.id : ''
}
function sermonFlowEntryIsLive(entry: SermonFlowRow) {
  if (entry.type === 'passage')
    return passageFlatSlides(entry.key.slice('passage:'.length)).some(
      (slide) => flatIndex.value === flatIndexForKey(slide.key),
    )
  const item = selectedItem.value
  return (
    item?.type === 'sermon' &&
    flatIndex.value === sermonOutlineFlatIndex(item, sermonFlowOutlineIndex(entry))
  )
}
function selectSermonFlowEntry(entry: SermonFlowRow) {
  if (entry.type === 'passage') selectSermonFlowPassage(entry.key.slice('passage:'.length))
  else selectSermonFlowOutline(entry.key.slice('outline:'.length))
}
function removeSermonFlowEntry(entry: SermonFlowRow) {
  const item = selectedItem.value
  if (!item || item.type !== 'sermon') return
  if (entry.type === 'passage')
    void removeSermonPassage(item.id, entry.key.slice('passage:'.length))
  else void removeSermonOutlineBlock(item.id, sermonFlowOutlineIndex(entry))
}

const selectedSong = computed<Song | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'song' ? songsById.value.get(item.songId) : undefined
})
// Covers both slide-ref (resolved via the library) and text-slide (service-owned data) —
// both are just a named sequence of slides, played in order, no per-service arrangement
// override (unlike songs) since spec section 1 has the whole group inserted as-is.
const selectedSlideGroup = computed<Array<SongBlock | LibrarySlide> | undefined>(() => {
  const item = selectedItem.value
  if (!item) return undefined
  if (item.type === 'text-slide') return item.slides
  if (item.type === 'slide-ref') return slidesById.value.get(item.slideId)?.slides
  return undefined
})
function slideGroupText(slide: SongBlock | LibrarySlide): string {
  return 'scene' in slide ? scenePlainText(slide.scene) : slide.text
}
function slideFlatIndex(itemId: string, subIndex: number): number {
  return flatSlides.value.findIndex((s) => s.key === `${itemId}:${subIndex}`)
}
// A sermon passage's own auto-split pages, in page order — same "one selector per actual page"
// idea as selectedItemFlatSlides, but scoped to a single passage rather than the whole item
// (a sermon may have several passages, each independently paginated).
function passageFlatSlides(passageId: string) {
  return selectedItemFlatSlides.value.filter((s) => s.passageId === passageId)
}
// Sermon passage pages don't have a fixed subIndex the way slideFlatIndex expects (a sermon's
// subIndex numbering is cumulative across all passages plus the outline, not passage-local) —
// this looks up a page's flat position directly off its own stable key instead.
function flatIndexForKey(key: string): number {
  return flatSlides.value.findIndex((s) => s.key === key)
}
// A sermon's outline blocks come after however many flat slides its passages produced (which
// varies with pagination), so their flat index can't be derived the same way slideFlatIndex
// does for a fixed subIndex — instead, read it off this item's own already-flattened run
// (flattenService pushes passages then outline in that exact order, see its own doc comment).
function sermonOutlineFlatIndex(
  item: Extract<ServiceItem, { type: 'sermon' }>,
  outlineIndex: number,
): number {
  const block = item.outline[outlineIndex]
  if (!block) return -1
  return flatSlides.value.findIndex((slide) => slide.key === `${item.id}:outline:${block.id}`)
}
const selectedMediaUrl = computed(() => {
  const item = selectedItem.value
  const mediaId = item?.type === 'media' || item?.type === 'video' ? item.mediaId : undefined
  return mediaId ? mediaUrlById.get(mediaId) : undefined
})
const selectedMediaError = computed(() => {
  const item = selectedItem.value
  const mediaId = item?.type === 'media' || item?.type === 'video' ? item.mediaId : undefined
  return mediaId ? mediaErrors.get(mediaId) : undefined
})

// Swapping the image/video (or, for an image, its fill) on an already-added item reuses the
// same MediaPickerDialog rather than making the operator remove the item and add a new one —
// mutating the existing item's own fields keeps its position in the order and any role/label
// already set on it.
const changeMediaPickerOpen = ref(false)
const changeVideoPickerOpen = ref(false)
// Seeds the "Change Image" picker's own fit toggle with the item's current fit (rather than
// always reopening on Cover) — and, since it's a two-way binding, adjusting the toggle inside
// the picker itself updates the very same item live, same as the inline toggle above it.
const changeMediaPickerFit = computed<'cover' | 'contain'>({
  get: () => (selectedItem.value?.type === 'media' ? selectedItem.value.fit : 'cover'),
  set: (value) => {
    if (selectedItem.value?.type === 'media') selectedItem.value.fit = value
  },
})

async function changeSelectedMedia(
  mediaId: string,
  _placement: 'element' | 'background',
  fit: 'cover' | 'contain' = 'cover',
) {
  const item = selectedItem.value
  if (!item || item.type !== 'media') return
  item.mediaId = mediaId
  item.fit = fit
  await resolveMediaItem(mediaId)
}
async function changeSelectedVideo(mediaId: string) {
  const item = selectedItem.value
  if (!item || item.type !== 'video') return
  item.mediaId = mediaId
  await resolveMediaItem(mediaId)
}
function updateSelectedMediaFit(fit: 'cover' | 'contain') {
  const item = selectedItem.value
  if (item?.type === 'media') item.fit = fit
}
function openChangeMediaPicker() {
  const item = selectedItem.value
  if (item?.type === 'media') changeMediaPickerOpen.value = true
  else if (item?.type === 'video') changeVideoPickerOpen.value = true
}
const selectedScripturePassage = computed<ScripturePassage | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'scripture' ? scriptureById.get(item.id) : undefined
})
const selectedScriptureError = computed<string | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'scripture' ? scriptureErrors.get(item.id) : undefined
})

// The Service Order list's icon is the same generic "?" for every placeholder regardless of
// what kind of content it wants — this is what actually distinguishes them at a glance in that
// list when the template didn't give this slot its own bulletin heading.
const PLACEHOLDER_TYPE_NAMES: Record<string, string> = {
  songs: 'Song',
  scripture: 'Scripture',
  slides: 'Slide',
  media: 'Media',
  sermon: 'Sermon',
}
function placeholderTypeName(suggestedTab: string | undefined): string {
  return PLACEHOLDER_TYPE_NAMES[suggestedTab ?? ''] ?? 'Item'
}

function itemLabel(item: ServiceItem): string {
  if (item.type === 'song') return songsById.value.get(item.songId)?.title ?? 'Unknown Song'
  if (item.type === 'scripture') return item.reference
  if (item.type === 'text-slide') return 'Text Slide'
  if (item.type === 'slide-ref') return slidesById.value.get(item.slideId)?.label ?? 'Unknown Slide'
  if (item.type === 'media') {
    const media = mediaById.value.get(item.mediaId)
    return media?.title || media?.filename || 'Unknown Media'
  }
  if (item.type === 'video') {
    const media = mediaById.value.get(item.mediaId)
    return media?.title || media?.filename || 'Unknown Video'
  }
  if (item.type === 'external-app')
    return externalAppProfilesById.value.get(item.profileId)?.name ?? 'Unknown App'
  if (item.type === 'sermon') return item.bulletinLabel || item.title || 'Worship Through the Word'
  if (item.type === 'bulletin-note') return item.bulletinLabel || 'Bulletin Note'
  if (item.type === 'placeholder')
    return (
      item.bulletinLabel || item.label || `${placeholderTypeName(item.suggestedTab)} Placeholder`
    )
  return item.type
}

function itemColor(item: ServiceItem): string {
  return colorForItemType(item.type)
}

function blockLabelFor(blockId: string): string {
  return selectedSong.value?.blocks.find((block) => block.id === blockId)?.label ?? ''
}

/** Category color when browsing; red (the "this is live" signal) takes priority over it. */
function slideRowStyle(blockId: string, isLive: boolean) {
  if (isLive) return undefined
  const color = colorForBlockLabel(blockLabelFor(blockId))
  return {
    background: `rgba(var(--v-theme-${color}), 0.08)`,
    borderLeft: `3px solid rgb(var(--v-theme-${color}))`,
    paddingLeft: '9px',
  }
}

function itemHasLive(index: number): boolean {
  const slide = flatSlides.value[flatIndex.value]
  return !!slide && slide.itemIndex === index
}

// In-workspace arrangement editing — edits only this service item's own copy of the
// arrangement (spec section 3), never the library song's defaultArrangement. No confirmation —
// this only removes the block's appearance in the sequence, not the block itself, and undo/redo
// already covers it.
function removeFromArrangement(index: number) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  item.arrangement.sequence.splice(index, 1)
}
function addToArrangement(blockId: string) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  item.arrangement.sequence.push(blockId)
}
function resetArrangementToDefault() {
  const item = selectedItem.value
  const song = selectedSong.value
  if (item?.type !== 'song' || !song) return
  item.arrangement.sequence = [...song.defaultArrangement.sequence]
}

const {
  flatIndex,
  liveSlide,
  isBlankScreen,
  backgroundOnly,
  previousDisabled,
  nextDisabled,
  prevPreviewLabel,
  nextPreviewLabel,
  goLive,
  next,
  previous,
  toggleBlankScreen,
  toggleBackgroundOnly,
  togglePresenting,
  previewSlots,
  currentSlideLabel,
  slidePositionLabel,
  liveContextSnippet,
  audienceDisplayAvailable,
  presentationDisplayDialogOpen,
  presentationDisplays,
  presentationDisplaysLoading,
  selectedAudienceDisplayId,
  presentationDisplayError,
  loadPresentationSize,
  refreshPresentationDisplays,
  openPresentationDisplayDialog,
  identifyPresentationDisplay,
  useAudienceDisplayAndStart,
  PREVIEW_VIRTUAL_SIZE,
  previewPanelRef,
  previewThumbWidth,
  previewScale,
  observePreviewPanel,
} = useLiveTransport({
  service,
  selectedItemIndex,
  flatSlides,
  mediaById,
  mediaUrlById,
  slidesById,
  themesStore,
  settingsStore,
  isPresenting,
  readiness,
  readinessDialogOpen,
  externalAppProfilesById,
  tryForwardKeydown: (event) => tryForwardKeydown(event),
  retryExternalApp: () => retryExternalApp(),
  closeExternalApp: () => closeExternalApp(),
  sendManualCommand: (profileId, commandId) => sendManualCommand(profileId, commandId),
})

// Previous/Next changes the transport's live slide directly, bypassing the sermon-flow row
// click handlers that normally manage this accordion. Keep the visible editor synchronized
// with whichever sermon content is live so moving across passage/outline boundaries opens the
// destination section and closes the one the operator just left. Moving between pages of the
// same passage intentionally leaves that passage open.
watch(
  () => liveSlide.value?.key,
  () => {
    const slide = liveSlide.value
    const item = selectedItem.value
    if (!slide || item?.type !== 'sermon' || slide.itemId !== item.id) return

    if (slide.passageId) {
      const mainPassageId = item.mainPassageId
      expandedMainSermonPassage.value = slide.passageId === mainPassageId
      expandedSupportingPassageId.value =
        slide.passageId === mainPassageId ? undefined : slide.passageId
      expandedSermonOutlineId.value = undefined
      return
    }

    const outline = item.outline.find((block) => slide.key === `${item.id}:outline:${block.id}`)
    if (!outline) return
    expandedMainSermonPassage.value = false
    expandedSupportingPassageId.value = undefined
    expandedSermonOutlineId.value = outline.id
  },
  { immediate: true, flush: 'post' },
)

const {
  externalAppError,
  verifiedExternalAppItemIds,
  externalAppReadinessErrors,
  externalAppVerificationAvailable,
  retryExternalApp,
  skipExternalAppError,
  closeExternalApp,
  prelaunchError,
  prelaunchExternalApp,
  tryForwardKeydown,
  manualCommandError,
  sendManualCommand,
} = useExternalAppHandoff(service, liveSlide, isPresenting, externalAppProfilesById)

// The Add Item menu chooses the item type before opening AddServiceItemDialog's focused form —
// selecting a type doesn't duplicate any of the dialog's own add behavior or draft state.
const addTab = ref<AddItemType>('songs')
const addTabOptions = computed(() => {
  const options: { title: string; description: string; icon: string; value: AddItemType }[] = [
    {
      title: 'Song',
      description: 'Add lyrics from the song library',
      icon: 'mdi-music-note',
      value: 'songs',
    },
    {
      title: 'Scripture',
      description: 'Build a passage or reference slide',
      icon: 'mdi-book-open-page-variant',
      value: 'scripture',
    },
    {
      title: 'Slides',
      description: 'Use library or service-only slides',
      icon: 'mdi-presentation',
      value: 'slides',
    },
    {
      title: 'Media',
      description: 'Add an image from the media library',
      icon: 'mdi-image-outline',
      value: 'media',
    },
    {
      title: 'Video',
      description: 'Add a video from the media library',
      icon: 'mdi-movie-open-outline',
      value: 'video',
    },
  ]
  if (getAdapter().externalApps) {
    options.push({
      title: 'External App',
      description: 'Hand off to a configured application',
      icon: 'mdi-application-outline',
      value: 'external-app',
    })
  }
  options.push(
    {
      title: 'Sermon',
      description: 'Add passages and sermon outline slides',
      icon: 'mdi-podium',
      value: 'sermon',
    },
    {
      title: 'Bulletin Note',
      description: 'Add a printed, non-presented item',
      icon: 'mdi-file-document-outline',
      value: 'bulletin-note',
    },
  )
  return options
})
const activeAddTypeTitle = computed(
  () => addTabOptions.value.find((option) => option.value === addTab.value)?.title ?? 'Item',
)

const addReplaceContext = ref<{ index: number; roleId?: string; label?: string; note?: string }>()

function openAddDialog(type: AddItemType) {
  if (openDrawer.value === 'order') openDrawer.value = null
  addReplaceContext.value = undefined
  addTab.value = type
  addDialogOpen.value = true
}

// Placeholders use this to get filled in for the first time; song and external-app items use it
// to swap which song/profile+file fills an already-placed slot without losing that slot's own
// roleId/bulletinLabel/note or its position in the order — otherwise the only way to change one
// was delete-and-re-add. AddServiceItemDialog reads the existing item back out of `service` at
// `index` itself (via replaceContext.index) to pre-fill the external-app tab's fields — there's
// nothing external-app-specific to carry in this context beyond the shared roleId/label/note.
function beginReplaceItem(item: ServiceItem, index: number) {
  if (item.type !== 'placeholder' && item.type !== 'song' && item.type !== 'external-app') return
  addReplaceContext.value = {
    index,
    roleId: item.roleId,
    label: item.type === 'placeholder' ? (item.bulletinLabel ?? item.label) : item.bulletinLabel,
    note: item.bulletinNote,
  }
  addTab.value =
    item.type === 'placeholder'
      ? ((item.suggestedTab as AddItemType) ?? 'songs')
      : item.type === 'external-app'
        ? 'external-app'
        : 'songs'
  addDialogOpen.value = true
}

// Seeded from the church's configured default translation at app load (see onMounted below) —
// passed into AddServiceItemDialog as a v-model since the dialog both reads it (for the
// Scripture tab's initial translation) and resets it on close.
const scriptureDraft = ref<ScriptureReferenceValue>({
  reference: '',
  translation: '',
  displayMode: 'full',
})
const scriptureTranslations = ref<ScriptureTranslation[]>([])

function updatePresenterNote(itemId: string, note: string) {
  if (!service.value) return
  if (!service.value.presenterNotes) service.value.presenterNotes = {}
  service.value.presenterNotes[itemId] = note
}

// Who's doing this part (Elder leading prayer, scripture reader, etc.) — a role from the same
// catalog Assignments uses, not a Person reference directly: the actual person is whoever that
// service's Assignments has for this role (see AssignmentsView.vue), so this is just a pointer
// to which role, kept automatically in sync rather than a second place that could disagree.
const itemRoleOptions = computed(() => roleOptionsFor(rolesStore.roles, roleGroupsStore.roleGroups))
function updateItemRole(itemId: string, roleId: string | undefined) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (item) item.roleId = roleId
}
const rolePersonOptions = computed(() =>
  personOptionsForRole(peopleStore.people, selectedItem.value?.roleId),
)
function assignedPersonId(roleId: string | undefined): string | undefined {
  return service.value?.assignments?.find((a) => a.roleId === roleId)?.personId
}
// Editing directly here (rather than only via the Assignments page) writes to the exact same
// service.assignments array Assignments reads from — one RoleAssignment per role, created on
// first use here if this role has never been assigned anything for this service yet.
function updateRolePerson(roleId: string, personId: string | undefined) {
  if (!service.value) return
  if (!service.value.assignments) service.value.assignments = []
  const assignment = service.value.assignments.find((a) => a.roleId === roleId)
  if (assignment) assignment.personId = personId
  else service.value.assignments.push({ roleId, personId, tentative: false })
}
</script>

<template>
  <AsyncLoadState
    v-if="workspaceLoading || workspaceLoadError"
    :loading="workspaceLoading"
    :error="workspaceLoadError"
    label="service"
    @retry="reloadWorkspace"
  />
  <EditorNotFoundState
    v-else-if="notFound"
    icon="mdi-calendar-remove-outline"
    title="Service Not Found"
    message="This service may have been deleted or moved."
    :back-to="{ path: '/' }"
    back-label="Back to Services"
  />
  <div
    v-else-if="service"
    class="workspace-root"
    :class="{ 'workspace-root--short': isShortViewport }"
  >
    <v-alert
      v-if="servicesStore.mutationError"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="workspace-save-error"
      @click:close="servicesStore.clearMutationError"
    >
      Service changes were not saved: {{ servicesStore.mutationError }}
    </v-alert>
    <div
      ref="toolbarRef"
      class="workspace-toolbar"
      :class="{
        'workspace-toolbar--wrap': isNarrowToolbar,
        'workspace-toolbar--compact-actions': isCompactActions,
        'workspace-toolbar--narrow-actions': isNarrowActions,
      }"
    >
      <div class="workspace-service-context">
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          :to="backTo"
          class="service-back-button"
          :aria-label="backTo.includes('/plan') ? 'Back to planning' : 'Back to services'"
        />
        <span class="workspace-service-icon"><v-icon icon="mdi-church-outline" size="22" /></span>
        <div class="workspace-service-heading">
          <div class="workspace-title-line">
            <span class="workspace-service-title">{{ serviceTypeName }}</span>
            <span v-if="isPresenting" class="presenting-badge"><i />Live</span>
          </div>
          <div class="workspace-service-metadata">
            <span class="workspace-service-date"
              ><v-icon icon="mdi-calendar-clock-outline" size="16" />{{ serviceDateLabel }}</span
            >
            <span v-if="serviceSubtitle" class="workspace-service-sermon">
              <v-icon icon="mdi-book-open-page-variant-outline" size="16" />{{ serviceSubtitle }}
            </span>
          </div>
        </div>
        <v-btn
          icon="mdi-pencil-outline"
          variant="tonal"
          color="primary"
          size="small"
          class="edit-service-button"
          title="Edit service details"
          aria-label="Edit service details"
          @click="serviceDetailsDialogOpen = true"
        />
      </div>
      <div class="workspace-actions">
        <template v-if="isOrderCompact || isPreviewCompact">
          <v-btn
            v-if="isOrderCompact"
            icon="mdi-format-list-bulleted"
            variant="text"
            size="small"
            :color="openDrawer === 'order' ? 'primary' : undefined"
            :title="openDrawer === 'order' ? 'Close order list' : 'Open order list'"
            :aria-label="openDrawer === 'order' ? 'Close order list' : 'Open order list'"
            @click="toggleWorkspaceDrawer('order')"
          />
          <v-btn
            v-if="isPreviewCompact"
            icon="mdi-monitor-eye"
            variant="text"
            size="small"
            :color="openDrawer === 'preview' ? 'primary' : undefined"
            :title="openDrawer === 'preview' ? 'Close presentation preview' : 'Open presentation preview'"
            :aria-label="
              openDrawer === 'preview' ? 'Close presentation preview' : 'Open presentation preview'
            "
            @click="toggleWorkspaceDrawer('preview')"
          />
          <span class="action-divider" />
        </template>
        <template v-if="!isNarrowActions">
          <v-btn
            variant="tonal"
            prepend-icon="mdi-calendar-edit-outline"
            :to="routeWithReturnTo(`/service/${service.id}/plan`, route.fullPath)"
          >
            Planning
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-account-group-outline"
            :to="routeWithReturnTo(`/service/${service.id}/assignments`, route.fullPath)"
          >
            Assignments
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-file-document-outline"
            :to="routeWithReturnTo(`/service/${service.id}/bulletin`, route.fullPath)"
          >
            Bulletin
          </v-btn>
        </template>
        <v-menu v-else location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              title="More"
              aria-label="More service pages"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              prepend-icon="mdi-calendar-edit-outline"
              title="Planning"
              :to="routeWithReturnTo(`/service/${service.id}/plan`, route.fullPath)"
            />
            <v-list-item
              prepend-icon="mdi-account-group-outline"
              title="Assignments"
              :to="routeWithReturnTo(`/service/${service.id}/assignments`, route.fullPath)"
            />
            <v-list-item
              prepend-icon="mdi-file-document-outline"
              title="Bulletin"
              :to="routeWithReturnTo(`/service/${service.id}/bulletin`, route.fullPath)"
            />
          </v-list>
        </v-menu>
        <button
          type="button"
          class="readiness-status"
          :class="`readiness-status--${readinessColor}`"
          :title="`${readiness.blockers.length} blockers, ${readiness.warnings.length} warnings`"
          @click="readinessDialogOpen = true"
        >
          <v-icon :icon="readinessIcon" size="17" />
          <span class="readiness-label">{{ readinessLabel }}</span>
        </button>
        <span class="action-divider" />
        <v-tooltip
          :disabled="isPresenting || audienceDisplayAvailable"
          location="bottom"
          text="Choose or connect an audience display before presenting."
          :open-delay="350"
        >
          <template #activator="{ props: tooltipProps }">
            <span
              v-bind="tooltipProps"
              class="present-button-wrap"
              @pointerenter="loadPresentationSize"
            >
              <v-btn
                :color="isPresenting ? 'error' : 'primary'"
                variant="flat"
                class="present-button"
                @click="togglePresenting"
              >
                <v-icon :icon="isPresenting ? 'mdi-stop' : 'mdi-play'" start />
                <span class="present-button-label">{{
                  isPresenting ? 'Stop Presenting' : 'Start Presenting'
                }}</span>
              </v-btn>
            </span>
          </template>
        </v-tooltip>
      </div>
    </div>

    <div
      class="workspace-layout"
      :class="{
        'workspace-layout--order-drawer': isOrderCompact,
        'workspace-layout--preview-drawer': isPreviewCompact,
      }"
    >
      <ServiceOrderList
        :service="service"
        v-model:selected-item-index="selectedItemIndex"
        :add-tab-options="addTabOptions"
        :item-label="itemLabel"
        :item-color="itemColor"
        :item-has-live="itemHasLive"
        :class="{ 'order-drawer-open': isOrderCompact && openDrawer === 'order' }"
        @open-add-dialog="openAddDialog"
      />

      <div class="center-panel">
        <template v-if="selectedItem">
          <div class="editor-heading">
            <div>
              <div class="editor-eyebrow">Selected item</div>
              <h2 class="editor-title">{{ itemLabel(selectedItem) }}</h2>
            </div>
            <p class="editor-hint">
              Click a slide to make it live · Next/Prev moves through the whole service
            </p>
          </div>

          <template v-if="selectedItem.type === 'song' && selectedSong">
            <v-btn
              variant="text"
              size="small"
              color="secondary"
              prepend-icon="mdi-swap-horizontal"
              class="mb-2"
              @click="beginReplaceItem(selectedItem, selectedItemIndex)"
            >
              Change Song
            </v-btn>
            <VueDraggable
              v-model="selectedItem.arrangement.sequence"
              handle=".drag-handle"
              :animation="150"
              class="d-flex flex-column ga-1"
            >
              <div
                v-for="(blockId, index) in selectedItem.arrangement.sequence"
                :key="index"
                class="slide-row"
                :class="{ 'slide-row--live': flatIndex === slideFlatIndex(selectedItem.id, index) }"
                :style="
                  slideRowStyle(blockId, flatIndex === slideFlatIndex(selectedItem.id, index))
                "
                @click="goLive(slideFlatIndex(selectedItem.id, index))"
              >
                <v-icon
                  icon="mdi-drag-vertical"
                  class="drag-handle"
                  size="small"
                  style="cursor: grab"
                />
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="slide-row-title-row">
                    <span class="text-body-2 font-weight-bold">
                      {{ selectedSong.blocks.find((b) => b.id === blockId)?.label ?? blockId }}
                    </span>
                    <span
                      v-if="flatIndex === slideFlatIndex(selectedItem.id, index)"
                      class="slide-row-live-badge"
                      ><i />Live</span
                    >
                  </div>
                  <div class="text-body-2" style="white-space: pre-line; opacity: 0.75">
                    {{ selectedSong.blocks.find((b) => b.id === blockId)?.text }}
                  </div>
                </div>
                <v-btn
                  icon="mdi-trash-can-outline"
                  variant="flat"
                  color="error"
                  class="row-remove"
                  size="small"
                  @click.stop="removeFromArrangement(index)"
                />
              </div>
            </VueDraggable>

            <div class="d-flex flex-wrap align-center ga-2 mt-3" style="max-width: 460px">
              <span class="text-caption font-weight-bold text-medium-emphasis mr-1">Add:</span>
              <v-chip
                v-for="block in selectedSong.blocks"
                :key="block.id"
                variant="outlined"
                :color="colorForBlockLabel(block.label)"
                size="small"
                class="cursor-pointer"
                @click="addToArrangement(block.id)"
              >
                {{ block.label }}
              </v-chip>
              <v-btn
                variant="flat"
                color="secondary"
                size="small"
                @click="resetArrangementToDefault"
              >
                Reset to song default
              </v-btn>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'scripture'">
            <v-text-field
              v-model="scriptureReferenceDraft"
              label="Reference"
              placeholder="e.g. John 3:16-17"
              variant="outlined"
              density="compact"
              style="max-width: 460px"
              class="mb-2"
              @blur="commitScriptureReference(selectedItem!.id)"
            />
            <v-btn-toggle
              :model-value="selectedItem.displayMode"
              mandatory
              density="compact"
              divided
              class="mb-2"
              @update:model-value="
                (value: 'full' | 'reference-only') =>
                  updateScriptureDisplayMode(selectedItem!.id, value)
              "
            >
              <v-btn value="full" size="small">Show Full Text</v-btn>
              <v-btn value="reference-only" size="small">Reference Only</v-btn>
            </v-btn-toggle>
            <v-select
              v-if="selectedItem.displayMode === 'full'"
              :model-value="selectedItem.translation"
              :items="scriptureTranslations"
              item-title="name"
              item-value="code"
              label="Translation"
              variant="outlined"
              density="compact"
              style="max-width: 300px"
              class="mb-2"
              @update:model-value="
                (value: string) => updateScriptureTranslation(selectedItem!.id, value)
              "
            />
            <div
              v-if="selectedItem.displayMode === 'reference-only'"
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="
                itemHasLive(selectedItemIndex)
                  ? undefined
                  : {
                      background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                      borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                      paddingLeft: '9px',
                    }
              "
              @click="goLive(slideFlatIndex(selectedItem.id, 0))"
            >
              <div class="text-body-2 text-medium-emphasis">
                Reference only — no verse text shown.
              </div>
            </div>
            <div
              v-else-if="selectedScriptureError"
              class="slide-row"
              :style="{
                background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                paddingLeft: '9px',
              }"
            >
              <div class="text-body-2 text-error">{{ selectedScriptureError }}</div>
            </div>
            <div
              v-else-if="!selectedScripturePassage"
              class="slide-row"
              :style="{
                background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                paddingLeft: '9px',
              }"
            >
              <div class="text-body-2 text-medium-emphasis">Loading…</div>
            </div>
            <!-- One selector per actual auto-split page — a long passage that pagination
                 splits across several slides gets one clickable row per page, same pattern as
                 Slide-ref/Sermon-outline below, instead of one undifferentiated block that
                 could only ever go live on the passage's first page. -->
            <div v-else class="d-flex flex-column ga-1">
              <div
                v-for="(slide, index) in selectedItemFlatSlides"
                :key="slide.key"
                class="slide-row"
                :class="{ 'slide-row--live': flatIndex === slideFlatIndex(selectedItem.id, index) }"
                :style="
                  flatIndex === slideFlatIndex(selectedItem.id, index)
                    ? undefined
                    : {
                        background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                        borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                        paddingLeft: '9px',
                      }
                "
                @click="goLive(slideFlatIndex(selectedItem.id, index))"
              >
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="slide-row-title-row">
                    <span
                      v-if="selectedItemFlatSlides.length > 1"
                      class="text-caption text-medium-emphasis"
                    >
                      {{ slide.subLabel }}
                    </span>
                    <span
                      v-if="flatIndex === slideFlatIndex(selectedItem.id, index)"
                      class="slide-row-live-badge"
                      ><i />Live</span
                    >
                  </div>
                  <div class="text-body-2" style="white-space: pre-line">{{ slide.text }}</div>
                </div>
              </div>
            </div>
          </template>

          <template
            v-else-if="selectedItem.type === 'slide-ref' || selectedItem.type === 'text-slide'"
          >
            <p
              v-if="!selectedSlideGroup || selectedSlideGroup.length === 0"
              class="text-medium-emphasis"
            >
              {{
                selectedItem.type === 'slide-ref'
                  ? 'Slide not found in the library.'
                  : 'No slides yet.'
              }}
            </p>
            <div v-else class="d-flex flex-column ga-1">
              <div
                v-for="(slide, index) in selectedSlideGroup"
                :key="slide.id"
                class="slide-row"
                :class="{ 'slide-row--live': flatIndex === slideFlatIndex(selectedItem.id, index) }"
                :style="
                  flatIndex === slideFlatIndex(selectedItem.id, index)
                    ? undefined
                    : {
                        background: 'rgba(var(--v-theme-amber), 0.08)',
                        borderLeft: '3px solid rgb(var(--v-theme-amber))',
                        paddingLeft: '9px',
                      }
                "
                @click="goLive(slideFlatIndex(selectedItem.id, index))"
              >
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="slide-row-title-row">
                    <span class="text-body-2 font-weight-bold">{{ slide.label }}</span>
                    <span
                      v-if="flatIndex === slideFlatIndex(selectedItem.id, index)"
                      class="slide-row-live-badge"
                      ><i />Live</span
                    >
                  </div>
                  <div class="text-body-2" style="white-space: pre-line; opacity: 0.75">
                    {{ slideGroupText(slide) }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'media' || selectedItem.type === 'video'">
            <div class="media-item-controls">
              <v-btn-toggle
                v-if="selectedItem.type === 'media'"
                :model-value="selectedItem.fit"
                mandatory
                density="compact"
                divided
                @update:model-value="updateSelectedMediaFit"
              >
                <v-btn value="cover" size="small">Cover (crop to fill)</v-btn>
                <v-btn value="contain" size="small">Contain (show in full)</v-btn>
              </v-btn-toggle>
              <v-btn
                variant="outlined"
                color="primary"
                :prepend-icon="
                  selectedItem.type === 'media'
                    ? 'mdi-image-search-outline'
                    : 'mdi-movie-open-outline'
                "
                size="small"
                @click="openChangeMediaPicker"
              >
                {{ selectedItem.type === 'media' ? 'Change Image' : 'Change Video' }}
              </v-btn>
            </div>
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="[
                { maxWidth: '460px' },
                itemHasLive(selectedItemIndex)
                  ? {}
                  : {
                      background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                      borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                      paddingLeft: '9px',
                    },
              ]"
              @click="goLive(flatSlides.findIndex((s) => s.itemIndex === selectedItemIndex))"
            >
              <div v-if="selectedMediaError" class="text-body-2 text-error">
                {{ selectedMediaError }}
              </div>
              <img
                v-else-if="selectedMediaUrl && selectedItem.type === 'media'"
                :src="selectedMediaUrl"
                class="media-preview"
                alt=""
              />
              <video
                v-else-if="selectedMediaUrl"
                :src="selectedMediaUrl"
                class="media-preview"
                muted
                controls
              />
              <div v-else class="text-body-2 text-medium-emphasis">Loading…</div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'sermon'">
            <v-text-field
              :model-value="selectedItem.title"
              label="Sermon Title (optional)"
              placeholder="e.g. From Chained to Commissioned"
              variant="outlined"
              density="compact"
              clearable
              hide-details
              class="mb-4"
              style="max-width: 460px"
              @update:model-value="(value: string) => updateSermonTitle(selectedItem!.id, value)"
            />
            <div class="d-flex align-center justify-space-between mb-1">
              <div class="text-overline text-medium-emphasis">Sermon Flow</div>
              <div class="d-flex ga-2">
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-book-plus-outline"
                  @click="addSermonPassage(selectedItem!.id)"
                  >Add Scripture</v-btn
                ><v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-format-list-bulleted"
                  @click="addSermonOutlineBlock(selectedItem!.id)"
                  >Add Point</v-btn
                >
              </div>
            </div>
            <p class="text-caption text-medium-emphasis mb-2">
              The main passage is presented first. Drag supporting scripture and outline points into
              the order you will use them.
            </p>
            <div
              v-if="mainSermonPassage.id && selectedItem.presentMainPassage !== false"
              class="sermon-flow-entry mb-2"
            >
              <div
                class="slide-row"
                :class="{
                  'slide-row--live': passageFlatSlides(mainSermonPassage.id).some(
                    (slide) => flatIndex === flatIndexForKey(slide.key),
                  ),
                }"
                @click="selectMainSermonFlow"
              >
                <v-icon
                  :icon="expandedMainSermonPassage ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                  size="small"
                />
                <v-icon icon="mdi-pin-outline" size="small" />
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="slide-row-title-row">
                    <strong class="text-body-2 text-truncate">{{
                      mainSermonPassage.reference || 'Main passage'
                    }}</strong
                    ><span
                      v-if="
                        passageFlatSlides(mainSermonPassage.id).some(
                          (slide) => flatIndex === flatIndexForKey(slide.key),
                        )
                      "
                      class="slide-row-live-badge"
                      ><i />Live</span
                    >
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    Main passage ·
                    {{ mainSermonPassage.displayMode === 'full' ? 'Full text' : 'Reference only' }}
                  </div>
                </div>
                <v-btn
                  :icon="
                    editingSermonPassageId === mainSermonPassage.id
                      ? 'mdi-check'
                      : 'mdi-pencil-outline'
                  "
                  variant="text"
                  size="x-small"
                  @click.stop="toggleSermonPassageEdit(mainSermonPassage.id)"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  size="x-small"
                  class="row-remove"
                  @click.stop="removeSermonPassage(selectedItem!.id, mainSermonPassage.id)"
                />
              </div>
              <div v-if="expandedMainSermonPassage" class="sermon-flow-detail">
                <template v-if="editingSermonPassageId === mainSermonPassage.id">
                  <v-text-field
                    v-model="sermonPassageReferenceDrafts[mainSermonPassage.id]"
                    label="Reference"
                    variant="outlined"
                    density="compact"
                    class="mb-2"
                    @blur="commitSermonPassageReference(selectedItem!.id, mainSermonPassage.id)"
                  />
                  <v-btn-toggle
                    :model-value="mainSermonPassage.displayMode"
                    mandatory
                    density="compact"
                    divided
                    class="mb-2"
                    @update:model-value="
                      (value: 'full' | 'reference-only') =>
                        updateSermonPassageDisplayMode(
                          selectedItem!.id,
                          mainSermonPassage!.id,
                          value,
                        )
                    "
                    ><v-btn value="full" size="small">Show Full Text</v-btn
                    ><v-btn value="reference-only" size="small">Reference Only</v-btn></v-btn-toggle
                  >
                  <v-select
                    v-if="mainSermonPassage.displayMode === 'full'"
                    :model-value="mainSermonPassage.translation"
                    :items="scriptureTranslations"
                    item-title="name"
                    item-value="code"
                    label="Translation"
                    variant="outlined"
                    density="compact"
                    @update:model-value="
                      (value: string) =>
                        updateSermonPassageTranslation(
                          selectedItem!.id,
                          mainSermonPassage!.id,
                          value,
                        )
                    "
                  />
                </template>
                <div
                  v-if="mainSermonPassage.displayMode === 'reference-only'"
                  class="slide-row"
                  :class="{
                    'slide-row--live':
                      flatIndex ===
                      flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? ''),
                  }"
                  @click="
                    goLive(flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? ''))
                  "
                >
                  <div class="slide-row-title-row">
                    <span>Reference only — no verse text shown.</span
                    ><span
                      v-if="
                        flatIndex ===
                        flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? '')
                      "
                      class="slide-row-live-badge"
                      ><i />Live</span
                    >
                  </div>
                </div>
                <div
                  v-else-if="scriptureErrors.get(`${selectedItem!.id}:${mainSermonPassage.id}`)"
                  class="text-error"
                >
                  {{ scriptureErrors.get(`${selectedItem!.id}:${mainSermonPassage.id}`) }}
                </div>
                <div
                  v-else-if="!scriptureById.get(`${selectedItem!.id}:${mainSermonPassage.id}`)"
                  class="text-medium-emphasis"
                >
                  Loading…
                </div>
                <div v-else class="d-flex flex-column ga-1">
                  <div
                    v-for="slide in passageFlatSlides(mainSermonPassage.id)"
                    :key="slide.key"
                    class="slide-row"
                    :class="{ 'slide-row--live': flatIndex === flatIndexForKey(slide.key) }"
                    @click="goLive(flatIndexForKey(slide.key))"
                  >
                    <div>
                      <div class="slide-row-title-row">
                        <span
                          v-if="passageFlatSlides(mainSermonPassage.id).length > 1"
                          class="text-caption text-medium-emphasis"
                          >{{ slide.subLabel }}</span
                        ><span
                          v-if="flatIndex === flatIndexForKey(slide.key)"
                          class="slide-row-live-badge"
                          ><i />Live</span
                        >
                      </div>
                      <div class="text-body-2" style="white-space: pre-line">{{ slide.text }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="sermon-flow-entry mb-2">
              <div class="slide-row">
                <v-icon icon="mdi-pin-outline" size="small" />
                <div class="flex-grow-1" style="min-width: 0">
                  <strong class="text-body-2">Main passage</strong>
                  <div class="text-caption text-medium-emphasis">Not set</div>
                </div>
                <v-btn
                  icon="mdi-plus"
                  variant="text"
                  size="x-small"
                  aria-label="Add main passage"
                  @click.stop="addMainSermonPassage(selectedItem!.id)"
                />
              </div>
            </div>
            <VueDraggable
              v-if="sermonFlow.length"
              v-model="sermonFlow"
              handle=".sermon-flow-drag"
              :animation="150"
              class="d-flex flex-column ga-2 mb-4"
            >
              <div v-for="entry in sermonFlow" :key="entry.key" class="sermon-flow-entry">
                <div
                  class="slide-row"
                  :class="{ 'slide-row--live': sermonFlowEntryIsLive(entry) }"
                  @click="selectSermonFlowEntry(entry)"
                >
                  <v-icon
                    icon="mdi-drag-vertical"
                    class="sermon-flow-drag"
                    size="small"
                    @click.stop
                  />
                  <v-icon
                    :icon="
                      entry.type === 'passage'
                        ? expandedSupportingPassageId === entry.key.slice('passage:'.length)
                          ? 'mdi-chevron-down'
                          : 'mdi-chevron-right'
                        : expandedSermonOutlineId === entry.key.slice('outline:'.length)
                          ? 'mdi-chevron-down'
                          : 'mdi-chevron-right'
                    "
                    size="small"
                  />
                  <v-icon
                    :icon="
                      entry.type === 'passage'
                        ? 'mdi-book-open-page-variant-outline'
                        : 'mdi-format-list-bulleted'
                    "
                    size="small"
                  />
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="slide-row-title-row">
                      <strong class="text-body-2 text-truncate">{{ entry.label }}</strong
                      ><span v-if="sermonFlowEntryIsLive(entry)" class="slide-row-live-badge"
                        ><i />Live</span
                      >
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      {{ entry.type === 'passage' ? entry.detail : 'Outline point' }}
                    </div>
                  </div>
                  <v-btn
                    :icon="
                      entry.type === 'passage'
                        ? editingSermonPassageId === entry.key.slice('passage:'.length)
                          ? 'mdi-check'
                          : 'mdi-pencil-outline'
                        : editingSermonOutlineId === entry.key.slice('outline:'.length)
                          ? 'mdi-check'
                          : 'mdi-pencil-outline'
                    "
                    variant="text"
                    size="x-small"
                    @click.stop="
                      entry.type === 'passage'
                        ? toggleSermonPassageEdit(entry.key.slice('passage:'.length))
                        : toggleSermonOutlineEdit(entry.key.slice('outline:'.length))
                    "
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    variant="text"
                    size="x-small"
                    class="row-remove"
                    @click.stop="removeSermonFlowEntry(entry)"
                  />
                </div>
                <div
                  v-if="
                    entry.type === 'passage' &&
                    expandedSupportingPassageId === entry.key.slice('passage:'.length) &&
                    sermonFlowPassage(entry)
                  "
                  class="sermon-flow-detail"
                >
                  <template v-if="editingSermonPassageId === sermonFlowPassage(entry)!.id"
                    ><v-text-field
                      v-model="sermonPassageReferenceDrafts[sermonFlowPassage(entry)!.id]"
                      label="Reference"
                      variant="outlined"
                      density="compact"
                      class="mb-2"
                      @blur="
                        commitSermonPassageReference(
                          selectedSermonId(),
                          sermonFlowPassage(entry)!.id,
                        )
                      " /><v-btn-toggle
                      :model-value="sermonFlowPassage(entry)!.displayMode"
                      mandatory
                      density="compact"
                      divided
                      class="mb-2"
                      @update:model-value="
                        (value: 'full' | 'reference-only') =>
                          updateSermonPassageDisplayMode(
                            selectedSermonId(),
                            sermonFlowPassage(entry)!.id,
                            value,
                          )
                      "
                      ><v-btn value="full" size="small">Show Full Text</v-btn
                      ><v-btn value="reference-only" size="small"
                        >Reference Only</v-btn
                      ></v-btn-toggle
                    ><v-select
                      v-if="sermonFlowPassage(entry)!.displayMode === 'full'"
                      :model-value="sermonFlowPassage(entry)!.translation"
                      :items="scriptureTranslations"
                      item-title="name"
                      item-value="code"
                      label="Translation"
                      variant="outlined"
                      density="compact"
                      @update:model-value="
                        (value: string) =>
                          updateSermonPassageTranslation(
                            selectedSermonId(),
                            sermonFlowPassage(entry)!.id,
                            value,
                          )
                      "
                  /></template>
                  <div
                    v-if="sermonFlowPassage(entry)!.displayMode === 'reference-only'"
                    class="slide-row"
                    :class="{
                      'slide-row--live':
                        flatIndex ===
                        flatIndexForKey(
                          passageFlatSlides(sermonFlowPassage(entry)!.id)[0]?.key ?? '',
                        ),
                    }"
                    @click="
                      goLive(
                        flatIndexForKey(
                          passageFlatSlides(sermonFlowPassage(entry)!.id)[0]?.key ?? '',
                        ),
                      )
                    "
                  >
                    <div class="slide-row-title-row">
                      <span>Reference only — no verse text shown.</span
                      ><span
                        v-if="
                          flatIndex ===
                          flatIndexForKey(
                            passageFlatSlides(sermonFlowPassage(entry)!.id)[0]?.key ?? '',
                          )
                        "
                        class="slide-row-live-badge"
                        ><i />Live</span
                      >
                    </div>
                  </div>
                  <div
                    v-else-if="
                      scriptureErrors.get(`${selectedSermonId()}:${sermonFlowPassage(entry)!.id}`)
                    "
                    class="text-error"
                  >
                    {{
                      scriptureErrors.get(`${selectedSermonId()}:${sermonFlowPassage(entry)!.id}`)
                    }}
                  </div>
                  <div
                    v-else-if="
                      !scriptureById.get(`${selectedSermonId()}:${sermonFlowPassage(entry)!.id}`)
                    "
                    class="text-medium-emphasis"
                  >
                    Loading…
                  </div>
                  <div v-else class="d-flex flex-column ga-1">
                    <div
                      v-for="slide in passageFlatSlides(sermonFlowPassage(entry)!.id)"
                      :key="slide.key"
                      class="slide-row"
                      :class="{ 'slide-row--live': flatIndex === flatIndexForKey(slide.key) }"
                      @click="goLive(flatIndexForKey(slide.key))"
                    >
                      <div>
                        <div class="slide-row-title-row">
                          <span class="text-caption text-medium-emphasis">{{ slide.subLabel }}</span
                          ><span
                            v-if="flatIndex === flatIndexForKey(slide.key)"
                            class="slide-row-live-badge"
                            ><i />Live</span
                          >
                        </div>
                        <div class="text-body-2" style="white-space: pre-line">
                          {{ slide.text }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  v-if="
                    entry.type === 'outline' &&
                    expandedSermonOutlineId === entry.key.slice('outline:'.length) &&
                    sermonFlowOutline(entry)
                  "
                  class="sermon-flow-detail"
                >
                  <template v-if="editingSermonOutlineId === sermonFlowOutline(entry)!.id"
                    ><v-text-field
                      v-model="sermonFlowOutline(entry)!.label"
                      label="Title"
                      variant="outlined"
                      density="compact"
                      class="mb-2" /><v-textarea
                      v-model="sermonFlowOutline(entry)!.text"
                      label="Details"
                      variant="outlined"
                      density="compact"
                      rows="3"
                      auto-grow
                  /></template>
                  <div
                    class="slide-row"
                    :class="{ 'slide-row--live': sermonFlowEntryIsLive(entry) }"
                    @click="
                      goLive(sermonOutlineFlatIndex(selectedItem, sermonFlowOutlineIndex(entry)))
                    "
                  >
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="slide-row-title-row">
                        <span class="text-body-2 font-weight-bold">{{
                          sermonFlowOutline(entry)!.label || 'Untitled point'
                        }}</span
                        ><span v-if="sermonFlowEntryIsLive(entry)" class="slide-row-live-badge"
                          ><i />Live</span
                        >
                      </div>
                      <div
                        v-if="sermonFlowOutline(entry)!.text"
                        class="text-body-2 text-medium-emphasis mt-1"
                        style="white-space: pre-line"
                      >
                        {{ sermonFlowOutline(entry)!.text }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </VueDraggable>
            <p v-else class="text-caption text-medium-emphasis mb-4">
              Add supporting scripture or outline points below to build the rest of the flow.
            </p>
            <div v-if="selectedItem && selectedItem.type === 'sermon'" style="display: none">
              <div class="text-overline text-medium-emphasis mb-2">Main Passage</div>
              <div class="mb-3">
                <div class="d-flex align-center justify-space-between mb-1" style="gap: 6px">
                  <div class="text-body-2 font-weight-bold text-truncate" style="min-width: 0">
                    {{ mainSermonPassage.reference || 'Untitled passage' }}
                  </div>
                  <div class="d-flex align-center ga-1" style="flex: none">
                    <v-btn
                      :icon="
                        editingSermonPassageId === mainSermonPassage.id
                          ? 'mdi-check'
                          : 'mdi-pencil-outline'
                      "
                      variant="text"
                      size="x-small"
                      :title="
                        editingSermonPassageId === mainSermonPassage.id
                          ? 'Done editing'
                          : 'Edit passage'
                      "
                      @click="toggleSermonPassageEdit(mainSermonPassage.id)"
                    />
                    <v-btn
                      icon="mdi-delete-outline"
                      variant="text"
                      size="x-small"
                      title="Remove passage"
                      @click="removeSermonPassage(selectedItem!.id, mainSermonPassage.id)"
                    />
                  </div>
                </div>
                <template v-if="editingSermonPassageId === mainSermonPassage.id">
                  <v-text-field
                    v-model="sermonPassageReferenceDrafts[mainSermonPassage.id]"
                    label="Reference"
                    placeholder="e.g. John 3:16-17"
                    variant="outlined"
                    density="compact"
                    style="max-width: 460px"
                    class="mb-2"
                    @blur="commitSermonPassageReference(selectedItem!.id, mainSermonPassage.id)"
                  />
                  <v-btn-toggle
                    :model-value="mainSermonPassage.displayMode"
                    mandatory
                    density="compact"
                    divided
                    class="mb-2"
                    @update:model-value="
                      (value: 'full' | 'reference-only') =>
                        updateSermonPassageDisplayMode(
                          selectedItem!.id,
                          mainSermonPassage!.id,
                          value,
                        )
                    "
                  >
                    <v-btn value="full" size="small">Show Full Text</v-btn>
                    <v-btn value="reference-only" size="small">Reference Only</v-btn>
                  </v-btn-toggle>
                  <v-select
                    v-if="mainSermonPassage.displayMode === 'full'"
                    :model-value="mainSermonPassage.translation"
                    :items="scriptureTranslations"
                    item-title="name"
                    item-value="code"
                    label="Translation"
                    variant="outlined"
                    density="compact"
                    style="max-width: 300px"
                    class="mb-2"
                    @update:model-value="
                      (value: string) =>
                        updateSermonPassageTranslation(
                          selectedItem!.id,
                          mainSermonPassage!.id,
                          value,
                        )
                    "
                  />
                </template>
                <div
                  v-if="mainSermonPassage.displayMode === 'reference-only'"
                  class="slide-row"
                  :class="{
                    'slide-row--live':
                      flatIndex ===
                      flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? ''),
                  }"
                  :style="
                    flatIndex ===
                    flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? '')
                      ? undefined
                      : {
                          background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                          borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                          paddingLeft: '9px',
                        }
                  "
                  @click="
                    goLive(flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? ''))
                  "
                >
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="slide-row-title-row">
                      <span class="text-body-2 text-medium-emphasis">
                        Reference only — no verse text shown.
                      </span>
                      <span
                        v-if="
                          flatIndex ===
                          flatIndexForKey(passageFlatSlides(mainSermonPassage.id)[0]?.key ?? '')
                        "
                        class="slide-row-live-badge"
                        ><i />Live</span
                      >
                    </div>
                  </div>
                </div>
                <div
                  v-else-if="scriptureErrors.get(`${selectedItem.id}:${mainSermonPassage.id}`)"
                  class="slide-row"
                  :style="{
                    background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                    borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                    paddingLeft: '9px',
                  }"
                >
                  <div class="text-body-2 text-error">
                    {{ scriptureErrors.get(`${selectedItem.id}:${mainSermonPassage.id}`) }}
                  </div>
                </div>
                <div
                  v-else-if="!scriptureById.get(`${selectedItem.id}:${mainSermonPassage.id}`)"
                  class="slide-row"
                  :style="{
                    background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                    borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                    paddingLeft: '9px',
                  }"
                >
                  <div class="text-body-2 text-medium-emphasis">Loading…</div>
                </div>
                <div v-else class="d-flex flex-column ga-1">
                  <div
                    v-for="slide in passageFlatSlides(mainSermonPassage.id)"
                    :key="slide.key"
                    class="slide-row"
                    :class="{ 'slide-row--live': flatIndex === flatIndexForKey(slide.key) }"
                    :style="
                      flatIndex === flatIndexForKey(slide.key)
                        ? undefined
                        : {
                            background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                            borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                            paddingLeft: '9px',
                          }
                    "
                    @click="goLive(flatIndexForKey(slide.key))"
                  >
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="slide-row-title-row">
                        <span
                          v-if="passageFlatSlides(mainSermonPassage.id).length > 1"
                          class="text-caption text-medium-emphasis"
                        >
                          {{ slide.subLabel }}
                        </span>
                        <span
                          v-if="flatIndex === flatIndexForKey(slide.key)"
                          class="slide-row-live-badge"
                          ><i />Live</span
                        >
                      </div>
                      <div class="text-body-2" style="white-space: pre-line">{{ slide.text }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="false" class="text-medium-emphasis mb-3">No passage yet.</p>

            <div v-if="selectedItem && selectedItem.type === 'sermon'" style="display: none">
              <template v-if="supportingSermonPassages.length > 0">
                <div class="text-overline text-medium-emphasis mt-4 mb-2">Supporting Passages</div>
                <VueDraggable
                  v-model="supportingSermonPassages"
                  handle=".drag-handle"
                  :animation="150"
                  class="d-flex flex-column ga-2 mb-3"
                >
                  <div v-for="passage in supportingSermonPassages" :key="passage.id">
                    <div
                      class="slide-row"
                      style="align-items: center"
                      :class="{
                        'slide-row--live':
                          expandedSupportingPassageId !== passage.id &&
                          passageFlatSlides(passage.id).some(
                            (s) => flatIndex === flatIndexForKey(s.key),
                          ),
                      }"
                      :style="
                        expandedSupportingPassageId === passage.id ||
                        passageFlatSlides(passage.id).some(
                          (s) => flatIndex === flatIndexForKey(s.key),
                        )
                          ? undefined
                          : {
                              background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                              borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                              paddingLeft: '9px',
                            }
                      "
                      @click="toggleSupportingPassageExpanded(passage.id)"
                    >
                      <v-icon
                        icon="mdi-drag-vertical"
                        class="drag-handle"
                        size="small"
                        style="cursor: grab"
                        @click.stop
                      />
                      <v-icon
                        :icon="
                          expandedSupportingPassageId === passage.id
                            ? 'mdi-chevron-down'
                            : 'mdi-chevron-right'
                        "
                        size="small"
                      />
                      <div class="flex-grow-1" style="min-width: 0">
                        <div class="slide-row-title-row">
                          <span class="text-body-2 font-weight-bold text-truncate">
                            {{ passage.reference || 'Untitled passage' }}
                          </span>
                          <span
                            v-if="
                              expandedSupportingPassageId !== passage.id &&
                              passageFlatSlides(passage.id).some(
                                (s) => flatIndex === flatIndexForKey(s.key),
                              )
                            "
                            class="slide-row-live-badge"
                            ><i />Live</span
                          >
                        </div>
                      </div>
                      <v-btn
                        :icon="
                          editingSermonPassageId === passage.id ? 'mdi-check' : 'mdi-pencil-outline'
                        "
                        variant="text"
                        size="x-small"
                        :title="
                          editingSermonPassageId === passage.id ? 'Done editing' : 'Edit passage'
                        "
                        @click.stop="toggleSermonPassageEdit(passage.id)"
                      />
                      <v-btn
                        icon="mdi-delete-outline"
                        variant="text"
                        size="x-small"
                        title="Remove passage"
                        class="row-remove"
                        @click.stop="removeSermonPassage(selectedItem!.id, passage.id)"
                      />
                    </div>
                    <div v-if="expandedSupportingPassageId === passage.id" class="mt-2 ml-6">
                      <template v-if="editingSermonPassageId === passage.id">
                        <v-text-field
                          v-model="sermonPassageReferenceDrafts[passage.id]"
                          label="Reference"
                          placeholder="e.g. John 3:16-17"
                          variant="outlined"
                          density="compact"
                          style="max-width: 460px"
                          class="mb-2"
                          @blur="commitSermonPassageReference(selectedItem!.id, passage.id)"
                        />
                        <v-btn-toggle
                          :model-value="passage.displayMode"
                          mandatory
                          density="compact"
                          divided
                          class="mb-2"
                          @update:model-value="
                            (value: 'full' | 'reference-only') =>
                              updateSermonPassageDisplayMode(selectedItem!.id, passage.id, value)
                          "
                        >
                          <v-btn value="full" size="small">Show Full Text</v-btn>
                          <v-btn value="reference-only" size="small">Reference Only</v-btn>
                        </v-btn-toggle>
                        <v-select
                          v-if="passage.displayMode === 'full'"
                          :model-value="passage.translation"
                          :items="scriptureTranslations"
                          item-title="name"
                          item-value="code"
                          label="Translation"
                          variant="outlined"
                          density="compact"
                          style="max-width: 300px"
                          class="mb-2"
                          @update:model-value="
                            (value: string) =>
                              updateSermonPassageTranslation(selectedItem!.id, passage.id, value)
                          "
                        />
                      </template>
                      <div
                        v-if="passage.displayMode === 'reference-only'"
                        class="slide-row"
                        :class="{
                          'slide-row--live':
                            flatIndex ===
                            flatIndexForKey(passageFlatSlides(passage.id)[0]?.key ?? ''),
                        }"
                        :style="
                          flatIndex === flatIndexForKey(passageFlatSlides(passage.id)[0]?.key ?? '')
                            ? undefined
                            : {
                                background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                                borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                                paddingLeft: '9px',
                              }
                        "
                        @click="
                          goLive(flatIndexForKey(passageFlatSlides(passage.id)[0]?.key ?? ''))
                        "
                      >
                        <div class="flex-grow-1" style="min-width: 0">
                          <div class="slide-row-title-row">
                            <span class="text-body-2 text-medium-emphasis">
                              Reference only — no verse text shown.
                            </span>
                            <span
                              v-if="
                                flatIndex ===
                                flatIndexForKey(passageFlatSlides(passage.id)[0]?.key ?? '')
                              "
                              class="slide-row-live-badge"
                              ><i />Live</span
                            >
                          </div>
                        </div>
                      </div>
                      <div
                        v-else-if="scriptureErrors.get(`${selectedItem.id}:${passage.id}`)"
                        class="slide-row"
                        :style="{
                          background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                          borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                          paddingLeft: '9px',
                        }"
                      >
                        <div class="text-body-2 text-error">
                          {{ scriptureErrors.get(`${selectedItem.id}:${passage.id}`) }}
                        </div>
                      </div>
                      <div
                        v-else-if="!scriptureById.get(`${selectedItem.id}:${passage.id}`)"
                        class="slide-row"
                        :style="{
                          background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                          borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                          paddingLeft: '9px',
                        }"
                      >
                        <div class="text-body-2 text-medium-emphasis">Loading…</div>
                      </div>
                      <div v-else class="d-flex flex-column ga-1">
                        <div
                          v-for="slide in passageFlatSlides(passage.id)"
                          :key="slide.key"
                          class="slide-row"
                          :class="{ 'slide-row--live': flatIndex === flatIndexForKey(slide.key) }"
                          :style="
                            flatIndex === flatIndexForKey(slide.key)
                              ? undefined
                              : {
                                  background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                                  borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                                  paddingLeft: '9px',
                                }
                          "
                          @click="goLive(flatIndexForKey(slide.key))"
                        >
                          <div class="flex-grow-1" style="min-width: 0">
                            <div class="slide-row-title-row">
                              <span
                                v-if="passageFlatSlides(passage.id).length > 1"
                                class="text-caption text-medium-emphasis"
                              >
                                {{ slide.subLabel }}
                              </span>
                              <span
                                v-if="flatIndex === flatIndexForKey(slide.key)"
                                class="slide-row-live-badge"
                                ><i />Live</span
                              >
                            </div>
                            <div class="text-body-2" style="white-space: pre-line">
                              {{ slide.text }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </VueDraggable>
              </template>
              <v-btn
                variant="outlined"
                size="small"
                class="mb-4"
                prepend-icon="mdi-plus"
                @click="addSermonPassage(selectedItem!.id)"
              >
                Add Passage
              </v-btn>

              <div class="text-overline text-medium-emphasis mt-4 mb-2">Outline</div>
              <p v-if="selectedItem.outline.length === 0" class="text-medium-emphasis">
                No outline yet.
              </p>
              <VueDraggable
                v-else
                v-model="selectedItem.outline"
                handle=".drag-handle"
                :animation="150"
                class="d-flex flex-column ga-2"
              >
                <div
                  v-for="(block, index) in selectedItem.outline"
                  :key="block.id"
                  class="slide-row"
                  style="flex-direction: column; align-items: stretch"
                  :class="{
                    'slide-row--live': flatIndex === sermonOutlineFlatIndex(selectedItem, index),
                  }"
                  :style="
                    flatIndex === sermonOutlineFlatIndex(selectedItem, index)
                      ? undefined
                      : {
                          background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                          borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                          paddingLeft: '9px',
                        }
                  "
                >
                  <div
                    class="d-flex align-center"
                    style="gap: 10px; cursor: pointer"
                    @click="toggleSermonOutlineLive(selectedItem, block.id, index)"
                  >
                    <!-- Only draggable while actively editing — reordering isn't something you'd
                       do while just browsing, and showing a handle on every collapsed point
                       would clutter the common case. -->
                    <v-icon
                      v-if="editingSermonOutlineId === block.id"
                      icon="mdi-drag-vertical"
                      class="drag-handle"
                      size="small"
                      style="cursor: grab"
                      @click.stop
                    />
                    <v-icon
                      :icon="
                        expandedSermonOutlineId === block.id
                          ? 'mdi-chevron-down'
                          : 'mdi-chevron-right'
                      "
                      size="small"
                    />
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="slide-row-title-row">
                        <span class="text-body-2 font-weight-bold text-truncate">
                          {{ block.label || 'Untitled point' }}
                        </span>
                        <span
                          v-if="flatIndex === sermonOutlineFlatIndex(selectedItem, index)"
                          class="slide-row-live-badge"
                          ><i />Live</span
                        >
                      </div>
                    </div>
                    <v-btn
                      :icon="
                        editingSermonOutlineId === block.id ? 'mdi-check' : 'mdi-pencil-outline'
                      "
                      variant="text"
                      size="x-small"
                      :title="editingSermonOutlineId === block.id ? 'Done editing' : 'Edit point'"
                      @click.stop="toggleSermonOutlineEdit(block.id)"
                    />
                    <v-btn
                      icon="mdi-delete-outline"
                      variant="text"
                      size="x-small"
                      class="row-remove"
                      @click.stop="removeSermonOutlineBlock(selectedItem!.id, index)"
                    />
                  </div>
                  <div v-if="expandedSermonOutlineId === block.id" class="mt-2" @click.stop>
                    <template v-if="editingSermonOutlineId === block.id">
                      <v-text-field
                        v-model="block.label"
                        label="Title"
                        variant="outlined"
                        density="compact"
                        class="mb-2"
                      />
                      <v-textarea
                        v-model="block.text"
                        label="Details"
                        variant="outlined"
                        density="compact"
                        rows="3"
                        auto-grow
                      />
                    </template>
                    <div v-else-if="block.text" class="text-body-2" style="white-space: pre-line">
                      {{ block.text }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis font-italic">
                      No details yet.
                    </div>
                  </div>
                </div>
              </VueDraggable>
              <v-btn
                variant="outlined"
                size="small"
                class="mt-2"
                prepend-icon="mdi-plus"
                @click="addSermonOutlineBlock(selectedItem!.id)"
              >
                Add Outline Point
              </v-btn>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'bulletin-note'">
            <div class="bulletin-only-callout">
              <span class="bulletin-only-icon"
                ><v-icon icon="mdi-file-document-outline" size="20"
              /></span>
              <div>
                <div class="font-weight-bold text-body-2">Printed service item</div>
                <div class="text-caption text-medium-emphasis">
                  This appears in the Order of Worship and never becomes a presentation slide.
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'placeholder'">
            <div
              class="slide-row"
              style="
                max-width: 460px;
                background: rgba(var(--v-theme-amber), 0.08);
                border-left: 3px solid rgb(var(--v-theme-amber));
                padding-left: 9px;
              "
            >
              <div class="flex-grow-1" style="min-width: 0">
                <div class="text-body-2 font-weight-bold">{{ selectedItem.label }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  This slot hasn't been filled in yet.
                </div>
              </div>
            </div>
            <v-btn
              variant="flat"
              color="primary"
              class="mt-3"
              prepend-icon="mdi-pencil"
              @click="beginReplaceItem(selectedItem, selectedItemIndex)"
            >
              Fill In This Slot
            </v-btn>
          </template>

          <template v-else-if="selectedItem.type === 'external-app'">
            <v-btn
              variant="text"
              size="small"
              color="secondary"
              prepend-icon="mdi-swap-horizontal"
              class="mb-2"
              @click="beginReplaceItem(selectedItem, selectedItemIndex)"
            >
              Change App / File
            </v-btn>
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="[
                { maxWidth: '460px' },
                itemHasLive(selectedItemIndex)
                  ? {}
                  : {
                      background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                      borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                      paddingLeft: '9px',
                    },
              ]"
              @click="goLive(flatSlides.findIndex((s) => s.itemIndex === selectedItemIndex))"
            >
              <div class="text-body-2">Click to make this item live.</div>
            </div>

            <div v-if="!externalAppLaunchAvailable" class="text-caption text-medium-emphasis mt-2" style="max-width: 460px">
              External apps aren't available on this device — launch this item from the computer
              that actually presents.
            </div>

            <!-- Reopen/Close act on whatever's actually engaged right now, so they only make
                 sense while this item IS the live one; otherwise "Launch Now" pre-launches it in
                 the background ahead of time so its slide going live doesn't pay the cold-start
                 delay (spawning, waiting for its window) live. Hidden entirely (rather than shown
                 disabled) once !externalAppLaunchAvailable — on that device they'd just be dead
                 buttons, the note above already explains why. -->
            <div v-if="externalAppLaunchAvailable" class="d-flex align-center ga-2 mt-3" style="max-width: 460px">
              <template v-if="isPresenting && itemHasLive(selectedItemIndex)">
                <v-btn
                  variant="tonal"
                  size="small"
                  prepend-icon="mdi-refresh"
                  @click="retryExternalApp"
                >
                  Reopen App
                </v-btn>
                <v-btn
                  variant="tonal"
                  size="small"
                  prepend-icon="mdi-close-box-outline"
                  @click="closeExternalApp"
                >
                  Close App
                </v-btn>
              </template>
              <v-btn
                v-else
                variant="tonal"
                size="small"
                prepend-icon="mdi-rocket-launch-outline"
                @click="prelaunchExternalApp(selectedItem)"
              >
                Launch Now
              </v-btn>
            </div>
            <!-- Every configured command always gets a button here (spec section 12's Basic
                 Remote Controls) — same set the phone Remote Control shows, regardless of
                 whether a command also has a keyboard trigger. Only meaningful once this item is
                 actually engaged, same condition as Reopen/Close App above. -->
            <div
              v-if="
                externalAppLaunchAvailable &&
                isPresenting &&
                itemHasLive(selectedItemIndex) &&
                selectedItemExternalAppCommands.length
              "
              class="d-flex align-center flex-wrap ga-2 mt-2"
              style="max-width: 460px"
            >
              <v-btn
                v-for="command in selectedItemExternalAppCommands"
                :key="command.id"
                variant="outlined"
                size="small"
                @click="sendManualCommand(selectedItem.profileId, command.id)"
              >
                {{ command.label }}
              </v-btn>
            </div>
            <v-alert
              v-if="prelaunchError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-2"
              style="max-width: 460px"
            >
              {{ prelaunchError }}
            </v-alert>
            <v-alert
              v-if="manualCommandError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-2"
              style="max-width: 460px"
            >
              {{ manualCommandError }}
            </v-alert>
          </template>

          <template v-else>
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="[
                { maxWidth: '460px' },
                itemHasLive(selectedItemIndex)
                  ? {}
                  : {
                      background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                      borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                      paddingLeft: '9px',
                    },
              ]"
              @click="goLive(flatSlides.findIndex((s) => s.itemIndex === selectedItemIndex))"
            >
              <div class="text-body-2">Click to make this item live.</div>
            </div>
          </template>

          <PropertyInspector
            :service="service"
            :selected-item="selectedItem"
            :library-auto-advance="selectedItemLibraryAutoAdvance"
            :theme-target-label="
              selectedThemeTarget ? themeTargetLabels[selectedThemeTarget] : undefined
            "
            :theme-override-options="themeOverrideOptions"
            :item-role-options="itemRoleOptions"
            :role-person-options="rolePersonOptions"
            :assigned-person-id="assignedPersonId"
            :update-item-role="updateItemRole"
            :update-role-person="updateRolePerson"
            :update-presenter-note="updatePresenterNote"
          />
        </template>
        <p v-else class="text-medium-emphasis">This service has no items yet.</p>
      </div>

      <div
        ref="previewPanelRef"
        class="preview-panel"
        :class="{ 'preview-drawer-open': isPreviewCompact && openDrawer === 'preview' }"
      >
        <div class="preview-panel-header">
          <div class="panel-title">Presentation</div>
        </div>
        <div class="preview-list">
          <div v-for="preview in previewSlots" :key="preview.label" class="preview-item">
            <div class="preview-label" :class="{ 'preview-label--live': preview.live }">
              <span v-if="preview.live" class="live-dot" />
              {{ preview.label }}
            </div>
            <div
              class="preview-thumb"
              :class="{ 'preview-thumb--live': preview.live }"
              :style="{
                width: `${previewThumbWidth}px`,
                aspectRatio: `${PREVIEW_VIRTUAL_SIZE.width} / ${PREVIEW_VIRTUAL_SIZE.height}`,
              }"
            >
              <SlideContentRenderer
                :content="preview.content"
                :fixed-size="PREVIEW_VIRTUAL_SIZE"
                :video-autoplay="false"
                :video-controls="false"
                :style="{ transform: `scale(${previewScale})`, transformOrigin: 'top left' }"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="isOrderCompact || isPreviewCompact"
        class="drawer-backdrop"
        :class="{ 'drawer-backdrop--visible': openDrawer !== null }"
        @click="openDrawer = null"
      />
    </div>

    <ExternalAppFailureAlert
      v-if="externalAppError"
      :error="externalAppError"
      @retry="retryExternalApp"
      @skip="skipExternalAppError"
    />

    <LiveTransportBar
      :compact="isShortViewport"
      :previous-disabled="previousDisabled"
      :next-disabled="nextDisabled"
      :prev-preview-label="prevPreviewLabel"
      :next-preview-label="nextPreviewLabel"
      :is-presenting="isPresenting"
      :current-slide-label="currentSlideLabel"
      :live-context-snippet="liveContextSnippet"
      :slide-position-label="slidePositionLabel"
      :background-only="backgroundOnly"
      :background-only-disabled="!liveSlide"
      :is-blank-screen="isBlankScreen"
      @previous="previous"
      @next="next"
      @toggle-background-only="toggleBackgroundOnly"
      @toggle-blank-screen="toggleBlankScreen"
    />

    <ReadinessDialog
      v-model="readinessDialogOpen"
      :readiness="readiness"
      :color="readinessColor"
      :icon="readinessIcon"
      @issue-selected="openReadinessIssue"
    />

    <AudiencePresentationDialog
      v-model="presentationDisplayDialogOpen"
      :displays="presentationDisplays"
      :loading="presentationDisplaysLoading"
      :error="presentationDisplayError"
      :selected-display-id="selectedAudienceDisplayId"
      @update:selected-display-id="selectedAudienceDisplayId = $event"
      @identify="identifyPresentationDisplay"
      @refresh="refreshPresentationDisplays()"
      @use-and-start="useAudienceDisplayAndStart"
    />

    <ServiceDetailsDialog v-if="service" v-model="serviceDetailsDialogOpen" :service="service" />

    <AddServiceItemDialog
      v-if="service"
      v-model="addDialogOpen"
      :service="service"
      v-model:selected-item-index="selectedItemIndex"
      v-model:scripture-draft="scriptureDraft"
      :type-title="activeAddTypeTitle"
      :initial-tab="addTab"
      :replace-context="addReplaceContext"
      :scripture-by-id="scriptureById"
      :scripture-translations="scriptureTranslations"
      :resolve-media-item="resolveMediaItem"
    />

    <MediaPickerDialog
      v-model="changeMediaPickerOpen"
      v-model:image-fit="changeMediaPickerFit"
      purpose="service-image"
      @select="changeSelectedMedia"
    />
    <MediaPickerDialog
      v-model="changeVideoPickerOpen"
      purpose="service-video"
      @select="changeSelectedVideo"
    />
  </div>
</template>

<style scoped>
/* Fills the space below the persistent app bar (49px, see App.vue) exactly, so the
   sticky-feeling live-footer and the Add-to-Service button never depend on the page
   itself scrolling — only the panels that actually need it (service list, center
   content) scroll internally. */
.workspace-root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 49px);
  overflow: hidden;
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-background), 0.92);
}
.workspace-save-error {
  flex: 0 0 auto;
  margin: 8px 14px 0;
}
.workspace-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  min-height: 82px;
  gap: 24px;
  padding: 11px 18px 11px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background:
    linear-gradient(90deg, rgba(var(--v-theme-primary), 0.035), transparent 420px),
    rgba(var(--v-theme-surface), 0.88);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.08);
  z-index: 2;
}
/* Below isNarrowToolbar's width, the service-context and actions rows no longer both fit on one
   line without colliding — stack them instead of letting them overlap. */
.workspace-toolbar--wrap {
  flex-wrap: wrap;
  gap: 8px 24px;
}
.workspace-toolbar--wrap .workspace-service-context {
  flex-basis: 100%;
  /* The icon is purely decorative — drop it and reclaim its grid column at the same point the
     toolbar wraps, since that's also the point it can least spare the width. */
  grid-template-columns: 36px minmax(0, 1fr) auto;
}
.workspace-toolbar--wrap .workspace-service-icon {
  display: none;
}
.workspace-toolbar--wrap .workspace-actions {
  flex-basis: 100%;
  flex-wrap: wrap;
  justify-content: flex-start;
}
/* Below isShortViewport's height, the toolbar's own fixed min-height and the sticky editor
   heading below it are two of the biggest consumers of a short landscape-tablet viewport —
   shrink both and drop the toolbar's date/time line. */
.workspace-root--short .workspace-toolbar {
  min-height: 56px;
}
.workspace-root--short .workspace-service-date {
  display: none;
}
.workspace-service-context {
  display: grid;
  /* Actions is flex:none (fixed to its own content) and this is the only other child of the
     flex row above — without growing, this sits at its own shrink-to-fit width even when the
     row has slack to spare, leaving a visible gap next to Planning/Assignments/etc. while the
     title truncates for no reason. Growing it means the title only ever truncates once the row
     is actually out of room, not before. */
  flex: 1 1 0;
  min-width: 0;
  grid-template-columns: 36px 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.service-back-button {
  color: rgba(var(--v-theme-on-surface), 0.56);
}
.workspace-service-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.workspace-service-heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  line-height: 1.25;
}
.workspace-title-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}
.workspace-service-title {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: -0.018em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presenting-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-error), 0.25);
  border-radius: 5px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.presenting-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.12);
}
.workspace-service-metadata {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
}
.workspace-service-date,
.workspace-service-sermon {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.72rem;
  white-space: nowrap;
}
.workspace-service-date {
  flex: none;
}
.workspace-service-date .v-icon {
  color: rgb(var(--v-theme-primary));
}
.workspace-service-sermon {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.48);
  text-overflow: ellipsis;
}
.workspace-service-sermon .v-icon {
  flex: none;
  color: rgb(var(--v-theme-violet));
}
.edit-service-button {
  align-self: center;
}
.workspace-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.workspace-actions :deep(.v-btn) {
  font-size: 0.72rem;
  letter-spacing: 0;
  text-transform: none;
}
.action-divider {
  width: 1px;
  height: 30px;
  margin: 0 3px;
  background: rgba(var(--v-theme-on-surface), 0.09);
}
.readiness-status {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid currentColor;
  border-radius: 7px;
  background: transparent;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.readiness-status--success {
  border-color: rgba(var(--v-theme-success), 0.3);
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}
.readiness-status--warning {
  border-color: rgba(var(--v-theme-warning), 0.35);
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}
.readiness-status--error {
  border-color: rgba(var(--v-theme-error), 0.36);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.readiness-status:hover {
  filter: brightness(1.12);
}
.present-button {
  min-width: 158px;
}
.present-button-wrap {
  display: inline-flex;
}
/* Keyed off isCompactActions (the toolbar's own measured width, not the window) — this is the
   first line of defense, trading the readiness badge and present button's own text for
   icon-only versions (same color/shape otherwise) so a single row keeps fitting a bit longer.
   Only once that's not enough does isNarrowToolbar's wrap class kick in. */
.workspace-toolbar--compact-actions .readiness-status {
  padding: 0 8px;
}
.workspace-toolbar--compact-actions .readiness-label {
  display: none;
}
.workspace-toolbar--compact-actions .present-button {
  min-width: 0;
  padding-inline: 12px;
}
.workspace-toolbar--compact-actions .present-button-label {
  display: none;
}
.workspace-toolbar--compact-actions .present-button :deep(.v-icon) {
  margin-inline-end: 0;
}
/* Keyed off isNarrowActions (same measured width the Planning/Assignments/Bulletin buttons
   collapse into the overflow menu at) rather than a separately-tuned window-width number, so
   the two changes that free up this row's space always happen together instead of one lagging
   the other and leaving a still-too-tight in-between range. */
.workspace-toolbar--narrow-actions .workspace-service-sermon {
  display: none;
}
.workspace-toolbar--narrow-actions .action-divider {
  display: none;
}
.workspace-layout {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(430px, 1fr) minmax(320px, 380px);
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: rgb(var(--v-theme-background));
}
/* Below isPreviewCompact (Vuetify's mdAndDown, <1280px) the preview panel becomes a toggleable
   overlay drawer instead of a permanent grid column — see the tablet-fit plan. Below the
   narrower isOrderCompact (<1000px) the Service Order List does too. The order list survives as
   a real column down to a narrower width than the preview panel deliberately: it's what the
   operator needs open most of the time, so it should keep its own space longer, with the center
   editor only reclaiming the *preview* panel's column first as width gets tight — both target
   tablets' landscape widths (iPad ~1080px, Tab S7+ ~1064px) land in exactly that middle zone:
   order list permanent, preview a drawer. Whichever panel is a drawer is pulled out via
   position:absolute and slid on/off-screen with transform, which never changes its layout box
   (so useLiveTransport.ts's ResizeObserver on previewPanelRef never sees a spurious resize when
   the drawer opens/closes). */
.workspace-layout--preview-drawer {
  position: relative;
  overflow: hidden;
}
.workspace-layout--preview-drawer .preview-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  /* 100%, not a vw-based value — vw is relative to the raw viewport, not to .workspace-layout
     (this element's actual positioning container), so it doesn't account for the app's own nav
     sidebar or the order-list column when that's also showing permanently. Using 88vw here used
     to mean the drawer's real DOM width could stay pinned at its 360px cap well past the point
     where the *visible* remaining space had already shrunk below that — nothing was actually
     resizing, just getting silently clipped by this container's own overflow:hidden, so neither
     the ResizeObserver above nor CSS's own max-width:100% on .preview-thumb ever saw it happen. */
  width: min(360px, 100%);
  border-left: none;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  transition: transform 0.22s ease;
  transform: translateX(100%);
}
.workspace-layout--preview-drawer .preview-panel.preview-drawer-open {
  transform: translateX(0);
}
/* Preview is a drawer but the order list is still a permanent column — reclaim just the third
   grid track for the center editor. */
.workspace-layout--preview-drawer:not(.workspace-layout--order-drawer) {
  grid-template-columns: minmax(280px, 330px) minmax(430px, 1fr);
}
/* Both become drawers — center editor takes the full width. */
.workspace-layout--order-drawer.workspace-layout--preview-drawer {
  display: block;
}
.workspace-layout--order-drawer.workspace-layout--preview-drawer .center-panel {
  height: 100%;
}
.workspace-layout--order-drawer.workspace-layout--preview-drawer :deep(.service-panel) {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 6;
  /* See the preview-panel rule above for why 100% (of .workspace-layout) rather than a vw-based
     value. */
  width: min(330px, 100%);
  border-right: none;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  transition: transform 0.22s ease;
  transform: translateX(-100%);
}
.workspace-layout--order-drawer.workspace-layout--preview-drawer :deep(.service-panel.order-drawer-open) {
  transform: translateX(0);
}
.drawer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.drawer-backdrop--visible {
  opacity: 1;
  pointer-events: auto;
}
.preview-panel-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.preview-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 14px 16px 22px;
}
.preview-item {
  min-width: 0;
}
.preview-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.preview-label--live {
  color: rgb(var(--v-theme-error));
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.12);
}
.preview-thumb {
  overflow: hidden;
  /* Belt-and-suspenders alongside previewThumbWidth's own ResizeObserver (useLiveTransport.ts,
     measures this exact element's real rendered rect directly on every previewPanelRef resize)
     — guarantees the box can never render wider than the space actually available even in the
     first paint before that observer's initial callback has fired. Safe to clamp here
     regardless of the inline pixel width. */
  max-width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 7px;
  background: #000;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
}
.preview-thumb--live {
  outline: 2px solid rgb(var(--v-theme-error));
  outline-offset: 3px;
  box-shadow: 0 8px 24px rgba(var(--v-theme-error), 0.13);
}
.center-panel {
  padding: 0 24px 28px;
  overflow-y: auto;
  min-width: 0;
  min-height: 0;
  background:
    radial-gradient(circle at 50% 0, rgba(var(--v-theme-primary), 0.045), transparent 340px),
    rgb(var(--v-theme-background));
}
.center-panel :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.62);
}
.editor-heading {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 74px;
  margin: 0 -24px 18px;
  padding: 12px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.94);
  backdrop-filter: blur(12px);
}
.workspace-root--short .editor-heading {
  min-height: 52px;
  margin-bottom: 12px;
  padding: 8px 24px;
}
.editor-eyebrow {
  margin-bottom: 2px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.editor-title {
  font-size: 1.12rem;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 1.25;
}
.editor-hint {
  max-width: 280px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
  line-height: 1.4;
  text-align: right;
}
.slide-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background-color 130ms ease,
    border-color 130ms ease;
}
.slide-row:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.18);
}
.media-preview {
  max-width: 100%;
  max-height: 220px;
  border-radius: 4px;
}
.media-item-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  margin-bottom: 12px;
}
.slide-row--live {
  background: rgba(var(--v-theme-error), 0.1);
  border-left: 5px solid rgb(var(--v-theme-error));
  padding-left: 7px;
}
.sermon-flow-entry {
  min-width: 0;
}
.sermon-flow-entry > .slide-row {
  align-items: center;
  cursor: pointer;
}
.sermon-flow-detail {
  margin: 6px 0 4px 30px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.34);
}
.sermon-flow-detail :deep(.v-field) {
  max-width: 520px;
}
.row-remove {
  opacity: 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  transition:
    opacity 120ms ease,
    color 120ms ease;
}
.slide-row:hover .row-remove {
  opacity: 1;
}
/* Same visual language as ServiceOrderList's live badge, for the sub-item rows within a
   selected item's own editor (bible verse pages, song arrangement blocks, sermon outline). */
.slide-row-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.slide-row-live-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid rgba(var(--v-theme-error), 0.25);
  border-radius: 5px;
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
  font-size: 0.6rem;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.slide-row-live-badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px rgba(var(--v-theme-error), 0.15);
}
.row-remove:hover {
  color: rgb(var(--v-theme-error));
}
.bulletin-only-callout {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 680px;
  padding: 13px 15px;
  border: 1px solid rgba(var(--v-theme-secondary), 0.2);
  border-radius: 8px;
  background: rgba(var(--v-theme-secondary), 0.07);
}
.bulletin-only-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-secondary), 0.14);
  color: rgb(var(--v-theme-secondary));
}
@media (max-width: 1500px) {
  .workspace-layout {
    grid-template-columns: 280px minmax(390px, 1fr) 320px;
  }
  .editor-hint {
    display: none;
  }
}
</style>
