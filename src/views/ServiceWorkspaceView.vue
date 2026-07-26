<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useUndoStore } from '@/stores/undo'
import { flattenService, type FlatSlide } from '@/utils/flattenService'
import { colorForBlockLabel, colorForItemType } from '@/utils/contentColors'
import { formatReference, getBookNames, getChapterCount, getVerseCount, isValidReference, parseReference } from '@/utils/scriptureReference'
import type { Service, ServiceItem } from '@/models/service'
import type { Song, SongBlock } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'
import type { ScripturePassage, ScriptureTranslation, LiveSlideContent } from '@/adapters/types'
import type { ScriptureReference } from '@/models/scripture'

const route = useRoute()
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const { isPresenting } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()

const service = ref<Service>()
const selectedItemIndex = ref(0)
/** -1 = nothing live yet; equal to flatSlides.length = live but past the last slide (blank). */
const flatIndex = ref(-1)

const addDialogOpen = ref(false)
const addQuery = ref('')

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
    scriptureErrors.set(item.id, e instanceof Error ? e.message : 'Failed to resolve passage.')
  }
}

onMounted(async () => {
  if (!songsStore.loaded) await songsStore.load()
  if (!slidesStore.loaded) await slidesStore.load()
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
  watch(service, () => (isDirty.value = true), { deep: true })
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveService
  // Keeps undo toasts from covering the live-transport footer's Previous/Next buttons,
  // which need to stay clickable even while a toast is showing during a live service.
  undoStore.bottomOffsetPx = 70

  // Scripture resolution isn't wired to a real command on the native Tauri backend yet
  // (README's adapter-status note) — best-effort and last, so a rejected invoke() here can
  // never take down the wiring above it and silently break Save for every service.
  try {
    scriptureTranslations.value = await getAdapter().scripture.listTranslations()
    if (scriptureTranslations.value.length > 0) scriptureTranslationCode.value = scriptureTranslations.value[0].code
    await Promise.all((service.value?.items ?? []).map(resolveScriptureItem))
  } catch (e) {
    console.error('Failed to load scripture translations/passages:', e)
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  // Safety net: the router guard (router/index.ts) is what normally prevents leaving while
  // presenting, but if this view ever unmounts some other way, don't leave the app
  // permanently believing a torn-down workspace is still live — or a presentation window
  // open with nothing left able to close it.
  if (isPresenting.value) getAdapter().live.stopPresenting()
  isPresenting.value = false
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
const flatSlides = computed<FlatSlide[]>(() =>
  service.value ? flattenService(service.value, songsById.value, scriptureById, slidesById.value) : [],
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
const selectedScripturePassage = computed<ScripturePassage | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'scripture' ? scriptureById.get(item.id) : undefined
})
const selectedScriptureText = computed(() =>
  selectedScripturePassage.value ? selectedScripturePassage.value.verses.map((v) => `${v.number} ${v.text}`).join('\n') : '',
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
  return item.type
}

function itemColor(item: ServiceItem): string {
  return colorForItemType(item.type)
}

function removeServiceItem(index: number) {
  if (!service.value) return
  const [removed] = service.value.items.splice(index, 1)
  if (!removed) return
  const label = itemLabel(removed)
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
function removeFromArrangement(index: number) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  const blockId = item.arrangement.sequence[index]
  const label = blockLabelFor(blockId)
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
function next() {
  flatIndex.value = nextIndex.value
}
function previous() {
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
}

const liveSlide = computed(() =>
  flatIndex.value >= 0 && flatIndex.value < flatSlides.value.length ? flatSlides.value[flatIndex.value] : undefined,
)
const liveContentPayload = computed<LiveSlideContent | undefined>(() =>
  liveSlide.value
    ? { itemLabel: liveSlide.value.itemLabel, subLabel: liveSlide.value.subLabel, text: liveSlide.value.text }
    : undefined,
)
watch(liveContentPayload, (content) => {
  if (isPresenting.value) getAdapter().live.setLiveContent(content)
})
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
// reference builder rather than a browsable list, since scripture isn't a library), and
// Slides (pick from the library, or quick-create service-only text slides). The full
// unified fuzzy search across songs/scripture/slides/media is a later slice.
const addTab = ref<'songs' | 'scripture' | 'slides'>('songs')

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
    if (token === scripturePreviewToken) scripturePreviewError.value = e instanceof Error ? e.message : 'Failed to load passage.'
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
function removeNewTextSlideBlock(index: number) {
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
      <div class="d-flex flex-column" style="line-height: 1.2">
        <span class="text-body-2 font-weight-bold">{{ service.type }} — {{ service.date }}</span>
        <span class="text-caption text-medium-emphasis">{{ service.sermonTitle }}</span>
      </div>
      <v-btn :color="isPresenting ? 'error' : 'primary'" variant="flat" @click="togglePresenting">
        <v-icon :icon="isPresenting ? 'mdi-stop' : 'mdi-play'" start />
        {{ isPresenting ? 'Stop Presenting' : 'Start Presenting' }}
      </v-btn>
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
              <div v-else-if="selectedScripturePassage" class="text-body-2">{{ selectedScriptureText }}</div>
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
    </div>

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

    <v-dialog v-model="addDialogOpen" max-width="560">
      <v-card>
        <v-card-title>Add to Service</v-card-title>
        <v-tabs v-model="addTab" density="compact" class="border-b">
          <v-tab value="songs">Songs</v-tab>
          <v-tab value="scripture">Scripture</v-tab>
          <v-tab value="slides">Slides</v-tab>
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
  grid-template-columns: 260px 1fr;
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
</style>
