<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { convertFileSrc } from '@tauri-apps/api/core'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { useMediaStore } from '@/stores/media'
import { useExternalAppsStore } from '@/stores/externalApps'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useSettingsStore } from '@/stores/settings'
import { flattenService, type FlatSlide } from '@/utils/flattenService'
import { colorForBlockLabel, colorForItemType } from '@/utils/contentColors'
import { formatCountdown } from '@/utils/countdown'
import { formatReference, getBookNames, getChapterCount, getVerseCount, isValidReference, parseReference } from '@/utils/scriptureReference'
import type { Service, ServiceItem } from '@/models/service'
import type { Song, SongBlock } from '@/models/song'
import type { SlideLibraryItem, MediaItem } from '@/models/library'
import type { ScripturePassage, ScriptureTranslation, LiveSlideContent, RemoteCommand } from '@/adapters/types'
import type { ScriptureReference } from '@/models/scripture'

const route = useRoute()
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const mediaStore = useMediaStore()
const externalAppsStore = useExternalAppsStore()
const settingsStore = useSettingsStore()
const { isPresenting } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

const service = ref<Service>()
const selectedItemIndex = ref(0)
/** -1 = nothing live yet; equal to flatSlides.length = live but past the last slide (blank). */
const flatIndex = ref(-1)

// Service details (date/type/sermon title/key passage/preacher) — the same fields
// CreateServiceView collects up front, editable afterward via this dialog rather than a
// separate screen, since it's the exact same small set of fields either way. Local drafts so
// Cancel discards cleanly; Save writes back to the real service (picked up by the existing
// deep watch on `service` below, same as any other in-place edit in this view).
const serviceDetailsDialogOpen = ref(false)
const editDate = ref('')
const editType = ref('')
const editSermonTitle = ref('')
const editKeyPassage = ref('')
const editPreacher = ref('')
function openServiceDetailsDialog() {
  if (!service.value) return
  editDate.value = service.value.date
  editType.value = service.value.type
  editSermonTitle.value = service.value.sermonTitle ?? ''
  editKeyPassage.value = service.value.keyPassage ?? ''
  editPreacher.value = service.value.preacher ?? ''
  serviceDetailsDialogOpen.value = true
}
function saveServiceDetails() {
  if (!service.value) return
  service.value.date = editDate.value
  service.value.type = editType.value
  service.value.sermonTitle = editSermonTitle.value || undefined
  service.value.keyPassage = editKeyPassage.value || undefined
  service.value.preacher = editPreacher.value || undefined
  serviceDetailsDialogOpen.value = false
}
// Matches the "weekday, month day, year" format already used for the Order of Worship export
// and planning report headers (see utils/orderOfWorship.ts/planningReport.ts) — one consistent
// date presentation across the app instead of the raw "YYYY-MM-DD" stored on disk.
const serviceDateLabel = computed(() =>
  service.value
    ? new Date(`${service.value.date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '',
)
// Same combine-and-skip-blanks pattern as ServiceCard's own subtitle line.
const serviceSubtitle = computed(() =>
  service.value ? [service.value.sermonTitle, service.value.keyPassage, service.value.preacher].filter(Boolean).join(' · ') : '',
)

const addDialogOpen = ref(false)
const addQuery = ref('')

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

async function resolveScriptureItem(item: ServiceItem) {
  if (item.type !== 'scripture' || item.displayMode === 'reference-only') return
  try {
    const passage = await getAdapter().scripture.resolve(item.reference, item.translation)
    scriptureById.set(item.id, passage)
    scriptureErrors.delete(item.id)
  } catch (e) {
    scriptureErrors.set(item.id, errorMessage(e, 'Failed to resolve passage.'))
  }
}

// Resolved media file src, keyed by MediaItem id (not service item id — several service items
// could reuse the same media). getFilePath is a real Rust round trip (only the Rust side
// knows library_root/local_media_root), so this can't happen inside flattenService's
// otherwise-synchronous walk — resolved once up front instead, same pattern as scripture above.
const mediaUrlById = reactive(new Map<string, string>())
const mediaErrors = reactive(new Map<string, string>())

async function resolveMediaItem(mediaId: string) {
  if (mediaUrlById.has(mediaId) || !getAdapter().media.getFilePath) return
  try {
    const path = await getAdapter().media.getFilePath!(mediaId)
    mediaUrlById.set(mediaId, convertFileSrc(path))
    mediaErrors.delete(mediaId)
  } catch (e) {
    mediaErrors.set(mediaId, errorMessage(e, 'Failed to load media file.'))
  }
}

// `watch` called after an `await` (inside onMounted's async callback) runs outside Vue's
// synchronous component-setup tracking, so it isn't auto-stopped on unmount — stopping it
// explicitly is what actually scopes it to this view's lifetime rather than leaking forever.
let stopServiceWatch: (() => void) | undefined
let unlistenRemoteCommand: (() => void) | undefined

// A live-ticking clock for Countdown items' operator-side preview (spec section 1) — the
// presentation window ticks its own independently, since it's a separate window/component.
const nowTick = ref(new Date())
let nowTickInterval: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  nowTickInterval = setInterval(() => (nowTick.value = new Date()), 1000)
  if (!songsStore.loaded) await songsStore.load()
  if (!slidesStore.loaded) await slidesStore.load()
  if (!mediaStore.loaded) await mediaStore.load()
  if (!externalAppsStore.loaded) await externalAppsStore.load()
  await loadPresentationSize()
  // A just-created service arrives via the store instead of disk — see CreateServiceView —
  // so it's never persisted until Save is actually pressed.
  const isDraft = servicesStore.draftService?.id === route.params.id
  if (isDraft) {
    service.value = servicesStore.draftService
    servicesStore.draftService = undefined
  } else {
    service.value = await getAdapter().services.get(route.params.id as string)
  }
  window.addEventListener('keydown', onKeydown)
  // A freshly created service is inherently unsaved — starting dirty (rather than false, as
  // for an existing service) enables the Save button and the router guard's
  // leave-without-saving warning immediately, so it's never silently lost with no way to
  // recover it.
  isDirty.value = isDraft
  // Registered after the initial load so it only reacts to actual edits, not the load
  // itself — content edits (arrangement, presenter notes) use an explicit Save button
  // rather than auto-save (see stores/unsavedChanges.ts); live-transport state
  // (flatIndex/isPresenting) is intentionally NOT part of this watch, since navigating
  // live isn't "unsaved content".
  stopServiceWatch = watch(service, () => (isDirty.value = true), { deep: true })
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveService
  // Keeps undo toasts from covering the live-transport footer's Previous/Next buttons,
  // which need to stay clickable even while a toast is showing during a live service.
  undoStore.bottomOffsetPx = 70

  // Remote Control (spec section 4): a paired phone's button press arrives here the same
  // way the presentation window receives slide changes — as a Tauri event, not a direct
  // function call, since the HTTP server lives entirely on the Rust side.
  unlistenRemoteCommand = await getAdapter().remote?.onCommand((command: RemoteCommand) => {
    if (command.action === 'next') next()
    else if (command.action === 'previous') previous()
    else if (command.action === 'goto' && command.index !== undefined) goLive(command.index)
    else if (command.action === 'toggle-presenting') togglePresenting()
  })

  // Scripture resolution isn't wired to a real command on the native Tauri backend yet
  // (README's adapter-status note) — best-effort and last, so a rejected invoke() here can
  // never take down the wiring above it and silently break Save for every service.
  try {
    scriptureTranslations.value = await getAdapter().scripture.listTranslations()
    const defaultCode = settingsStore.librarySettings?.defaultTranslationCode
    const defaultAvailable = scriptureTranslations.value.some((t) => t.code === defaultCode)
    if (defaultAvailable && defaultCode) scriptureTranslationCode.value = defaultCode
    else if (scriptureTranslations.value.length > 0) scriptureTranslationCode.value = scriptureTranslations.value[0].code
    await Promise.all((service.value?.items ?? []).map(resolveScriptureItem))
  } catch (e) {
    console.error('Failed to load scripture translations/passages:', e)
  }

  const mediaIds = (service.value?.items ?? []).filter((item) => item.type === 'media' || item.type === 'video').map((item) => item.mediaId)
  await Promise.all(mediaIds.map(resolveMediaItem))
})
onUnmounted(() => {
  clearInterval(nowTickInterval)
  window.removeEventListener('keydown', onKeydown)
  // Safety net: the router guard (router/index.ts) is what normally prevents leaving while
  // presenting, but if this view ever unmounts some other way, don't leave the app
  // permanently believing a torn-down workspace is still live — or a presentation window
  // open with nothing left able to close it.
  if (isPresenting.value) getAdapter().live.stopPresenting()
  if (externalAppActiveKey.value) getAdapter().externalApps?.restoreSelf()
  isPresenting.value = false
  stopServiceWatch?.()
  unlistenRemoteCommand?.()
  isDirty.value = false
  saveHandler.value = undefined
  undoStore.bottomOffsetPx = 0
})

async function saveService() {
  if (!service.value || saving.value) return
  saving.value = true
  try {
    await servicesStore.save(service.value)
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

const songsById = computed(() => new Map(songsStore.songs.map((song) => [song.id, song])))
const slidesById = computed(() => new Map(slidesStore.slides.map((item) => [item.id, item])))
const mediaById = computed(() => new Map(mediaStore.items.map((item) => [item.id, item])))
const externalAppProfilesById = computed(() => new Map(externalAppsStore.profiles.map((profile) => [profile.id, profile])))
const scriptureFontRange = computed(() => ({
  minPx: settingsStore.librarySettings?.scriptureMinFontSizePx ?? 28,
  maxPx: settingsStore.librarySettings?.scriptureMaxFontSizePx ?? 72,
}))
const songFontRange = computed(() => ({
  minPx: settingsStore.librarySettings?.songMinFontSizePx ?? 16,
  maxPx: settingsStore.librarySettings?.songMaxFontSizePx ?? 72,
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
      )
    : [],
)

const selectedItem = computed<ServiceItem | undefined>(() => service.value?.items[selectedItemIndex.value])
const selectedSong = computed<Song | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'song' ? songsById.value.get(item.songId) : undefined
})
// Covers both slide-ref (resolved via the library) and text-slide (service-owned data) —
// both are just a named sequence of slides, played in order, no per-service arrangement
// override (unlike songs) since spec section 1 has the whole group inserted as-is.
const selectedSlideGroup = computed<SongBlock[] | undefined>(() => {
  const item = selectedItem.value
  if (!item) return undefined
  if (item.type === 'text-slide') return item.slides
  if (item.type === 'slide-ref') return slidesById.value.get(item.slideId)?.slides
  return undefined
})
function slideFlatIndex(itemId: string, subIndex: number): number {
  return flatSlides.value.findIndex((s) => s.key === `${itemId}:${subIndex}`)
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
const selectedScripturePassage = computed<ScripturePassage | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'scripture' ? scriptureById.get(item.id) : undefined
})
const selectedScriptureText = computed(() =>
  selectedScripturePassage.value ? selectedScripturePassage.value.verses.map((v) => `${v.number} ${v.text}`).join(' ') : '',
)
const selectedScriptureError = computed<string | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'scripture' ? scriptureErrors.get(item.id) : undefined
})

function itemIcon(item: ServiceItem): string {
  switch (item.type) {
    case 'song':
      return 'mdi-music-note'
    case 'scripture':
      return 'mdi-book-open-page-variant'
    case 'text-slide':
    case 'slide-ref':
      return 'mdi-file-document-outline'
    case 'media':
      return 'mdi-image'
    case 'video':
      return 'mdi-movie-open'
    case 'audio':
      return 'mdi-volume-high'
    case 'external-app':
      return 'mdi-application'
    case 'countdown':
      return 'mdi-timer-outline'
    case 'qr':
      return 'mdi-qrcode'
    default:
      return 'mdi-file'
  }
}

function itemLabel(item: ServiceItem): string {
  if (item.type === 'song') return songsById.value.get(item.songId)?.title ?? 'Unknown Song'
  if (item.type === 'scripture') return item.reference
  if (item.type === 'text-slide') return 'Text Slide'
  if (item.type === 'slide-ref') return slidesById.value.get(item.slideId)?.label ?? 'Unknown Slide'
  if (item.type === 'media') return mediaById.value.get(item.mediaId)?.filename ?? 'Unknown Media'
  if (item.type === 'video') return mediaById.value.get(item.mediaId)?.filename ?? 'Unknown Video'
  if (item.type === 'external-app') return externalAppProfilesById.value.get(item.profileId)?.name ?? 'Unknown App'
  if (item.type === 'countdown') return item.text || 'Countdown'
  return item.type
}

function itemColor(item: ServiceItem): string {
  return colorForItemType(item.type)
}

async function removeServiceItem(index: number) {
  if (!service.value) return
  const target = service.value.items[index]
  if (!target) return
  const label = itemLabel(target)
  if (!(await confirmDialog.confirm(`Remove "${label}" from the service?`, 'Remove'))) return
  const [removed] = service.value.items.splice(index, 1)
  if (!removed) return
  if (selectedItemIndex.value >= service.value.items.length) {
    selectedItemIndex.value = Math.max(0, service.value.items.length - 1)
  }
  undoStore.push(`Removed "${label}" from the service`, () => service.value?.items.splice(index, 0, removed))
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
// arrangement (spec section 3), never the library song's defaultArrangement.
async function removeFromArrangement(index: number) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  const blockId = item.arrangement.sequence[index]
  const label = blockLabelFor(blockId)
  if (!(await confirmDialog.confirm(`Remove "${label}" from the arrangement?`, 'Remove'))) return
  item.arrangement.sequence.splice(index, 1)
  undoStore.push(`Removed "${label}" from arrangement`, () => item.arrangement.sequence.splice(index, 0, blockId))
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

// Live transport — flattened Next/Prev across the whole service (spec section 3).
function describeSlide(index: number): string {
  const slide = flatSlides.value[index]
  if (slide) return `${slide.itemLabel} — ${slide.subLabel}`
  return flatSlides.value.length === 0 ? 'Service is empty' : 'End of service'
}
const nextIndex = computed(() => (flatIndex.value === -1 ? 0 : Math.min(flatIndex.value + 1, flatSlides.value.length)))
const prevIndex = computed(() => Math.max(flatIndex.value - 1, 0))
const nextPreviewLabel = computed(() => describeSlide(nextIndex.value))
const prevPreviewLabel = computed(() => describeSlide(prevIndex.value))

function goLive(index: number) {
  flatIndex.value = index
}

// Basic Remote Controls (spec section 12) — while an External App Hand-off item is live and
// its profile has this configured, Next/Prev forward a keystroke to the app's own window
// instead of advancing the service's slide sequence.
async function tryForwardKeystroke(direction: 'next' | 'previous'): Promise<boolean> {
  if (!isPresenting.value) return false
  const externalApp = liveSlide.value?.externalApp
  if (!externalApp) return false
  const profile = externalAppProfilesById.value.get(externalApp.profileId)
  const key = direction === 'next' ? profile?.nextKey : profile?.prevKey
  if (!profile?.remoteControlsEnabled || !key) return false
  try {
    await getAdapter().externalApps?.sendKeystroke(profile.id, direction)
  } catch (e) {
    console.error(`Failed to forward ${direction} to the external app:`, e)
  }
  return true
}
async function next() {
  if (await tryForwardKeystroke('next')) return
  flatIndex.value = nextIndex.value
}
async function previous() {
  if (await tryForwardKeystroke('previous')) return
  flatIndex.value = prevIndex.value
}
function togglePresenting() {
  isPresenting.value = !isPresenting.value
  if (isPresenting.value) {
    if (flatIndex.value === -1 && flatSlides.value.length > 0) flatIndex.value = 0
    getAdapter().live.startPresenting()
    // Explicit send in addition to the watch below — if flatIndex was already at this value
    // (e.g. the operator had already clicked this slide before pressing Start Presenting),
    // the watch alone wouldn't fire since liveContentPayload wouldn't actually change.
    getAdapter().live.setLiveContent(liveContentPayload.value)
  } else {
    getAdapter().live.stopPresenting()
  }
  getAdapter().remote?.pushLiveState(isPresenting.value ? liveContentPayload.value : undefined, isPresenting.value)
}

const liveSlide = computed(() =>
  flatIndex.value >= 0 && flatIndex.value < flatSlides.value.length ? flatSlides.value[flatIndex.value] : undefined,
)
// Shared by the live payload (sent to the presentation window/remote) and the Previous/Next
// preview thumbnails below — same slide data, same settings, just a different destination.
function buildLiveContent(slide: FlatSlide | undefined): LiveSlideContent | undefined {
  if (!slide) return undefined
  const mediaUrl = slide.mediaId ? mediaUrlById.get(slide.mediaId) : undefined
  return {
    itemLabel: slide.itemLabel,
    subLabel: slide.subLabel,
    text: slide.text,
    wayfindingBooks: slide.wayfindingBooks,
    media:
      mediaUrl && slide.mediaId && slide.mediaKind && slide.mediaFit
        ? { url: mediaUrl, mediaId: slide.mediaId, kind: slide.mediaKind, fit: slide.mediaFit }
        : undefined,
    countdown: slide.countdown,
    fontRange: slide.fontRange,
    lineWrap: slide.lineWrap,
    headerFontSizePx: settingsStore.librarySettings?.slideHeaderFontSizePx,
    footerFontSizePx: settingsStore.librarySettings?.slideFooterFontSizePx,
  }
}
const liveContentPayload = computed<LiveSlideContent | undefined>(() => buildLiveContent(liveSlide.value))

// Previous/current/next preview thumbnails (right-hand column) — relative to the live
// position, i.e. exactly what Previous/Next in the footer would move to/from, not whatever's
// merely selected in the left panel.
const previousPreview = computed(() => buildLiveContent(flatSlides.value[flatIndex.value - 1]))
const nextPreview = computed(() => buildLiveContent(flatSlides.value[flatIndex.value + 1]))
const previewSlots = computed(() => [
  { label: 'Previous', content: previousPreview.value, live: false },
  { label: 'Current', content: liveContentPayload.value, live: true },
  { label: 'Next', content: nextPreview.value, live: false },
])

// The preview thumbnails render SlideContentRenderer at a fixed "virtual" size and visually
// shrink the whole thing down via CSS transform, so the exact same auto-fit math that runs on
// the real presentation window decides font sizes/wrapping here too — an absolute px font
// range (e.g. scripture's 28-72px) would mean almost nothing if computed directly against a
// box this small. That only actually matches the real thing if the virtual size is the *real*
// presentation window's own logical size, not a guess — a 1920x1080 assumption looks fine for
// a real second monitor but is nowhere close to correct when there's only one monitor (the
// presentation window is just half its work area, a much less widescreen shape — see
// adapters/tauri's computePresentationBounds), which visibly picked a different size/wrap
// point than the real thing (a real, reported mismatch). getPresentationSize mirrors whatever
// startPresenting would actually do right now; falls back to 1920x1080 in the mock/browser
// adapter, which has no real monitors to measure.
const DEFAULT_PREVIEW_VIRTUAL_SIZE = { width: 1920, height: 1080 }
const presentationSize = ref(DEFAULT_PREVIEW_VIRTUAL_SIZE)
async function loadPresentationSize() {
  try {
    presentationSize.value = (await getAdapter().live.getPresentationSize?.()) ?? DEFAULT_PREVIEW_VIRTUAL_SIZE
  } catch (e) {
    console.error('Failed to measure the presentation window size:', e)
    presentationSize.value = DEFAULT_PREVIEW_VIRTUAL_SIZE
  }
}
const PREVIEW_VIRTUAL_SIZE = computed(() => presentationSize.value)
const PREVIEW_THUMB_WIDTH = 360
const previewScale = computed(() => PREVIEW_THUMB_WIDTH / PREVIEW_VIRTUAL_SIZE.value.width)
const previewThumbHeight = computed(() => Math.round(PREVIEW_VIRTUAL_SIZE.value.height * previewScale.value))
watch(liveContentPayload, (content) => {
  if (isPresenting.value) {
    // While an External App Hand-off item is live, Worship Studio's own presentation window
    // deliberately shows nothing new — the external app's window is what's actually on the
    // audience display now (see engageExternalAppIfNeeded below), covering ours by virtue of
    // being brought to the foreground, positioned over that same monitor.
    if (!liveSlide.value?.externalApp) getAdapter().live.setLiveContent(content)
    getAdapter().remote?.pushLiveState(content, true)
  }
})

// External App Hand-off (spec section 12): "on advance" launches/focuses the configured app;
// "on advancing past it" restores Worship Studio to the foreground. Tracked by FlatSlide key
// (not just profileId) so re-visiting the *same* slide (e.g. navigating back to it) re-engages
// rather than being treated as a no-op from a stale previous engagement.
const externalAppActiveKey = ref<string>()
const externalAppError = ref<string>()

async function engageExternalAppIfNeeded() {
  const slide = liveSlide.value
  if (!isPresenting.value || !slide?.externalApp) {
    if (externalAppActiveKey.value) {
      externalAppActiveKey.value = undefined
      externalAppError.value = undefined
      try {
        await getAdapter().externalApps?.restoreSelf()
      } catch (e) {
        console.error('Failed to restore Worship Studio to the foreground:', e)
      }
    }
    return
  }
  if (externalAppActiveKey.value === slide.key) return
  externalAppActiveKey.value = slide.key
  externalAppError.value = undefined
  try {
    await getAdapter().externalApps?.launch(slide.externalApp.profileId, slide.externalApp.file)
  } catch (e) {
    externalAppError.value = errorMessage(e, 'Failed to launch the external app.')
  }
}
watch([liveSlide, isPresenting], engageExternalAppIfNeeded)

async function retryExternalApp() {
  externalAppActiveKey.value = undefined
  await engageExternalAppIfNeeded()
}
function skipExternalAppError() {
  // Deliberately doesn't force navigation — the operator moves on with Next/Prev whenever
  // ready, same "clear failure, operator decides" pattern as section 13's video errors. The
  // audience display stays on whatever was live before (untouched, since setLiveContent above
  // is skipped for external-app slides either way).
  externalAppError.value = undefined
}
const liveStatusText = computed(() => {
  if (!isPresenting.value) return 'Not Presenting'
  if (!liveSlide.value) return 'LIVE: Blank'
  return `LIVE: ${liveSlide.value.itemLabel} — ${liveSlide.value.subLabel}`
})
const liveContextSnippet = computed(() => {
  const firstLine = liveSlide.value?.text.split('\n')[0]
  return firstLine ? `"${firstLine}"` : ''
})

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
  if (!service.value) return
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      selectedItemIndex.value = Math.max(0, selectedItemIndex.value - 1)
      break
    case 'ArrowDown':
      event.preventDefault()
      selectedItemIndex.value = Math.min(service.value.items.length - 1, selectedItemIndex.value + 1)
      break
    case 'ArrowLeft':
      event.preventDefault()
      previous()
      break
    case 'ArrowRight':
      event.preventDefault()
      next()
      break
  }
}

// "+ Add to Service" — tabbed picker (spec section 2): Songs (search), Scripture (a
// reference builder rather than a browsable list, since scripture isn't a library), Slides
// (pick from the library, or quick-create service-only text slides), Media/Video (pick
// from the Media Library, filtered by kind), and External App (pick a configured profile from
// Settings). No Audio tab yet — the Media Library's MediaItem only models 'image' | 'video'
// today, so there's no real data an Audio tab could list; that's a Media Library extension,
// not just an Add-to-Service tab. The full unified fuzzy search across every type is still a
// later slice.
const addTab = ref<'songs' | 'scripture' | 'slides' | 'media' | 'video' | 'external-app' | 'countdown'>('songs')

const filteredSongsForAdd = computed(() => {
  const q = addQuery.value.trim().toLowerCase()
  return songsStore.songs.filter((song) => !q || song.title.toLowerCase().includes(q))
})
const addingSong = ref(false)
async function addSongToService(song: Song) {
  if (!service.value || addingSong.value) return
  addingSong.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'song',
      songId: song.id,
      arrangement: { sequence: [...song.defaultArrangement.sequence] },
    }
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
  } finally {
    addingSong.value = false
  }
}

// Scripture sub-picker (spec section 2): "Type a reference" free text, or "Choose fields"
// cascading dropdowns bounded by the reference table so an invalid reference can't be
// selected. Both feed the same activeReference/preview pipeline below.
const scriptureEntryMode = ref<'type' | 'fields'>('type')
const scriptureRefText = ref('')
const scriptureBook = ref<string>()
const scriptureStartChapter = ref<number>()
const scriptureStartVerse = ref<number>()
const scriptureEndChapter = ref<number>()
const scriptureEndVerse = ref<number>()
const scriptureDisplayMode = ref<'full' | 'reference-only'>('full')
const scriptureTranslationCode = ref<string>()
const scriptureTranslations = ref<ScriptureTranslation[]>([])
const scripturePreview = ref<ScripturePassage>()
const scripturePreviewText = computed(() =>
  scripturePreview.value ? scripturePreview.value.verses.map((v) => `${v.number} ${v.text}`).join(' ') : '',
)
const scripturePreviewError = ref<string>()
const scripturePreviewLoading = ref(false)
const addingScripture = ref(false)

const bookNames = getBookNames()

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i)
}
const startChapterOptions = computed(() => (scriptureBook.value ? range(1, getChapterCount(scriptureBook.value)) : []))
const startVerseOptions = computed(() =>
  scriptureBook.value && scriptureStartChapter.value ? range(1, getVerseCount(scriptureBook.value, scriptureStartChapter.value)) : [],
)
const endChapterOptions = computed(() =>
  scriptureBook.value && scriptureStartChapter.value ? range(scriptureStartChapter.value, getChapterCount(scriptureBook.value)) : [],
)
const endVerseOptions = computed(() => {
  if (!scriptureBook.value || !scriptureEndChapter.value) return []
  const minVerse = scriptureEndChapter.value === scriptureStartChapter.value ? (scriptureStartVerse.value ?? 1) : 1
  return range(minVerse, getVerseCount(scriptureBook.value, scriptureEndChapter.value))
})

// Picking a new book/start point resets anything downstream that could now be invalid, and
// defaults the end of the range to match the start (a single verse) so "Choose fields"
// always represents a complete, addable reference as soon as a start verse is picked.
watch(scriptureBook, () => {
  scriptureStartChapter.value = undefined
  scriptureStartVerse.value = undefined
  scriptureEndChapter.value = undefined
  scriptureEndVerse.value = undefined
})
watch(scriptureStartChapter, (chapter) => {
  scriptureStartVerse.value = undefined
  scriptureEndChapter.value = chapter
  scriptureEndVerse.value = undefined
})
watch(scriptureStartVerse, (verse) => {
  scriptureEndVerse.value = verse
})
watch(scriptureEndChapter, () => {
  scriptureEndVerse.value = undefined
})

const activeReference = computed<ScriptureReference | undefined>(() => {
  if (scriptureEntryMode.value === 'type') return parseReference(scriptureRefText.value)
  if (!scriptureBook.value || !scriptureStartChapter.value || !scriptureStartVerse.value) return undefined
  return {
    book: scriptureBook.value,
    startChapter: scriptureStartChapter.value,
    startVerse: scriptureStartVerse.value,
    endChapter: scriptureEndChapter.value ?? scriptureStartChapter.value,
    endVerse: scriptureEndVerse.value ?? scriptureStartVerse.value,
  }
})
const activeReferenceValid = computed(() => !!activeReference.value && isValidReference(activeReference.value))
const activeReferenceText = computed(() => (activeReference.value ? formatReference(activeReference.value) : ''))

// Live preview, re-fetched whenever the resolved reference/translation changes. A request
// token guards against an in-flight fetch for a since-superseded reference overwriting a
// newer one's result.
let scripturePreviewToken = 0
watch([activeReferenceText, scriptureTranslationCode, scriptureDisplayMode], async () => {
  scripturePreview.value = undefined
  scripturePreviewError.value = undefined
  if (scriptureDisplayMode.value === 'reference-only' || !activeReferenceValid.value || !scriptureTranslationCode.value) return
  const token = ++scripturePreviewToken
  scripturePreviewLoading.value = true
  try {
    const passage = await getAdapter().scripture.resolve(activeReferenceText.value, scriptureTranslationCode.value)
    if (token === scripturePreviewToken) scripturePreview.value = passage
  } catch (e) {
    if (token === scripturePreviewToken) scripturePreviewError.value = errorMessage(e, 'Failed to load passage.')
  } finally {
    if (token === scripturePreviewToken) scripturePreviewLoading.value = false
  }
})

async function addScriptureToService() {
  if (!service.value || !activeReferenceValid.value || addingScripture.value) return
  if (scriptureDisplayMode.value === 'full' && (!scriptureTranslationCode.value || scripturePreviewError.value)) return
  addingScripture.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'scripture',
      reference: activeReferenceText.value,
      translation: scriptureTranslationCode.value ?? '',
      displayMode: scriptureDisplayMode.value,
    }
    service.value.items.push(item)
    if (scripturePreview.value && scriptureDisplayMode.value === 'full') scriptureById.set(item.id, scripturePreview.value)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
  } finally {
    addingScripture.value = false
  }
}

// Slides sub-picker (spec section 1/2): pick an existing library item (whole group
// inserted in order), or quick-create service-only text slides — same card-based
// label/text editing as the Slide Library editor, but the result belongs to this service
// only, never saved as a shared library entry (mirrors a song's per-service arrangement
// being separate from the library default).
const slidesSubMode = ref<'pick' | 'new'>('pick')
const slideQuery = ref('')
const addingSlideRef = ref(false)
const newTextSlideBlocks = ref<SongBlock[]>([])

const filteredSlidesForAdd = computed(() => {
  const q = slideQuery.value.trim().toLowerCase()
  return slidesStore.slides.filter((item) => !q || item.label.toLowerCase().includes(q))
})

async function addSlideRefToService(slideItem: SlideLibraryItem) {
  if (!service.value || addingSlideRef.value) return
  addingSlideRef.value = true
  try {
    const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'slide-ref', slideId: slideItem.id }
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
  } finally {
    addingSlideRef.value = false
  }
}

function addNewTextSlideBlock() {
  newTextSlideBlocks.value.push({ id: `slide-part-${crypto.randomUUID()}`, label: `Slide ${newTextSlideBlocks.value.length + 1}`, text: '' })
}
async function removeNewTextSlideBlock(index: number) {
  const target = newTextSlideBlocks.value[index]
  if (!target) return
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  newTextSlideBlocks.value.splice(index, 1)
}
function addTextSlideToService() {
  if (!service.value || newTextSlideBlocks.value.length === 0) return
  const item: ServiceItem = {
    id: `item-${crypto.randomUUID()}`,
    type: 'text-slide',
    slides: newTextSlideBlocks.value.map((block) => ({ ...block })),
  }
  service.value.items.push(item)
  selectedItemIndex.value = service.value.items.length - 1
  closeAddDialog()
}

// Media/Video sub-pickers (spec section 3): pick an existing Media Library item, filtered by
// kind — 'image' backs the `media` item type (with a Cover/Contain fit choice, defaulting to
// Cover per the live-presentation aspect-ratio spec), 'video' backs the `video` item type.
const mediaQuery = ref('')
const videoQuery = ref('')
const mediaFit = ref<'cover' | 'contain'>('cover')
const addingMedia = ref(false)

const filteredMediaForAdd = computed(() => {
  const q = mediaQuery.value.trim().toLowerCase()
  return mediaStore.items.filter((item) => item.kind === 'image' && (!q || item.filename.toLowerCase().includes(q)))
})
const filteredVideoForAdd = computed(() => {
  const q = videoQuery.value.trim().toLowerCase()
  return mediaStore.items.filter((item) => item.kind === 'video' && (!q || item.filename.toLowerCase().includes(q)))
})

async function addMediaToService(mediaItem: MediaItem) {
  if (!service.value || addingMedia.value) return
  addingMedia.value = true
  try {
    const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'media', mediaId: mediaItem.id, fit: mediaFit.value }
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
    await resolveMediaItem(mediaItem.id)
  } finally {
    addingMedia.value = false
  }
}
async function addVideoToService(mediaItem: MediaItem) {
  if (!service.value || addingMedia.value) return
  addingMedia.value = true
  try {
    const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'video', mediaId: mediaItem.id }
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
    await resolveMediaItem(mediaItem.id)
  } finally {
    addingMedia.value = false
  }
}

// External App Hand-off sub-picker (spec section 12): pick a configured profile and, if its
// Parameter Format needs one, the file to hand it. Add-time verification (exe/file exist) —
// "robustness priority over convenience" — runs before the item is actually added, so a
// broken path is caught during prep rather than discovered mid-service.
const externalAppProfileId = ref<string>()
const externalAppFile = ref<string>()
const addingExternalApp = ref(false)
const externalAppAddError = ref<string>()
const selectedExternalAppProfile = computed(() => externalAppProfilesById.value.get(externalAppProfileId.value ?? ''))
const externalAppNeedsFile = computed(() => selectedExternalAppProfile.value?.parameterFormat?.includes('{file}') ?? false)

async function pickExternalAppFile() {
  const path = await getAdapter().externalApps?.pickFile()
  if (path) externalAppFile.value = path
}
async function addExternalAppToService() {
  if (!service.value || addingExternalApp.value || !externalAppProfileId.value) return
  addingExternalApp.value = true
  externalAppAddError.value = undefined
  try {
    await getAdapter().externalApps?.verifyItem(externalAppProfileId.value, externalAppFile.value)
    const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'external-app', profileId: externalAppProfileId.value, file: externalAppFile.value }
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
    closeAddDialog()
  } catch (e) {
    externalAppAddError.value = errorMessage(e, 'Failed to verify this app.')
  } finally {
    addingExternalApp.value = false
  }
}

// Countdown sub-picker (spec section 1): custom text plus a target time, entered per-use (not
// baked into a reusable library item — service times vary week to week). Service-specific
// only, same as the Slides tab's "+ New Text Slides" quick-create — no Slide Library reuse.
const countdownTargetTime = ref('')
const countdownText = ref('')

function addCountdownToService() {
  if (!service.value || !countdownTargetTime.value) return
  // <input type="datetime-local"> has no timezone of its own — treated as this computer's
  // local time, same as every other date the app already collects this way.
  const targetTime = new Date(countdownTargetTime.value).toISOString()
  const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'countdown', targetTime, text: countdownText.value.trim() || undefined }
  service.value.items.push(item)
  selectedItemIndex.value = service.value.items.length - 1
  closeAddDialog()
}

function closeAddDialog() {
  addDialogOpen.value = false
  addQuery.value = ''
  scriptureRefText.value = ''
  scriptureBook.value = undefined
  scriptureStartChapter.value = undefined
  scriptureStartVerse.value = undefined
  scriptureEndChapter.value = undefined
  scriptureEndVerse.value = undefined
  scripturePreview.value = undefined
  scripturePreviewError.value = undefined
  slideQuery.value = ''
  slidesSubMode.value = 'pick'
  newTextSlideBlocks.value = []
  mediaQuery.value = ''
  videoQuery.value = ''
  mediaFit.value = 'cover'
  externalAppProfileId.value = undefined
  externalAppFile.value = undefined
  externalAppAddError.value = undefined
  countdownTargetTime.value = ''
  countdownText.value = ''
}

function updatePresenterNote(itemId: string, note: string) {
  if (!service.value) return
  if (!service.value.presenterNotes) service.value.presenterNotes = {}
  service.value.presenterNotes[itemId] = note
}
</script>

<template>
  <div v-if="service" class="workspace-root">
    <div class="d-flex align-center justify-space-between px-4 py-2 border-b">
      <div class="d-flex align-center ga-1">
        <div class="d-flex flex-column" style="line-height: 1.3">
          <span class="text-body-2 font-weight-bold">{{ serviceDateLabel }} · {{ service.type }}</span>
          <span v-if="serviceSubtitle" class="text-caption text-medium-emphasis">{{ serviceSubtitle }}</span>
        </div>
        <v-btn icon="mdi-pencil-outline" variant="text" size="small" title="Edit service details" @click="openServiceDetailsDialog" />
      </div>
      <div class="d-flex ga-2">
        <v-btn variant="outlined" prepend-icon="mdi-account-group-outline" :to="`/service/${service.id}/roster`">
          Volunteer Roster
        </v-btn>
        <v-btn variant="outlined" prepend-icon="mdi-file-document-outline" :to="`/service/${service.id}/order-of-worship`">
          Order of Worship
        </v-btn>
        <v-btn :color="isPresenting ? 'error' : 'primary'" variant="flat" @click="togglePresenting">
          <v-icon :icon="isPresenting ? 'mdi-stop' : 'mdi-play'" start />
          {{ isPresenting ? 'Stop Presenting' : 'Start Presenting' }}
        </v-btn>
      </div>
    </div>

    <div class="workspace-layout">
      <div class="service-panel">
        <div class="text-overline text-medium-emphasis px-3 py-2 border-b">Service Order</div>
        <div class="flex-grow-1 overflow-y-auto pa-2">
          <div
            v-for="(item, index) in service.items"
            :key="item.id"
            class="service-item"
            :class="{ 'service-item--selected': index === selectedItemIndex, 'service-item--live': itemHasLive(index) }"
            @click="selectedItemIndex = index"
          >
            <v-icon :icon="itemIcon(item)" :color="itemColor(item)" size="small" />
            <span class="text-truncate flex-grow-1">{{ itemLabel(item) }}</span>
            <v-btn
              icon="mdi-trash-can-outline"
              variant="flat"
              color="error"
              class="row-remove"
              size="x-small"
              @click.stop="removeServiceItem(index)"
            />
          </div>
        </div>
        <v-btn variant="flat" color="primary" class="ma-2" prepend-icon="mdi-plus" @click="addDialogOpen = true">
          Add to Service
        </v-btn>
      </div>

      <div class="center-panel">
        <template v-if="selectedItem">
          <div class="mb-3">
            <h2 class="text-h6">{{ itemLabel(selectedItem) }}</h2>
            <p class="text-caption text-medium-emphasis">
              Click a slide to make it live · Next/Prev moves through the whole service
            </p>
          </div>

          <template v-if="selectedItem.type === 'song' && selectedSong">
            <VueDraggable
              v-model="selectedItem.arrangement.sequence"
              handle=".drag-handle"
              :animation="150"
              class="d-flex flex-column ga-1"
              style="max-width: 460px"
            >
              <div
                v-for="(blockId, index) in selectedItem.arrangement.sequence"
                :key="index"
                class="slide-row"
                :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) && flatIndex === index }"
                :style="slideRowStyle(blockId, itemHasLive(selectedItemIndex) && flatIndex === index)"
                @click="goLive(index)"
              >
                <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="text-body-2 font-weight-bold">
                    {{ selectedSong.blocks.find((b) => b.id === blockId)?.label ?? blockId }}
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
              <v-btn variant="flat" color="secondary" size="small" @click="resetArrangementToDefault">
                Reset to song default
              </v-btn>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'scripture'">
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="[
                { maxWidth: '460px', whiteSpace: 'pre-line' },
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
              <div v-if="selectedItem.displayMode === 'reference-only'" class="text-body-2 text-medium-emphasis">
                Reference only — no verse text shown.
              </div>
              <div v-else-if="selectedScriptureError" class="text-body-2 text-error">{{ selectedScriptureError }}</div>
              <template v-else-if="selectedScripturePassage">
                <div class="text-body-2">{{ selectedScriptureText }}</div>
                <div class="text-caption text-medium-emphasis mt-2">
                  {{ selectedScripturePassage.copyright ?? selectedScripturePassage.translation }}
                </div>
              </template>
              <div v-else class="text-body-2 text-medium-emphasis">Loading…</div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'slide-ref' || selectedItem.type === 'text-slide'">
            <p v-if="!selectedSlideGroup || selectedSlideGroup.length === 0" class="text-medium-emphasis">
              {{ selectedItem.type === 'slide-ref' ? 'Slide not found in the library.' : 'No slides yet.' }}
            </p>
            <div v-else class="d-flex flex-column ga-1" style="max-width: 460px">
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
                  <div class="text-body-2 font-weight-bold">{{ slide.label }}</div>
                  <div class="text-body-2" style="white-space: pre-line; opacity: 0.75">{{ slide.text }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'media' || selectedItem.type === 'video'">
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
              <div v-if="selectedMediaError" class="text-body-2 text-error">{{ selectedMediaError }}</div>
              <img v-else-if="selectedMediaUrl && selectedItem.type === 'media'" :src="selectedMediaUrl" class="media-preview" alt="" />
              <video v-else-if="selectedMediaUrl" :src="selectedMediaUrl" class="media-preview" muted controls />
              <div v-else class="text-body-2 text-medium-emphasis">Loading…</div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'countdown'">
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
              <div v-if="selectedItem.text" class="text-body-2 mb-1">{{ selectedItem.text }}</div>
              <div class="text-h5 font-weight-bold">{{ formatCountdown(selectedItem.targetTime, nowTick) }}</div>
            </div>
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

          <div class="mt-6" style="max-width: 460px">
            <div class="text-overline text-medium-emphasis mb-2">Presenter Notes</div>
            <v-textarea
              :model-value="service.presenterNotes?.[selectedItem.id]"
              variant="outlined"
              density="compact"
              rows="2"
              placeholder="Notes visible only on operator screen…"
              @update:model-value="(value: string) => updatePresenterNote(selectedItem!.id, value)"
            />
          </div>
        </template>
        <p v-else class="text-medium-emphasis">This service has no items yet.</p>
      </div>

      <div class="preview-panel">
        <div class="text-overline text-medium-emphasis px-3 py-2 border-b">Preview</div>
        <div class="preview-list">
          <div v-for="preview in previewSlots" :key="preview.label" class="preview-item">
            <div class="text-caption text-medium-emphasis mb-1">{{ preview.label }}</div>
            <div
              class="preview-thumb"
              :class="{ 'preview-thumb--live': preview.live }"
              :style="{ width: `${PREVIEW_THUMB_WIDTH}px`, height: `${previewThumbHeight}px` }"
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
    </div>

    <!-- External App Hand-off failure — operator-only, never shown to the congregation (spec
         section 12); the audience display stays on whatever was live before. -->
    <v-alert v-if="externalAppError" type="warning" variant="elevated" density="compact" class="external-app-alert">
      <div class="d-flex align-center ga-3">
        <span>⚠️ {{ externalAppError }}</span>
        <v-spacer />
        <v-btn variant="flat" size="small" color="white" @click="retryExternalApp">Try Again</v-btn>
        <v-btn variant="text" size="small" @click="skipExternalAppError">Skip</v-btn>
      </div>
    </v-alert>

    <div class="live-footer">
      <div class="d-flex align-center ga-3">
        <v-btn variant="flat" color="error" prepend-icon="mdi-chevron-left" @click="previous">Previous</v-btn>
        <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 140px">{{ prevPreviewLabel }}</span>
      </div>

      <div class="live-status" :class="{ 'text-error': isPresenting }">
        <span v-if="isPresenting" class="live-blink" />
        <span class="font-weight-bold">{{ liveStatusText }}</span>
        <span class="text-medium-emphasis text-truncate">{{ liveContextSnippet }}</span>
      </div>

      <div class="d-flex align-center ga-3">
        <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 140px">{{ nextPreviewLabel }}</span>
        <v-btn variant="flat" color="error" append-icon="mdi-chevron-right" @click="next">Next</v-btn>
      </div>
    </div>

    <v-dialog v-model="serviceDetailsDialogOpen" max-width="560">
      <v-card>
        <v-card-title>Edit Service Details</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="6">
              <v-text-field v-model="editDate" type="date" label="Date" variant="outlined" />
            </v-col>
            <v-col cols="6">
              <v-select v-model="editType" :items="settingsStore.librarySettings?.serviceTypes ?? []" label="Type" variant="outlined" />
            </v-col>
          </v-row>
          <v-text-field
            v-model="editSermonTitle"
            label="Sermon Title (optional)"
            placeholder="e.g. Our Lord's Prayer"
            variant="outlined"
          />
          <v-row>
            <v-col cols="6">
              <v-text-field
                v-model="editKeyPassage"
                label="Key Passage (optional)"
                placeholder="e.g. Matthew 6:9-13"
                variant="outlined"
              />
            </v-col>
            <v-col cols="6">
              <v-combobox
                v-model="editPreacher"
                :items="settingsStore.librarySettings?.preachers ?? []"
                label="Preacher (optional)"
                placeholder="Start typing or pick from list"
                variant="outlined"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="serviceDetailsDialogOpen = false">Cancel</v-btn>
          <v-btn variant="flat" color="primary" @click="saveServiceDetails">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="addDialogOpen" max-width="560">
      <v-card>
        <v-card-title>Add to Service</v-card-title>
        <v-tabs v-model="addTab" density="compact" class="border-b add-service-tabs">
          <v-tab value="songs">Songs</v-tab>
          <v-tab value="scripture">Scripture</v-tab>
          <v-tab value="slides">Slides</v-tab>
          <v-tab value="media">Media</v-tab>
          <v-tab value="video">Video</v-tab>
          <v-tab v-if="getAdapter().externalApps" value="external-app">External App</v-tab>
          <v-tab value="countdown">Countdown</v-tab>
        </v-tabs>
        <v-card-text>
          <v-window v-model="addTab">
            <v-window-item value="songs">
              <v-text-field
                v-model="addQuery"
                label="Search songs…"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-magnify"
                autofocus
              />
              <v-list :disabled="addingSong">
                <v-list-item
                  v-for="song in filteredSongsForAdd"
                  :key="song.id"
                  :title="song.title"
                  :subtitle="song.author"
                  @click="addSongToService(song)"
                />
              </v-list>
            </v-window-item>

            <v-window-item value="scripture">
              <v-btn-toggle v-model="scriptureEntryMode" mandatory density="compact" divided class="mb-4">
                <v-btn value="type" size="small">Type a Reference</v-btn>
                <v-btn value="fields" size="small">Choose Fields</v-btn>
              </v-btn-toggle>

              <v-text-field
                v-if="scriptureEntryMode === 'type'"
                v-model="scriptureRefText"
                label="Reference"
                placeholder="e.g. John 3:16-17"
                variant="outlined"
                density="comfortable"
                autofocus
                :error="!!scriptureRefText && !activeReferenceValid"
                :error-messages="scriptureRefText && !activeReferenceValid ? ['Not a recognized reference'] : []"
              />

              <template v-else>
                <v-select v-model="scriptureBook" :items="bookNames" label="Book" variant="outlined" density="comfortable" />
                <div class="d-flex ga-3">
                  <v-select
                    v-model="scriptureStartChapter"
                    :items="startChapterOptions"
                    label="Start Chapter"
                    variant="outlined"
                    density="comfortable"
                    :disabled="!scriptureBook"
                  />
                  <v-select
                    v-model="scriptureStartVerse"
                    :items="startVerseOptions"
                    label="Start Verse"
                    variant="outlined"
                    density="comfortable"
                    :disabled="!scriptureStartChapter"
                  />
                </div>
                <div class="d-flex ga-3">
                  <v-select
                    v-model="scriptureEndChapter"
                    :items="endChapterOptions"
                    label="End Chapter"
                    variant="outlined"
                    density="comfortable"
                    :disabled="!scriptureStartChapter"
                  />
                  <v-select
                    v-model="scriptureEndVerse"
                    :items="endVerseOptions"
                    label="End Verse"
                    variant="outlined"
                    density="comfortable"
                    :disabled="!scriptureEndChapter"
                  />
                </div>
              </template>

              <v-btn-toggle v-model="scriptureDisplayMode" mandatory density="compact" divided class="my-3">
                <v-btn value="full" size="small">Show Full Text</v-btn>
                <v-btn value="reference-only" size="small">Reference Only</v-btn>
              </v-btn-toggle>

              <v-select
                v-if="scriptureDisplayMode === 'full'"
                v-model="scriptureTranslationCode"
                :items="scriptureTranslations"
                item-title="name"
                item-value="code"
                label="Translation"
                variant="outlined"
                density="comfortable"
              />

              <div v-if="scriptureDisplayMode === 'full'" class="mb-2" style="min-height: 24px">
                <span v-if="scripturePreviewLoading" class="text-medium-emphasis text-body-2">Loading preview…</span>
                <span v-else-if="scripturePreviewError" class="text-error text-body-2">{{ scripturePreviewError }}</span>
                <div v-else-if="scripturePreview">
                  <div class="text-caption text-medium-emphasis mb-1">
                    {{ scripturePreview.reference }} ({{ scripturePreview.translation }})
                  </div>
                  <p class="text-body-2">{{ scripturePreviewText }}</p>
                </div>
              </div>
              <p v-else-if="activeReferenceValid" class="text-body-2 text-medium-emphasis mb-2">
                {{ activeReferenceText }} — reference only, no verse text shown.
              </p>

              <v-btn
                variant="flat"
                color="primary"
                block
                :disabled="!activeReferenceValid || (scriptureDisplayMode === 'full' && (!scriptureTranslationCode || !!scripturePreviewError))"
                :loading="addingScripture"
                @click="addScriptureToService"
              >
                Add Scripture
              </v-btn>
            </v-window-item>

            <v-window-item value="slides">
              <v-btn-toggle v-model="slidesSubMode" mandatory density="compact" divided class="mb-4">
                <v-btn value="pick" size="small">Pick from Library</v-btn>
                <v-btn value="new" size="small">+ New Text Slides</v-btn>
              </v-btn-toggle>

              <template v-if="slidesSubMode === 'pick'">
                <v-text-field
                  v-model="slideQuery"
                  label="Search slides…"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-magnify"
                  autofocus
                />
                <v-list :disabled="addingSlideRef">
                  <v-list-item
                    v-for="slideItem in filteredSlidesForAdd"
                    :key="slideItem.id"
                    :title="slideItem.label"
                    :subtitle="slideItem.slides.length === 1 ? '1 slide' : `${slideItem.slides.length} slides`"
                    @click="addSlideRefToService(slideItem)"
                  />
                </v-list>
                <p v-if="filteredSlidesForAdd.length === 0" class="text-medium-emphasis text-body-2">No slides found.</p>
              </template>

              <template v-else>
                <p class="text-caption text-medium-emphasis mb-3">
                  Saved with this service only — not added to the Slide Library.
                </p>
                <VueDraggable
                  v-model="newTextSlideBlocks"
                  handle=".drag-handle"
                  :animation="150"
                  class="d-flex flex-column ga-2 mb-3"
                >
                  <v-card v-for="(block, index) in newTextSlideBlocks" :key="block.id" variant="outlined" rounded="lg">
                    <div class="d-flex align-center ga-2 px-2 py-1 border-b">
                      <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
                      <v-text-field v-model="block.label" variant="filled" density="compact" hide-details class="flex-grow-1" />
                      <v-btn
                        icon="mdi-trash-can-outline"
                        variant="flat"
                        color="error"
                        size="small"
                        @click="removeNewTextSlideBlock(index)"
                      />
                    </div>
                    <v-textarea v-model="block.text" variant="filled" density="compact" rows="2" auto-grow hide-details class="px-2 py-1" />
                  </v-card>
                </VueDraggable>
                <v-btn variant="flat" color="primary" class="mb-3" prepend-icon="mdi-plus" @click="addNewTextSlideBlock">
                  Add Slide
                </v-btn>
                <v-btn
                  variant="flat"
                  color="primary"
                  block
                  :disabled="newTextSlideBlocks.length === 0"
                  @click="addTextSlideToService"
                >
                  Add to Service
                </v-btn>
              </template>
            </v-window-item>

            <v-window-item value="media">
              <v-btn-toggle v-model="mediaFit" mandatory density="compact" divided class="mb-4">
                <v-btn value="cover" size="small">Cover (crop to fill)</v-btn>
                <v-btn value="contain" size="small">Contain (show in full)</v-btn>
              </v-btn-toggle>
              <v-text-field
                v-model="mediaQuery"
                label="Search media…"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-magnify"
                autofocus
              />
              <v-list :disabled="addingMedia">
                <v-list-item
                  v-for="item in filteredMediaForAdd"
                  :key="item.id"
                  :title="item.filename"
                  prepend-icon="mdi-image-outline"
                  @click="addMediaToService(item)"
                />
              </v-list>
              <p v-if="filteredMediaForAdd.length === 0" class="text-medium-emphasis text-body-2">No images found in the Media Library.</p>
            </v-window-item>

            <v-window-item value="video">
              <v-text-field
                v-model="videoQuery"
                label="Search videos…"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-magnify"
                autofocus
              />
              <v-list :disabled="addingMedia">
                <v-list-item
                  v-for="item in filteredVideoForAdd"
                  :key="item.id"
                  :title="item.filename"
                  prepend-icon="mdi-movie-open-outline"
                  @click="addVideoToService(item)"
                />
              </v-list>
              <p v-if="filteredVideoForAdd.length === 0" class="text-medium-emphasis text-body-2">No videos found in the Media Library.</p>
            </v-window-item>

            <v-window-item value="external-app">
              <p v-if="externalAppsStore.profiles.length === 0" class="text-medium-emphasis text-body-2">
                No profiles configured yet — add one in Settings &gt; External Apps.
              </p>
              <v-select
                v-else
                v-model="externalAppProfileId"
                :items="externalAppsStore.profiles"
                item-title="name"
                item-value="id"
                label="App Profile"
                variant="outlined"
                density="comfortable"
                class="mb-3"
              />
              <template v-if="selectedExternalAppProfile">
                <v-text-field
                  v-if="externalAppNeedsFile"
                  :model-value="externalAppFile"
                  label="File"
                  variant="outlined"
                  density="comfortable"
                  readonly
                  class="mb-2"
                >
                  <template #append>
                    <v-btn variant="outlined" @click="pickExternalAppFile">Browse…</v-btn>
                  </template>
                </v-text-field>
                <v-alert v-if="externalAppAddError" type="error" variant="tonal" density="compact" class="mb-3">
                  {{ externalAppAddError }}
                </v-alert>
                <v-btn
                  variant="flat"
                  color="primary"
                  block
                  :loading="addingExternalApp"
                  :disabled="externalAppNeedsFile && !externalAppFile"
                  @click="addExternalAppToService"
                >
                  Add to Service
                </v-btn>
              </template>
            </v-window-item>

            <v-window-item value="countdown">
              <v-text-field
                v-model="countdownTargetTime"
                type="datetime-local"
                label="Target Time"
                variant="outlined"
                density="comfortable"
                class="mb-3"
              />
              <v-text-field
                v-model="countdownText"
                label="Custom Text (optional)"
                placeholder="e.g. Join us at 10:15!"
                variant="outlined"
                density="comfortable"
                class="mb-3"
              />
              <v-btn variant="flat" color="primary" block :disabled="!countdownTargetTime" @click="addCountdownToService">
                Add to Service
              </v-btn>
            </v-window-item>
          </v-window>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="flat" color="secondary" @click="closeAddDialog">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Service not found.</p>
  </v-container>
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
}
.workspace-layout {
  display: grid;
  grid-template-columns: 260px 1fr 400px;
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.service-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 0;
}
.preview-panel {
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 0;
  overflow-y: auto;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
}
.preview-thumb {
  overflow: hidden;
  border-radius: 4px;
  background: #000;
}
.preview-thumb--live {
  outline: 2px solid rgb(var(--v-theme-error));
  outline-offset: 2px;
}
.service-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  margin-bottom: 2px;
}
.service-item:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.service-item--selected {
  background: rgba(var(--v-theme-primary), 0.12);
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.service-item--live {
  border-left: 3px solid rgb(var(--v-theme-error));
  padding-left: 7px;
}
.center-panel {
  padding: 20px 24px;
  overflow-y: auto;
  min-height: 0;
}
.slide-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.slide-row:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.media-preview {
  max-width: 100%;
  max-height: 220px;
  border-radius: 4px;
}
.slide-row--live {
  background: rgba(var(--v-theme-error), 0.1);
  border-left: 3px solid rgb(var(--v-theme-error));
  padding-left: 9px;
}
.row-remove {
  opacity: 0;
}
.slide-row:hover .row-remove,
.service-item:hover .row-remove {
  opacity: 1;
}
.external-app-alert {
  flex-shrink: 0;
  margin: 0 20px 10px;
}
.live-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.live-status {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
}
.live-blink {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  flex-shrink: 0;
}
/* Add-to-Service dialog: with a large library (100+ songs), the song list is tall enough
   that the whole card wants to grow well past the viewport. Without an explicit
   flex-shrink: 0, flexbox's default shrink-to-fit behavior squeezes EVERY flex child
   (including the title and tabs bar) down toward zero to make room, rather than confining
   the overflow to the list — reproducible in any browser with enough songs seeded, nothing
   Tauri/WebView2-specific about it. Title, tabs, and Cancel stay fixed size and always
   visible; only the content area (song/scripture/slide list) scrolls internally. */
:deep(.v-card-title),
.add-service-tabs,
:deep(.v-card-actions) {
  flex-shrink: 0;
}
:deep(.v-card-text) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
