<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { convertFileSrc } from '@tauri-apps/api/core'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import ScriptureReferencePicker, { type ScriptureReferenceValue } from '@/components/ScriptureReferencePicker.vue'
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
import { usePeopleStore } from '@/stores/people'
import { flattenService, type FlatSlide } from '@/utils/flattenService'
import { colorForBlockLabel, colorForItemType } from '@/utils/contentColors'
import { applySermonEdit, defaultSermonRole, findSermonItem, sermonMainReference, sermonPreacherId } from '@/utils/sermonInfo'
import { formatCountdown } from '@/utils/countdown'
import { formatServiceTime } from '@/utils/serviceTime'
import type { Service, ServiceItem, SermonPassage } from '@/models/service'
import type { Song, SongBlock } from '@/models/song'
import type { SlideLibraryItem, MediaItem, LibrarySlide } from '@/models/library'
import { personDisplayName, sortByPreferredRole } from '@/models/library'
import { scenePlainText } from '@/utils/slideScene'
import type { ScripturePassage, ScriptureTranslation, LiveSlideContent, RemoteCommand } from '@/adapters/types'

const route = useRoute()
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const mediaStore = useMediaStore()
const externalAppsStore = useExternalAppsStore()
const settingsStore = useSettingsStore()
const peopleStore = usePeopleStore()
const { isPresenting } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

const service = ref<Service>()
const selectedItemIndex = ref(0)
/** -1 = nothing live yet; equal to flatSlides.length = live but past the last slide (blank). */
const flatIndex = ref(-1)
const backgroundOnly = ref(false)
const indexBeforeBlank = ref(-1)

// Off by default — accidental drags while just browsing/clicking the Service Order list would
// be far more disruptive here than useful, so reordering is opt-in via the toggle next to the
// header rather than always-on.
const reorderMode = ref(false)
// selectedItemIndex is a raw array position, not an id — capture the selected item's own id
// before a drag starts so it can be re-found by id afterward, otherwise the "selected" item
// would silently become whatever ended up at that same index once the drag reshuffles the array.
const draggingItemId = ref<string>()
function onReorderStart() {
  draggingItemId.value = selectedItem.value?.id
}
function onReorderEnd() {
  if (service.value && draggingItemId.value) {
    const newIndex = service.value.items.findIndex((i) => i.id === draggingItemId.value)
    if (newIndex !== -1) selectedItemIndex.value = newIndex
  }
  draggingItemId.value = undefined
}

// Service details (date/type/sermon title/key passage/preacher) — the same fields
// CreateServiceView collects up front, editable afterward via this dialog rather than a
// separate screen, since it's the exact same small set of fields either way. Local drafts so
// Cancel discards cleanly; Save writes back to the real service (picked up by the existing
// deep watch on `service` below, same as any other in-place edit in this view).
const serviceDetailsDialogOpen = ref(false)
const editDate = ref('')
const editTime = ref('')
const editType = ref('')
const editSermonTitle = ref('')
const editKeyPassage = ref('')
const editPreacherId = ref<string>()
function openServiceDetailsDialog() {
  if (!service.value) return
  editDate.value = service.value.date
  editTime.value = service.value.time ?? ''
  editType.value = service.value.type
  const sermonItem = findSermonItem(service.value)
  editSermonTitle.value = sermonItem?.title ?? ''
  editKeyPassage.value = sermonItem ? sermonMainReference(sermonItem) : ''
  editPreacherId.value = sermonPreacherId(service.value, sermonItem)
  serviceDetailsDialogOpen.value = true
}
function saveServiceDetails() {
  if (!service.value) return
  service.value.date = editDate.value
  service.value.time = editTime.value || undefined
  service.value.type = editType.value
  // Only touch the sermon item if there's something to touch — editing just Date/Type on a
  // service with no sermon at all shouldn't spuriously create a blank one.
  if (editSermonTitle.value || editKeyPassage.value || editPreacherId.value || findSermonItem(service.value)) {
    applySermonEdit(
      service.value,
      { title: editSermonTitle.value, passageReference: editKeyPassage.value, preacherId: editPreacherId.value },
      defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, service.value.type),
      settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
    )
  }
  serviceDetailsDialogOpen.value = false
}
const preacherOptions = computed(() =>
  sortByPreferredRole(peopleStore.people, 'Preacher').map((p) => ({ title: personDisplayName(p), value: p.id })),
)
const preacherName = computed(() => {
  const currentService = service.value
  if (!currentService) return undefined
  const person = peopleStore.people.find((p) => p.id === sermonPreacherId(currentService))
  return person ? personDisplayName(person) : undefined
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
        .map((passage) => resolvePassage(`${item.id}:${passage.id}`, passage.reference, passage.translation)),
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
async function updateSermonPassageTranslation(itemId: string, passageId: string, translation: string) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const passage = item.passages.find((p) => p.id === passageId)
  if (!passage) return
  passage.translation = translation
  if (passage.displayMode !== 'reference-only') await resolvePassage(`${itemId}:${passageId}`, passage.reference, translation)
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
async function updateSermonPassageDisplayMode(itemId: string, passageId: string, displayMode: 'full' | 'reference-only') {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (!item || item.type !== 'sermon') return
  const passage = item.passages.find((p) => p.id === passageId)
  if (!passage) return
  passage.displayMode = displayMode
  if (displayMode === 'full') await resolvePassage(`${itemId}:${passageId}`, passage.reference, passage.translation)
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
  if (typeof ResizeObserver !== 'undefined') {
    previewResizeObserver = new ResizeObserver(([entry]) => {
      if (entry) previewThumbWidth.value = Math.max(240, Math.floor(entry.contentRect.width - 32))
    })
  }
  if (!songsStore.loaded) await songsStore.load()
  if (!slidesStore.loaded) await slidesStore.load()
  if (!mediaStore.loaded) await mediaStore.load()
  if (!externalAppsStore.loaded) await externalAppsStore.load()
  if (!peopleStore.loaded) await peopleStore.load()
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
  await nextTick()
  if (previewPanelRef.value) previewResizeObserver?.observe(previewPanelRef.value)
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
    else if (scriptureTranslations.value.length > 0) scriptureDraft.value.translation = scriptureTranslations.value[0].code
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
  previewResizeObserver?.disconnect()
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

// Changing a reference after the item's already been added — e.g. the operator picked the
// wrong verse range. A local draft (rather than binding straight to the item, like bulletinLabel
// does elsewhere in this view) so re-resolving — a real backend/API call, unlike a plain text
// field — only fires once on blur, not on every keystroke while typing a whole reference.
const scriptureReferenceDraft = ref('')
const sermonPassageReferenceDrafts = reactive<Record<string, string>>({})
watch(
  selectedItem,
  (item) => {
    if (item?.type === 'scripture') scriptureReferenceDraft.value = item.reference
    if (item?.type === 'sermon') {
      for (const passage of item.passages) sermonPassageReferenceDrafts[passage.id] = passage.reference
    }
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
  if (passage.displayMode !== 'reference-only') await resolvePassage(`${itemId}:${passageId}`, reference, passage.translation)
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
function sermonPassageText(itemId: string, passageId: string): string {
  const passage = scriptureById.get(`${itemId}:${passageId}`)
  return passage ? passage.verses.map((v) => `${v.number} ${v.text}`).join(' ') : ''
}
// A sermon's outline blocks come after however many flat slides its passages produced (which
// varies with pagination), so their flat index can't be derived the same way slideFlatIndex
// does for a fixed subIndex — instead, read it off this item's own already-flattened run
// (flattenService pushes passages then outline in that exact order, see its own doc comment).
function sermonOutlineFlatIndex(item: Extract<ServiceItem, { type: 'sermon' }>, outlineIndex: number): number {
  const itemSlides = flatSlides.value.filter((s) => s.itemId === item.id)
  const target = itemSlides[itemSlides.length - item.outline.length + outlineIndex]
  return target ? flatSlides.value.indexOf(target) : -1
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
    case 'sermon':
      return 'mdi-account-voice'
    case 'bulletin-note':
      return 'mdi-note-text-outline'
    case 'placeholder':
      return 'mdi-help-rhombus-outline'
    default:
      return 'mdi-file'
  }
}

// The Service Order list's icon is the same generic "?" for every placeholder regardless of
// what kind of content it wants (see itemIcon) — this is what actually distinguishes them at a
// glance in that list when the template didn't give this slot its own bulletin heading.
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

// sermon/bulletin-note/placeholder already resolve bulletinLabel as their own itemLabel() —
// showing it again as a distinct first line would just repeat the exact same text.
const BULLETIN_LABEL_DRIVEN_TYPES = new Set(['sermon', 'bulletin-note', 'placeholder'])

// For every other item type, an explicit bulletinLabel override takes the first line (with
// the item's own default content — song title, scripture reference, etc. — moved to the
// second line below), same as sermon/bulletin-note already prioritize it as their whole label.
function serviceOrderPrimaryLabel(item: ServiceItem): string {
  if (item.bulletinLabel && !BULLETIN_LABEL_DRIVEN_TYPES.has(item.type)) return item.bulletinLabel
  return itemLabel(item)
}

function serviceOrderSecondaryLabel(item: ServiceItem): string | undefined {
  if (item.type === 'sermon') return sermonMainReference(item) || undefined
  if (item.bulletinLabel && !BULLETIN_LABEL_DRIVEN_TYPES.has(item.type)) return itemLabel(item)
  return undefined
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
  if (item.type === 'sermon') return item.bulletinLabel || item.title || 'Worship Through the Word'
  if (item.type === 'bulletin-note') return item.bulletinLabel || 'Bulletin Note'
  if (item.type === 'placeholder') return item.bulletinLabel || item.label || `${placeholderTypeName(item.suggestedTab)} Placeholder`
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
const nextIndex = computed(() =>
  flatIndex.value === -1 ? 0 : Math.min(flatIndex.value + 1, Math.max(flatSlides.value.length - 1, 0)),
)
const prevIndex = computed(() => Math.max(flatIndex.value - 1, 0))
const previousDisabled = computed(() => flatSlides.value.length === 0 || flatIndex.value <= 0)
const nextDisabled = computed(() => flatSlides.value.length === 0 || flatIndex.value >= flatSlides.value.length - 1)
const isBlankScreen = computed(() => flatIndex.value >= 0 && flatIndex.value === flatSlides.value.length)
const nextPreviewLabel = computed(() => (nextDisabled.value ? 'End of service' : describeSlide(nextIndex.value)))
const prevPreviewLabel = computed(() => (previousDisabled.value ? 'Beginning of service' : describeSlide(prevIndex.value)))

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
  if (nextDisabled.value) return
  flatIndex.value = nextIndex.value
}
async function previous() {
  if (await tryForwardKeystroke('previous')) return
  if (previousDisabled.value) return
  flatIndex.value = prevIndex.value
}
function toggleBlankScreen() {
  if (isBlankScreen.value) {
    flatIndex.value = indexBeforeBlank.value
    return
  }
  indexBeforeBlank.value = flatIndex.value
  backgroundOnly.value = false
  flatIndex.value = flatSlides.value.length
}
function toggleBackgroundOnly() {
  if (!liveSlide.value) return
  backgroundOnly.value = !backgroundOnly.value
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
    scene: slide.scene,
    wayfindingBooks: slide.wayfindingBooks,
    bibleProgress: slide.bibleProgress,
    media:
      mediaUrl && slide.mediaId && slide.mediaKind && slide.mediaFit
        ? { url: mediaUrl, mediaId: slide.mediaId, kind: slide.mediaKind, fit: slide.mediaFit }
        : undefined,
    countdown: slide.countdown,
    fontRange: slide.fontRange,
    lineWrap: slide.lineWrap,
    headerFontSizePx: settingsStore.librarySettings?.slideHeaderFontSizePx,
    footerFontSizePx: settingsStore.librarySettings?.slideFooterFontSizePx,
    wayfindingMinFontSizePx: settingsStore.librarySettings?.wayfindingMinFontSizePx,
    wayfindingMaxFontSizePx: settingsStore.librarySettings?.wayfindingMaxFontSizePx,
  }
}
const liveContentPayload = computed<LiveSlideContent | undefined>(() => {
  const content = buildLiveContent(liveSlide.value)
  return content ? { ...content, backgroundOnly: backgroundOnly.value } : undefined
})

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
const previewPanelRef = ref<HTMLElement>()
const previewThumbWidth = ref(340)
let previewResizeObserver: ResizeObserver | undefined
const previewScale = computed(() => previewThumbWidth.value / PREVIEW_VIRTUAL_SIZE.value.width)
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
const currentSlideLabel = computed(() => {
  if (isBlankScreen.value) return 'Blank Screen'
  if (!liveSlide.value) return 'No Slide Selected'
  return `${liveSlide.value.itemLabel} — ${liveSlide.value.subLabel}`
})
const slidePositionLabel = computed(() => {
  if (flatSlides.value.length === 0) return 'No Slides'
  if (isBlankScreen.value) return 'Screen Blank'
  if (flatIndex.value < 0) return `${flatSlides.value.length} Slides Ready`
  return `Slide ${flatIndex.value + 1} of ${flatSlides.value.length}`
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
    case 'b':
    case 'B':
      event.preventDefault()
      toggleBlankScreen()
      break
    case 'g':
    case 'G':
      event.preventDefault()
      toggleBackgroundOnly()
      break
  }
}

// The Add Item menu chooses the item type before opening its focused form. All forms still
// share one dialog and reset path below, so selecting a type doesn't duplicate any of the
// existing add behavior or draft state.
type AddItemType = 'songs' | 'scripture' | 'slides' | 'media' | 'video' | 'external-app' | 'countdown' | 'sermon' | 'bulletin-note'
const addTab = ref<AddItemType>('songs')
const addTabOptions = computed(() => {
  const options: { title: string; description: string; icon: string; value: AddItemType }[] = [
    { title: 'Song', description: 'Add lyrics from the song library', icon: 'mdi-music-note', value: 'songs' },
    { title: 'Scripture', description: 'Build a passage or reference slide', icon: 'mdi-book-open-page-variant', value: 'scripture' },
    { title: 'Slides', description: 'Use library or service-only slides', icon: 'mdi-presentation', value: 'slides' },
    { title: 'Media', description: 'Add an image from the media library', icon: 'mdi-image-outline', value: 'media' },
    { title: 'Video', description: 'Add a video from the media library', icon: 'mdi-movie-open-outline', value: 'video' },
  ]
  if (getAdapter().externalApps) {
    options.push({ title: 'External App', description: 'Hand off to a configured application', icon: 'mdi-application-outline', value: 'external-app' })
  }
  options.push(
    { title: 'Countdown', description: 'Show a countdown to a target time', icon: 'mdi-timer-outline', value: 'countdown' },
    { title: 'Sermon', description: 'Add passages and sermon outline slides', icon: 'mdi-podium', value: 'sermon' },
    { title: 'Bulletin Note', description: 'Add a printed, non-presented item', icon: 'mdi-file-document-outline', value: 'bulletin-note' },
  )
  return options
})
const activeAddTypeTitle = computed(() => addTabOptions.value.find((option) => option.value === addTab.value)?.title ?? 'Item')

function openAddDialog(type: AddItemType) {
  addTab.value = type
  addDialogOpen.value = true
}

// Set only while filling in a Service Template's placeholder (see beginReplacePlaceholder) —
// makes every add*ToService function below splice the new item into the placeholder's own
// slot instead of appending it, since there's no reordering for the top-level item list today.
const replaceItemIndex = ref<number | null>(null)
const replaceItemRole = ref<string>()
const replaceItemLabel = ref<string>()

function insertItem(item: ServiceItem) {
  if (!service.value) return
  if (replaceItemIndex.value !== null) {
    if (replaceItemRole.value && !item.role) item.role = replaceItemRole.value
    if (replaceItemLabel.value && !item.bulletinLabel) item.bulletinLabel = replaceItemLabel.value
    service.value.items.splice(replaceItemIndex.value, 1, item)
    // Deliberately NOT recomputed from length — it already points at the placeholder's slot,
    // which is exactly where the replacement now lives.
  } else {
    service.value.items.push(item)
    selectedItemIndex.value = service.value.items.length - 1
  }
}

function beginReplacePlaceholder(item: ServiceItem, index: number) {
  if (item.type !== 'placeholder') return
  replaceItemIndex.value = index
  replaceItemRole.value = item.role
  replaceItemLabel.value = item.bulletinLabel ?? item.label
  addTab.value = (item.suggestedTab as typeof addTab.value) ?? 'songs'
  addDialogOpen.value = true
}

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
    insertItem(item)
    closeAddDialog()
  } finally {
    addingSong.value = false
  }
}

// Scripture sub-picker (spec section 2) — the actual entry-mode/fields/display-mode/preview UI
// lives in ScriptureReferencePicker.vue (shared with the Sermon tab's passages list below,
// which needs several independent instances of the same picker); this is just the draft value
// plus the template ref used to read its exposed validity/resolved-passage on submit.
const scriptureDraft = ref<ScriptureReferenceValue>({ reference: '', translation: '', displayMode: 'full' })
const scripturePickerRef = ref<InstanceType<typeof ScriptureReferencePicker>>()
const scripturePickerResetKey = ref(0)
const scriptureTranslations = ref<ScriptureTranslation[]>([])
const addingScripture = ref(false)

async function addScriptureToService() {
  const picker = scripturePickerRef.value
  if (!service.value || !picker?.isValid || addingScripture.value) return
  if (scriptureDraft.value.displayMode === 'full' && (!scriptureDraft.value.translation || picker.hasError)) return
  addingScripture.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'scripture',
      reference: scriptureDraft.value.reference,
      translation: scriptureDraft.value.translation,
      displayMode: scriptureDraft.value.displayMode,
    }
    insertItem(item)
    if (picker.resolvedPassage && scriptureDraft.value.displayMode === 'full') scriptureById.set(item.id, picker.resolvedPassage)
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
  return slidesStore.slides.filter(
    (item) => !q || item.label.toLowerCase().includes(q) || (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
  )
})

async function addSlideRefToService(slideItem: SlideLibraryItem) {
  if (!service.value || addingSlideRef.value) return
  addingSlideRef.value = true
  try {
    const item: ServiceItem = { id: `item-${crypto.randomUUID()}`, type: 'slide-ref', slideId: slideItem.id }
    insertItem(item)
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
  insertItem(item)
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
    insertItem(item)
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
    insertItem(item)
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
    insertItem(item)
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
  insertItem(item)
  closeAddDialog()
}

// Sermon sub-picker: a reorderable list of passages (each its own ScriptureReferencePicker,
// same as the Scripture tab, just N instances), one marked "main" for the printed bulletin
// line (see orderOfWorship.ts), then a presentable outline — same block-editor pattern as the
// Slides tab's "+ New Text Slides".
interface SermonPassageDraft {
  id: string
  value: ScriptureReferenceValue
}
const sermonTitleDraft = ref('')
const sermonPassages = ref<SermonPassageDraft[]>([])
const sermonMainPassageId = ref<string>()
const sermonOutlineBlocks = ref<SongBlock[]>([])
const sermonPassagePickerRefs = ref<Record<string, InstanceType<typeof ScriptureReferencePicker> | null>>({})
const addingSermon = ref(false)

function setSermonPassageRef(id: string, el: unknown) {
  sermonPassagePickerRefs.value[id] = el as InstanceType<typeof ScriptureReferencePicker> | null
}
function addSermonPassage() {
  const id = `passage-${crypto.randomUUID()}`
  sermonPassages.value.push({ id, value: { reference: '', translation: scriptureDraft.value.translation, displayMode: 'full' } })
  if (!sermonMainPassageId.value) sermonMainPassageId.value = id
}
async function removeSermonPassage(id: string) {
  const index = sermonPassages.value.findIndex((p) => p.id === id)
  if (index === -1) return
  if (!(await confirmDialog.confirm('Remove this passage?', 'Remove'))) return
  sermonPassages.value.splice(index, 1)
  delete sermonPassagePickerRefs.value[id]
  if (sermonMainPassageId.value === id) sermonMainPassageId.value = sermonPassages.value[0]?.id
}
function addSermonOutlineBlock() {
  sermonOutlineBlocks.value.push({ id: `outline-${crypto.randomUUID()}`, label: `Point ${sermonOutlineBlocks.value.length + 1}`, text: '' })
}
async function removeSermonOutlineBlock(index: number) {
  const target = sermonOutlineBlocks.value[index]
  if (!target) return
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  sermonOutlineBlocks.value.splice(index, 1)
}
const sermonPassagesValid = computed(() => sermonPassages.value.every((p) => sermonPassagePickerRefs.value[p.id]?.isValid))

async function addSermonToService() {
  if (
    !service.value ||
    sermonPassages.value.length === 0 ||
    !sermonMainPassageId.value ||
    !sermonPassagesValid.value ||
    addingSermon.value
  ) {
    return
  }
  addingSermon.value = true
  try {
    const passages: SermonPassage[] = sermonPassages.value.map((p) => ({
      id: p.id,
      reference: p.value.reference,
      translation: p.value.translation,
      displayMode: p.value.displayMode,
    }))
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'sermon',
      title: sermonTitleDraft.value.trim() || undefined,
      passages,
      mainPassageId: sermonMainPassageId.value,
      outline: sermonOutlineBlocks.value.map((block) => ({ ...block })),
    }
    insertItem(item)
    for (const passage of sermonPassages.value) {
      const resolved = sermonPassagePickerRefs.value[passage.id]?.resolvedPassage
      if (resolved && passage.value.displayMode === 'full') scriptureById.set(`${item.id}:${passage.id}`, resolved)
    }
    closeAddDialog()
  } finally {
    addingSermon.value = false
  }
}

// Bulletin Note sub-picker: a line that only ever appears in the printed Order of Worship (see
// orderOfWorship.ts) — its heading/body are the shared bulletinLabel/bulletinNote fields
// every item has, not fields of their own (see ServiceItemContent's BulletinNote variant).
const bulletinNoteLabel = ref('')
const bulletinNoteText = ref('')

function addBulletinNoteToService() {
  if (!service.value || !bulletinNoteLabel.value.trim()) return
  const item: ServiceItem = {
    id: `item-${crypto.randomUUID()}`,
    type: 'bulletin-note',
    bulletinLabel: bulletinNoteLabel.value.trim(),
    bulletinNote: bulletinNoteText.value.trim() || undefined,
  }
  insertItem(item)
  closeAddDialog()
}

function closeAddDialog() {
  addDialogOpen.value = false
  addQuery.value = ''
  scriptureDraft.value = { reference: '', translation: '', displayMode: 'full' }
  // Forces a fresh ScriptureReferencePicker instance next open — the component owns its own
  // entry-mode/book/chapter/verse state internally, so remounting (rather than trying to push
  // a reset into it via props) is what actually clears a half-typed reference between opens.
  scripturePickerResetKey.value++
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
  sermonTitleDraft.value = ''
  sermonPassages.value = []
  sermonMainPassageId.value = undefined
  sermonOutlineBlocks.value = []
  sermonPassagePickerRefs.value = {}
  bulletinNoteLabel.value = ''
  bulletinNoteText.value = ''
  replaceItemIndex.value = null
  replaceItemRole.value = undefined
  replaceItemLabel.value = undefined
}

function updatePresenterNote(itemId: string, note: string) {
  if (!service.value) return
  if (!service.value.presenterNotes) service.value.presenterNotes = {}
  service.value.presenterNotes[itemId] = note
}

// Who's doing this part (Elder leading prayer, scripture reader, etc.) — a role from the same
// catalog Assignments uses, not a Person reference directly: the actual person is whoever that
// service's Assignments has for this role (see AssignmentsView.vue), so this is just a pointer
// to which role, kept automatically in sync rather than a second place that could disagree.
interface ItemRoleOption {
  type?: 'subheader'
  title: string
  value?: string
}
const itemRoleOptions = computed<ItemRoleOption[]>(() => {
  const items: ItemRoleOption[] = []
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    if (!group.roles.length) continue
    items.push({ type: 'subheader', title: group.name })
    for (const role of group.roles) items.push({ title: role, value: role })
  }
  return items
})
function updateItemRole(itemId: string, role: string | undefined) {
  const item = service.value?.items.find((i) => i.id === itemId)
  if (item) item.role = role
}
const rolePersonOptions = computed(() => peopleStore.people.map((p) => ({ title: personDisplayName(p), value: p.id })))
function assignedPersonId(role: string | undefined): string | undefined {
  return service.value?.assignments?.find((a) => a.role === role)?.personId
}
// Editing directly here (rather than only via the Assignments page) writes to the exact same
// service.assignments array Assignments reads from — one RoleAssignment per role, created on
// first use here if this role has never been assigned anything for this service yet.
function updateRolePerson(role: string, personId: string | undefined) {
  if (!service.value) return
  if (!service.value.assignments) service.value.assignments = []
  const assignment = service.value.assignments.find((a) => a.role === role)
  if (assignment) assignment.personId = personId
  else service.value.assignments.push({ role, personId, tentative: false })
}
</script>

<template>
  <div v-if="service" class="workspace-root">
    <div class="workspace-toolbar">
      <div class="workspace-service-context">
        <v-btn icon="mdi-arrow-left" variant="text" size="small" to="/" class="service-back-button" aria-label="Back to services" />
        <span class="workspace-service-icon"><v-icon icon="mdi-church-outline" size="22" /></span>
        <div class="workspace-service-heading">
          <div class="workspace-title-line">
            <span class="workspace-service-title">{{ service.type }}</span>
            <span v-if="isPresenting" class="presenting-badge"><i />Live</span>
          </div>
          <div class="workspace-service-metadata">
            <span class="workspace-service-date"><v-icon icon="mdi-calendar-clock-outline" size="16" />{{ serviceDateLabel }}</span>
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
          @click="openServiceDetailsDialog"
        />
      </div>
      <div class="workspace-actions">
        <v-btn variant="tonal" prepend-icon="mdi-account-group-outline" :to="`/service/${service.id}/assignments`">
          Assignments
        </v-btn>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-file-document-outline"
          :to="{ name: 'reports-home', query: { service: service.id } }"
        >
          Bulletin
        </v-btn>
        <span class="action-divider" />
        <v-btn :color="isPresenting ? 'error' : 'primary'" variant="flat" class="present-button" @click="togglePresenting">
          <v-icon :icon="isPresenting ? 'mdi-stop' : 'mdi-play'" start />
          {{ isPresenting ? 'Stop Presenting' : 'Start Presenting' }}
        </v-btn>
      </div>
    </div>

    <div class="workspace-layout">
      <div class="service-panel">
        <div class="service-panel-header">
          <div>
            <div class="panel-title">Order of Service</div>
            <div class="panel-subtitle">{{ service.items.length }} item{{ service.items.length === 1 ? '' : 's' }}</div>
          </div>
          <v-btn
            :icon="reorderMode ? 'mdi-check' : 'mdi-swap-vertical'"
            variant="text"
            size="small"
            :title="reorderMode ? 'Done reordering' : 'Reorder items'"
            @click="reorderMode = !reorderMode"
          />
        </div>
        <v-menu location="bottom" :close-on-content-click="true">
          <template #activator="{ props }">
            <button
              v-bind="props"
              type="button"
              class="add-service-button"
            >
              <span class="add-service-button-main">
                <v-icon icon="mdi-plus" size="20" />
                <span>Add Item</span>
              </span>
              <span class="add-service-button-chevron">
                <v-icon icon="mdi-chevron-down" size="18" />
              </span>
            </button>
          </template>
          <v-list class="add-item-menu" density="compact">
            <v-list-item
              v-for="option in addTabOptions"
              :key="option.value"
              :title="option.title"
              :subtitle="option.description"
              :prepend-icon="option.icon"
              @click="openAddDialog(option.value)"
            />
          </v-list>
        </v-menu>
        <div class="service-list flex-grow-1 overflow-y-auto">
          <VueDraggable
            v-if="reorderMode"
            v-model="service.items"
            handle=".service-item-drag-handle"
            :animation="150"
            :on-start="onReorderStart"
            :on-end="onReorderEnd"
          >
            <div
              v-for="(item, index) in service.items"
              :key="item.id"
              class="service-item"
              :class="{ 'service-item--selected': index === selectedItemIndex, 'service-item--live': itemHasLive(index) }"
              @click="selectedItemIndex = index"
            >
              <span class="service-item-index">{{ index + 1 }}</span>
              <v-icon icon="mdi-drag-vertical" class="service-item-drag-handle" size="small" style="cursor: grab" />
              <div class="flex-grow-1" style="min-width: 0">
                <div :class="{ 'font-italic': item.type === 'placeholder' }">{{ serviceOrderPrimaryLabel(item) }}</div>
                <div v-if="serviceOrderSecondaryLabel(item)" class="text-caption text-medium-emphasis">
                  {{ serviceOrderSecondaryLabel(item) }}
                </div>
              </div>
            </div>
          </VueDraggable>
          <template v-else>
            <div
              v-for="(item, index) in service.items"
              :key="item.id"
              class="service-item"
              :class="{ 'service-item--selected': index === selectedItemIndex, 'service-item--live': itemHasLive(index) }"
              @click="selectedItemIndex = index"
            >
              <span class="service-item-index">{{ index + 1 }}</span>
              <span class="service-item-icon" :style="{ color: `rgb(var(--v-theme-${itemColor(item)}))` }">
                <v-icon :icon="itemIcon(item)" size="17" />
              </span>
              <div class="flex-grow-1" style="min-width: 0">
                <div class="service-item-title" :class="{ 'font-italic': item.type === 'placeholder' }">
                  {{ serviceOrderPrimaryLabel(item) }}
                </div>
                <div v-if="serviceOrderSecondaryLabel(item)" class="text-caption text-medium-emphasis">
                  {{ serviceOrderSecondaryLabel(item) }}
                </div>
              </div>
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                class="row-remove"
                size="x-small"
                title="Remove from service"
                @click.stop="removeServiceItem(index)"
              />
            </div>
          </template>
        </div>
        <div v-if="reorderMode" class="service-panel-footer">
          <v-icon icon="mdi-drag-vertical" size="14" />
          <span>Drag items into order</span>
        </div>
      </div>

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
                :style="slideRowStyle(blockId, flatIndex === slideFlatIndex(selectedItem.id, index))"
                @click="goLive(slideFlatIndex(selectedItem.id, index))"
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
              @update:model-value="(value: 'full' | 'reference-only') => updateScriptureDisplayMode(selectedItem!.id, value)"
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
              @update:model-value="(value: string) => updateScriptureTranslation(selectedItem!.id, value)"
            />
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              :style="[
                { whiteSpace: 'pre-line' },
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
                  <div class="text-body-2" style="white-space: pre-line; opacity: 0.75">{{ slideGroupText(slide) }}</div>
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

          <template v-else-if="selectedItem.type === 'sermon'">
            <div v-for="(passage, index) in selectedItem.passages" :key="passage.id" class="mb-3">
              <div class="text-caption font-weight-bold text-medium-emphasis mb-1">
                Passage {{ index + 1 }}<span v-if="passage.id === selectedItem.mainPassageId"> · Main (printed in the bulletin)</span>
              </div>
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
                @update:model-value="(value: 'full' | 'reference-only') => updateSermonPassageDisplayMode(selectedItem!.id, passage.id, value)"
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
                @update:model-value="(value: string) => updateSermonPassageTranslation(selectedItem!.id, passage.id, value)"
              />
              <div
                class="slide-row"
                :style="{
                  background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                  borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                  paddingLeft: '9px',
                }"
              >
                <div v-if="passage.displayMode === 'reference-only'" class="text-body-2 text-medium-emphasis">
                  Reference only — no verse text shown.
                </div>
                <div v-else-if="scriptureErrors.get(`${selectedItem.id}:${passage.id}`)" class="text-body-2 text-error">
                  {{ scriptureErrors.get(`${selectedItem.id}:${passage.id}`) }}
                </div>
                <template v-else-if="scriptureById.get(`${selectedItem.id}:${passage.id}`)">
                  <div class="text-body-2">{{ sermonPassageText(selectedItem.id, passage.id) }}</div>
                </template>
                <div v-else class="text-body-2 text-medium-emphasis">Loading…</div>
              </div>
            </div>

            <div class="text-overline text-medium-emphasis mt-4 mb-2">Outline</div>
            <p v-if="selectedItem.outline.length === 0" class="text-medium-emphasis">No outline yet.</p>
            <div v-else class="d-flex flex-column ga-1" style="max-width: 460px">
              <div
                v-for="(block, index) in selectedItem.outline"
                :key="block.id"
                class="slide-row"
                :class="{ 'slide-row--live': flatIndex === sermonOutlineFlatIndex(selectedItem, index) }"
                :style="
                  flatIndex === sermonOutlineFlatIndex(selectedItem, index)
                    ? undefined
                    : {
                        background: `rgba(var(--v-theme-${itemColor(selectedItem)}), 0.08)`,
                        borderLeft: `3px solid rgb(var(--v-theme-${itemColor(selectedItem)}))`,
                        paddingLeft: '9px',
                      }
                "
                @click="goLive(sermonOutlineFlatIndex(selectedItem, index))"
              >
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="text-body-2 font-weight-bold">{{ block.label }}</div>
                  <div class="text-caption text-medium-emphasis text-truncate">{{ block.text }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="selectedItem.type === 'bulletin-note'">
            <div class="bulletin-only-callout">
              <span class="bulletin-only-icon"><v-icon icon="mdi-file-document-outline" size="20" /></span>
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
              style="max-width: 460px; background: rgba(var(--v-theme-amber), 0.08); border-left: 3px solid rgb(var(--v-theme-amber)); padding-left: 9px"
            >
              <div class="flex-grow-1" style="min-width: 0">
                <div class="text-body-2 font-weight-bold">{{ selectedItem.label }}</div>
                <div class="text-body-2 text-medium-emphasis">This slot hasn't been filled in yet.</div>
              </div>
            </div>
            <v-btn
              variant="flat"
              color="primary"
              class="mt-3"
              prepend-icon="mdi-pencil"
              @click="beginReplacePlaceholder(selectedItem, selectedItemIndex)"
            >
              Fill In This Slot
            </v-btn>
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

          <div class="property-inspector">
            <section class="property-section">
              <div class="property-section-title">Order of Worship</div>
              <label class="property-row">
                <span>Label</span>
                <v-text-field
                  :model-value="selectedItem.bulletinLabel"
                  variant="outlined"
                  density="compact"
                  clearable
                  hide-details
                  :placeholder="selectedItem.type === 'bulletin-note' ? 'Bulletin heading' : 'Use default heading'"
                  @update:model-value="(value: string | undefined) => (selectedItem!.bulletinLabel = value || undefined)"
                />
              </label>
              <label class="property-row property-row--top">
                <span>Note</span>
                <v-textarea
                  :model-value="selectedItem.bulletinNote"
                  variant="outlined"
                  density="compact"
                  hide-details
                  rows="2"
                  placeholder="Optional printed note"
                  @update:model-value="(value: string) => (selectedItem!.bulletinNote = value || undefined)"
                />
              </label>
            </section>

            <section class="property-section">
              <div class="property-section-title">People</div>
              <label class="property-row">
                <span>Role</span>
                <v-select
                  :model-value="selectedItem.role"
                  :items="itemRoleOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  hide-details
                  placeholder="No role"
                  @update:model-value="(value: string | undefined) => updateItemRole(selectedItem!.id, value)"
                />
              </label>
              <label v-if="selectedItem.role" class="property-row">
                <span>Assigned</span>
                <v-select
                  :model-value="assignedPersonId(selectedItem.role)"
                  :items="rolePersonOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  hide-details
                  placeholder="Not assigned"
                  @update:model-value="(value: string | undefined) => updateRolePerson(selectedItem!.role!, value)"
                />
              </label>
            </section>

            <section class="property-section">
              <div class="property-section-title">Operator</div>
              <label class="property-row property-row--top">
                <span>Notes</span>
                <v-textarea
                  :model-value="service.presenterNotes?.[selectedItem.id]"
                  variant="outlined"
                  density="compact"
                  hide-details
                  rows="2"
                  placeholder="Only visible to the operator"
                  @update:model-value="(value: string) => updatePresenterNote(selectedItem!.id, value)"
                />
              </label>
            </section>
          </div>
        </template>
        <p v-else class="text-medium-emphasis">This service has no items yet.</p>
      </div>

      <div ref="previewPanelRef" class="preview-panel">
        <div class="preview-panel-header">
          <div class="panel-title">Presentation</div>
          <div class="panel-subtitle">Previous · Current · Next</div>
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
              :style="{ width: `${previewThumbWidth}px`, height: `${previewThumbHeight}px` }"
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
      <button type="button" class="transport-destination transport-destination--previous" :disabled="previousDisabled" @click="previous">
        <v-icon icon="mdi-chevron-left" size="25" />
        <span class="destination-copy">
          <small>Previous</small>
          <strong>{{ prevPreviewLabel }}</strong>
        </span>
        <kbd>←</kbd>
      </button>

      <div class="transport-center">
        <div class="transport-current">
          <span class="transport-mode" :class="{ 'transport-mode--live': isPresenting }">
            <i />{{ isPresenting ? 'Live' : 'Preview' }}
          </span>
          <div class="current-slide-copy">
            <strong>{{ currentSlideLabel }}</strong>
            <span v-if="liveContextSnippet">{{ liveContextSnippet }}</span>
          </div>
          <span class="slide-position">{{ slidePositionLabel }}</span>
        </div>
        <div class="screen-overrides" aria-label="Screen overrides">
          <v-btn
            :variant="backgroundOnly ? 'flat' : 'tonal'"
            :color="backgroundOnly ? 'primary' : undefined"
            prepend-icon="mdi-image-outline"
            size="small"
            :disabled="!liveSlide"
            class="screen-override-button"
            @click="toggleBackgroundOnly"
          >
            Background Only <kbd>G</kbd>
          </v-btn>
          <v-btn
            :variant="isBlankScreen ? 'flat' : 'tonal'"
            :color="isBlankScreen ? 'primary' : undefined"
            prepend-icon="mdi-monitor-off"
            size="small"
            class="screen-override-button"
            :aria-pressed="isBlankScreen"
            @click="toggleBlankScreen"
          >
            {{ isBlankScreen ? 'Restore Screen' : 'Blank Screen' }} <kbd>B</kbd>
          </v-btn>
        </div>
      </div>

      <button type="button" class="transport-destination transport-destination--next" :disabled="nextDisabled" @click="next">
        <kbd>→</kbd>
        <span class="destination-copy">
          <small>Next</small>
          <strong>{{ nextPreviewLabel }}</strong>
        </span>
        <v-icon icon="mdi-chevron-right" size="25" />
      </button>
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
              <v-text-field v-model="editTime" type="time" step="300" label="Start Time" variant="outlined" clearable />
            </v-col>
          </v-row>
          <v-select v-model="editType" :items="settingsStore.librarySettings?.serviceTypes ?? []" label="Type" variant="outlined" />
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
              <v-select
                v-model="editPreacherId"
                :items="preacherOptions"
                label="Preacher (optional)"
                variant="outlined"
                clearable
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
      <!-- height must be the v-card PROP, not a height CSS class — Vuetify's own dialog
           stylesheet applies `flex: 1 1 var(--v-card-height, 100%)` to any .v-card inside a
           .v-dialog, and flex-basis overrides a plain `height` for sizing purposes regardless
           of specificity. Only the height PROP populates that --v-card-height variable. -->
      <v-card height="640" class="add-service-card">
        <v-card-title>Add {{ activeAddTypeTitle }}</v-card-title>
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
              <ScriptureReferencePicker
                :key="scripturePickerResetKey"
                ref="scripturePickerRef"
                v-model="scriptureDraft"
                :translations="scriptureTranslations"
              />

              <v-btn
                variant="flat"
                color="primary"
                block
                :disabled="!scripturePickerRef?.isValid || (scriptureDraft.displayMode === 'full' && (!scriptureDraft.translation || scripturePickerRef?.hasError))"
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

            <v-window-item value="sermon">
              <v-text-field
                v-model="sermonTitleDraft"
                label="Sermon Title (optional)"
                placeholder="e.g. Our Lord's Prayer"
                variant="outlined"
                class="mb-3"
              />
              <div class="text-overline text-medium-emphasis mb-2">Passages</div>
              <v-card v-for="passage in sermonPassages" :key="passage.id" variant="outlined" rounded="lg" class="pa-3 mb-3">
                <div class="d-flex align-center justify-space-between mb-2">
                  <v-btn
                    :variant="sermonMainPassageId === passage.id ? 'flat' : 'outlined'"
                    :color="sermonMainPassageId === passage.id ? 'primary' : undefined"
                    size="small"
                    prepend-icon="mdi-star"
                    @click="sermonMainPassageId = passage.id"
                  >
                    {{ sermonMainPassageId === passage.id ? 'Main Passage' : 'Set as Main' }}
                  </v-btn>
                  <v-btn icon="mdi-delete-outline" variant="text" size="small" @click="removeSermonPassage(passage.id)" />
                </div>
                <ScriptureReferencePicker
                  :ref="(el) => setSermonPassageRef(passage.id, el)"
                  v-model="passage.value"
                  :translations="scriptureTranslations"
                />
              </v-card>
              <v-btn variant="outlined" class="mb-4" prepend-icon="mdi-plus" @click="addSermonPassage">Add Passage</v-btn>

              <div class="text-overline text-medium-emphasis mb-2">Outline</div>
              <p class="text-caption text-medium-emphasis mb-3">
                Presentable points for this sermon only — not added to the Slide Library.
              </p>
              <VueDraggable v-model="sermonOutlineBlocks" handle=".drag-handle" :animation="150" class="d-flex flex-column ga-2 mb-3">
                <v-card v-for="(block, index) in sermonOutlineBlocks" :key="block.id" variant="outlined" rounded="lg">
                  <div class="d-flex align-center ga-2 px-2 py-1 border-b">
                    <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
                    <v-text-field v-model="block.label" variant="filled" density="compact" hide-details class="flex-grow-1" />
                    <v-btn
                      icon="mdi-trash-can-outline"
                      variant="flat"
                      color="error"
                      size="small"
                      @click="removeSermonOutlineBlock(index)"
                    />
                  </div>
                  <v-textarea v-model="block.text" variant="filled" density="compact" rows="2" auto-grow hide-details class="px-2 py-1" />
                </v-card>
              </VueDraggable>
              <v-btn variant="flat" color="primary" class="mb-3" prepend-icon="mdi-plus" @click="addSermonOutlineBlock">
                Add Outline Point
              </v-btn>

              <v-btn
                variant="flat"
                color="primary"
                block
                :disabled="sermonPassages.length === 0 || !sermonMainPassageId || !sermonPassagesValid"
                :loading="addingSermon"
                @click="addSermonToService"
              >
                Add Sermon
              </v-btn>
            </v-window-item>

            <v-window-item value="bulletin-note">
              <v-text-field
                v-model="bulletinNoteLabel"
                label="Bulletin Label"
                placeholder="e.g. Silent Preparation"
                variant="outlined"
                density="comfortable"
                class="mb-3"
              />
              <v-textarea
                v-model="bulletinNoteText"
                label="Bulletin Note (optional)"
                placeholder="e.g. (please spend the next few moments preparing your heart for corporate worship)"
                variant="outlined"
                density="comfortable"
                rows="2"
                auto-grow
                class="mb-3"
              />
              <p class="text-caption text-medium-emphasis mb-3">
                This item only appears in the printed Order of Worship — it never becomes a slide.
              </p>
              <v-btn variant="flat" color="primary" block :disabled="!bulletinNoteLabel.trim()" @click="addBulletinNoteToService">
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
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-background), 0.92);
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
.workspace-service-context {
  display: grid;
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
.present-button {
  min-width: 158px;
}
@media (max-width: 1060px) {
  .workspace-service-sermon {
    display: none;
  }
  .workspace-actions .v-btn:not(.present-button),
  .action-divider {
    display: none;
  }
}
.workspace-layout {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(430px, 1fr) minmax(320px, 380px);
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: rgb(var(--v-theme-background));
}
.service-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  min-height: 0;
}
.service-panel-header,
.preview-panel-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.panel-title {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}
.panel-subtitle {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
}
.add-service-button {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  width: calc(100% - 24px);
  height: 42px;
  margin: 12px 12px 5px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 7px;
  background: rgba(var(--v-theme-surface-variant), 0.42);
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.add-service-button:hover,
.add-service-button[aria-expanded='true'] {
  border-color: rgba(var(--v-theme-primary), 0.48);
  background: rgba(var(--v-theme-primary), 0.1);
}
.add-service-button:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.72);
  outline-offset: 2px;
}
.add-service-button-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
}
.add-service-button-chevron {
  display: grid;
  width: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.add-item-menu {
  width: 330px;
  max-height: min(620px, calc(100vh - 120px));
  padding: 6px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
}
.add-item-menu :deep(.v-list-item) {
  min-height: 52px;
  margin-bottom: 2px;
  border-radius: 7px;
}
.add-item-menu :deep(.v-list-item-subtitle) {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}
.service-list {
  padding: 7px 8px 10px;
}
.service-panel-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 38px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.preview-panel {
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  min-height: 0;
  overflow-y: auto;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 14px 16px 22px;
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
.service-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 53px;
  padding: 7px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.055);
  border-radius: 7px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  cursor: pointer;
  font-size: 0.84rem;
  margin-bottom: 5px;
  transition:
    background-color 130ms ease,
    border-color 130ms ease,
    box-shadow 130ms ease,
    transform 130ms ease;
}
.service-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.25);
  background: rgba(var(--v-theme-primary), 0.08);
}
.service-item--selected {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.14);
  box-shadow: inset 3px 0 rgb(var(--v-theme-primary));
}
.service-item--live {
  box-shadow: inset 3px 0 rgb(var(--v-theme-error));
}
.service-item--selected.service-item--live {
  box-shadow:
    inset 3px 0 rgb(var(--v-theme-error)),
    inset 0 0 0 1px rgba(var(--v-theme-primary), 0.2);
}
.service-item-index {
  width: 16px;
  flex: 0 0 16px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.service-item-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.service-item-title {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.center-panel {
  padding: 0 24px 28px;
  overflow-y: auto;
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
.slide-row--live {
  background: rgba(var(--v-theme-error), 0.1);
  border-left: 3px solid rgb(var(--v-theme-error));
  padding-left: 9px;
}
.row-remove {
  opacity: 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  transition:
    opacity 120ms ease,
    color 120ms ease;
}
.slide-row:hover .row-remove,
.service-item:hover .row-remove {
  opacity: 1;
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
.property-inspector {
  max-width: 680px;
  margin-top: 28px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-surface), 0.68);
}
.property-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 16px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.property-section:last-child {
  border-bottom: 0;
}
.property-section-title {
  margin-bottom: 3px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}
.property-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}
.property-row > span {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.76rem;
}
.property-row--top {
  align-items: start;
}
.property-row--top > span {
  padding-top: 9px;
}
.property-inspector :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-background), 0.55);
  font-size: 0.8rem;
}
.property-inspector :deep(.v-field__input) {
  min-height: 38px;
  padding-top: 7px;
  padding-bottom: 7px;
}
.external-app-alert {
  flex-shrink: 0;
  margin: 0 20px 10px;
}
.live-footer {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(390px, 1.35fr) minmax(220px, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 82px;
  padding: 9px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background:
    linear-gradient(180deg, rgba(var(--v-theme-surface), 0.98), rgba(var(--v-theme-surface-variant), 0.48));
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.08);
}
.transport-destination {
  display: grid;
  min-width: 0;
  min-height: 58px;
  grid-template-columns: 28px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.transport-destination:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.065);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.transport-destination:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 1px;
}
.transport-destination:disabled {
  cursor: default;
  opacity: 0.42;
}
.transport-destination--next {
  border-color: rgba(var(--v-theme-primary), 0.18);
  background: rgba(var(--v-theme-primary), 0.08);
}
.transport-destination--next .destination-copy {
  text-align: right;
}
.destination-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.destination-copy small {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.61rem;
  font-weight: 720;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.destination-copy strong {
  overflow: hidden;
  color: inherit;
  font-size: 0.72rem;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-footer kbd {
  display: inline-grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  padding: 0 5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-bottom-color: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-family: inherit;
  font-size: 0.66rem;
  font-weight: 650;
  line-height: 1;
}
.transport-center {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 11px;
}
.transport-current {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.transport-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid rgba(var(--v-theme-slate), 0.22);
  border-radius: 5px;
  background: rgba(var(--v-theme-slate), 0.09);
  color: rgb(var(--v-theme-slate));
  font-size: 0.61rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.transport-mode i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.transport-mode--live {
  border-color: rgba(var(--v-theme-error), 0.28);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.transport-mode--live i {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.12);
}
.current-slide-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}
.current-slide-copy strong,
.current-slide-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current-slide-copy strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.78rem;
  font-weight: 680;
}
.current-slide-copy span {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.67rem;
}
.slide-position {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.screen-overrides {
  display: grid;
  flex: none;
  gap: 4px;
}
.screen-override-button {
  justify-content: flex-start;
  width: 100%;
  flex: none;
  padding-inline-end: 6px;
  font-size: 0.67rem;
  letter-spacing: 0;
  text-transform: none;
}
.screen-override-button :deep(.v-btn__content) {
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
  gap: 10px;
}
.screen-override-button kbd {
  min-width: 20px;
  height: 20px;
  margin-left: auto;
  font-size: 0.6rem;
}
@media (max-width: 1250px) {
  .live-footer {
    grid-template-columns: minmax(190px, 0.9fr) minmax(330px, 1.2fr) minmax(190px, 0.9fr);
    gap: 8px;
    padding-right: 10px;
    padding-left: 10px;
  }
  .transport-destination > kbd,
  .slide-position {
    display: none;
  }
  .transport-destination--previous {
    grid-template-columns: 28px minmax(0, 1fr);
  }
  .transport-destination--next {
    grid-template-columns: minmax(0, 1fr) 28px;
  }
}
@media (max-width: 1500px) {
  .workspace-layout {
    grid-template-columns: 280px minmax(390px, 1fr) 320px;
  }
  .editor-hint {
    display: none;
  }
}
/* Add-to-Service dialog: one fixed size regardless of which type is selected — a long song
   library, several sermon passages, or the outline editor could otherwise each drive the card
   to a different (and sometimes viewport-exceeding) height. An explicit height (via the v-card
   height prop, see the template comment above) + flex column here, with only the content area
   scrolling internally, keeps title/type-select/Cancel fixed and always visible no matter what's
   selected. */
.add-service-card {
  display: flex;
  flex-direction: column;
}
:deep(.v-card-title),
:deep(.v-card-actions) {
  flex-shrink: 0;
}
:deep(.v-card-text) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
