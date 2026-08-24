<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import Moveable from 'vue3-moveable'
import SlideSceneRenderer from '@/components/slides/SlideSceneRenderer.vue'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import CanvaImportDialog from '@/components/canva/CanvaImportDialog.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import EditorNotFoundState from '@/components/EditorNotFoundState.vue'
import { getAdapter } from '@/adapters'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { useSlidesStore } from '@/stores/slides'
import { useMediaStore } from '@/stores/media'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { createBlankScene, createCountdownElement, createTextElement } from '@/utils/slideScene'
import { bundledPresentationFonts } from '@/utils/presentationFonts'
import type {
  LibrarySlide,
  SlideCountdownElement,
  SlideImageElement,
  SlideLibraryItem,
  SlideQrElement,
  SlideShapeElement,
  SlideTextElement,
} from '@/models/library'
import type { CanvaImportResult } from '@/adapters/types'

const route = useRoute()
const router = useRouter()
const store = useSlidesStore()
const mediaStore = useMediaStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()
const item = ref<SlideLibraryItem>()
const editorLoading = ref(true)
const editorLoadError = ref('')
const notFound = ref(false)
const documentHistory = useDocumentHistory(item, 'presentation')
const selectedSlideId = ref('')

// Below Vuetify's mdAndDown (1280px) — same breakpoint ServiceWorkspaceView.vue's preview panel
// already uses — the filmstrip and properties columns become toggleable overlay drawers instead
// of permanent grid columns, so the canvas (what you're actually editing) can take the space
// instead. A single ref gives the two mutual exclusivity for free, same pattern as
// ServiceWorkspaceView's own openDrawer.
const { mdAndDown: isEditorCompact } = useDisplay()
type EditorDrawer = 'filmstrip' | 'properties'
const openDrawer = ref<EditorDrawer | null>(null)
function toggleEditorDrawer(drawer: EditorDrawer) {
  openDrawer.value = openDrawer.value === drawer ? null : drawer
}
// Window widened back past the threshold (resize, rotation) — don't leave a drawer stuck open
// once it's no longer a drawer at all.
watch(isEditorCompact, (compact) => {
  if (!compact) openDrawer.value = null
})
// Picking a different slide from the filmstrip drawer means "show me that slide" — close it so
// the canvas is actually visible, same as ServiceWorkspaceView closing its order-list drawer
// once an item's selected. The properties drawer has no equivalent: it's an active editing
// surface you keep coming back to, not a one-shot picker.
watch(selectedSlideId, () => {
  if (openDrawer.value === 'filmstrip') openDrawer.value = null
})
function onEditorDrawerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openDrawer.value) openDrawer.value = null
}
onMounted(() => window.addEventListener('keydown', onEditorDrawerKeydown))
onUnmounted(() => window.removeEventListener('keydown', onEditorDrawerKeydown))

const selectedElementId = ref('')
const editingElementId = ref('')
const showSafeArea = ref(true)
const mediaDialog = ref(false)
const mediaPickerIntent = ref<'add' | 'replace' | 'background'>('add')
const mediaReplacementElementId = ref<string>()
const canvasHost = ref<HTMLElement>()
const moveableTarget = ref<HTMLElement>()
const moveableRef = ref<{ updateRect: () => void }>()
const shiftPressed = ref(false)
// Only used to gate the "Edit in Canva"/"Refresh from Canva" toolbar shortcuts below — the full
// connect/list/import flow lives entirely inside CanvaImportDialog now.
const canvaConfigured = ref(false)
const canvaDialog = ref(false)
const canvaInitialDesignId = ref<string>()

function blankItem(): SlideLibraryItem {
  const slide = blankSlide(1)
  return {
    id: `slide-${crypto.randomUUID()}`,
    label: 'New Presentation',
    tags: [],
    documentVersion: 2,
    slides: [slide],
    usage: {},
    updatedAt: '',
    updatedByDevice: '',
  }
}

function blankSlide(number: number): LibrarySlide {
  return {
    id: `slide-part-${crypto.randomUUID()}`,
    label: `Slide ${number}`,
    scene: createBlankScene(),
    source: { type: 'native' },
  }
}

const selectedSlide = computed(() =>
  item.value?.slides.find((slide) => slide.id === selectedSlideId.value),
)
const scene = computed(() => selectedSlide.value?.scene)
const selectedElement = computed(() =>
  scene.value?.elements.find((element) => element.id === selectedElementId.value),
)
const textElement = computed(() =>
  selectedElement.value?.type === 'text' ? selectedElement.value : undefined,
)
const imageElement = computed(() =>
  selectedElement.value?.type === 'image' ? selectedElement.value : undefined,
)
const shapeElement = computed(() =>
  selectedElement.value?.type === 'shape' ? selectedElement.value : undefined,
)
const qrElement = computed(() =>
  selectedElement.value?.type === 'qr' ? selectedElement.value : undefined,
)
const countdownElement = computed(() =>
  selectedElement.value?.type === 'countdown' ? selectedElement.value : undefined,
)
const backgroundPositionX = computed({
  get: () => Math.round((scene.value?.background.focalPoint?.x ?? 0.5) * 100),
  set: (value: number) => updateBackgroundFocalPoint(value / 100, undefined),
})
const backgroundPositionY = computed({
  get: () => Math.round((scene.value?.background.focalPoint?.y ?? 0.5) * 100),
  set: (value: number) => updateBackgroundFocalPoint(undefined, value / 100),
})

function updateBackgroundFocalPoint(x?: number, y?: number) {
  if (!scene.value) return
  const current = scene.value.background.focalPoint ?? { x: 0.5, y: 0.5 }
  scene.value.background.focalPoint = {
    x: Math.min(1, Math.max(0, x ?? current.x)),
    y: Math.min(1, Math.max(0, y ?? current.y)),
  }
}

function centerBackground() {
  updateBackgroundFocalPoint(0.5, 0.5)
}

// Default auto-advance/looping timer for this library item, applied whenever it's added to a
// service unless overridden there (PropertyInspector.vue) — see
// notes/slide-auto-advance-plan.md. `loop` is independent of enabling a default at all: a
// slideshow meant to play through once just as easily wants a default as one meant to loop.
const DEFAULT_AUTO_ADVANCE_INTERVAL_SECONDS = 8

function updateAutoAdvanceEnabled(enabled: boolean | null) {
  if (!item.value) return
  item.value.autoAdvance = enabled
    ? {
        intervalSeconds:
          item.value.autoAdvance?.intervalSeconds ?? DEFAULT_AUTO_ADVANCE_INTERVAL_SECONDS,
        loop: item.value.autoAdvance?.loop ?? false,
      }
    : undefined
}
function updateAutoAdvanceInterval(value: string) {
  if (!item.value?.autoAdvance) return
  const seconds = Number(value)
  item.value.autoAdvance.intervalSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 1
}
function updateAutoAdvanceLoop(value: boolean | null) {
  if (!item.value?.autoAdvance) return
  item.value.autoAdvance.loop = !!value
}
const shapeStrokeColor = computed({
  get: () => shapeElement.value?.stroke?.color ?? shapeElement.value?.fill ?? '#ffffff',
  set: (color: string) => {
    if (!shapeElement.value) return
    shapeElement.value.stroke = { color, width: shapeElement.value.stroke?.width ?? 4 }
  },
})
const shapeStrokeWidth = computed({
  get: () => shapeElement.value?.stroke?.width ?? 4,
  set: (width: number) => {
    if (!shapeElement.value) return
    shapeElement.value.stroke = {
      color: shapeElement.value.stroke?.color ?? shapeElement.value.fill,
      width,
    }
  },
})
const lockAspectRatio = computed({
  get: () => selectedElement.value?.lockAspectRatio ?? selectedElement.value?.type === 'image',
  set: (locked: boolean) => {
    if (selectedElement.value) selectedElement.value.lockAspectRatio = locked
  },
})
const textEffectType = computed({
  get: () => textElement.value?.style.effect?.type ?? 'none',
  set: (type: 'none' | 'outline' | 'shadow' | 'glow') => {
    if (!textElement.value) return
    textElement.value.style.effect = {
      type,
      color: textElement.value.style.effect?.color ?? '#000000',
      size: textElement.value.style.effect?.size ?? 4,
      offsetX: textElement.value.style.effect?.offsetX ?? 6,
      offsetY: textElement.value.style.effect?.offsetY ?? 6,
    }
  },
})
const textEffectColor = computed({
  get: () => textElement.value?.style.effect?.color ?? '#000000',
  set: (color: string) => {
    if (textElement.value?.style.effect) textElement.value.style.effect.color = color
  },
})
const textEffectSize = computed({
  get: () => textElement.value?.style.effect?.size ?? 4,
  set: (size: number) => {
    if (textElement.value?.style.effect) textElement.value.style.effect.size = size
  },
})
const keepRatio = computed(() => lockAspectRatio.value || shiftPressed.value)
const elementGuidelines = computed(() =>
  scene.value && canvasHost.value
    ? scene.value.elements
        .filter((element) => element.id !== selectedElementId.value)
        .map((element) =>
          canvasHost.value?.querySelector<HTMLElement>(
            `[data-scene-element-id="${CSS.escape(element.id)}"]`,
          ),
        )
        .filter((element): element is HTMLElement => !!element)
    : [],
)
const horizontalGuidelines = computed(() =>
  canvasHost.value ? [canvasHost.value.clientHeight / 2] : [],
)
const verticalGuidelines = computed(() =>
  canvasHost.value ? [canvasHost.value.clientWidth / 2] : [],
)

watch(
  [selectedElementId, selectedSlideId],
  async () => {
    await nextTick()
    moveableTarget.value = selectedElementId.value
      ? (canvasHost.value?.querySelector<HTMLElement>(
          `[data-scene-element-id="${CSS.escape(selectedElementId.value)}"]`,
        ) ?? undefined)
      : undefined
  },
  { flush: 'post' },
)
watch(
  () => confirmDialog.isOpen,
  (isOpen) => {
    if (isOpen) clearSelectedElement()
  },
  { flush: 'sync' },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  void loadEditor()
})

async function loadEditor() {
  documentHistory.stop()
  editorLoading.value = true
  editorLoadError.value = ''
  notFound.value = false
  const isNew = route.params.id === 'new'
  try {
    const loadedItem = isNew
      ? blankItem()
      : await getAdapter().slides.get(route.params.id as string)
    if (!loadedItem) {
      item.value = undefined
      notFound.value = true
      return
    }
    item.value = loadedItem
    item.value.tags ??= []
    for (const slide of item.value.slides) {
      for (const element of slide.scene.elements) {
        element.rotation = normalizeRotation(element.rotation)
      }
    }
    selectedSlideId.value = item.value.slides[0]?.id ?? ''
    if (!(await mediaStore.load())) {
      editorLoadError.value = mediaStore.loadError
      item.value = undefined
      return
    }
    const canva = getAdapter().canva
    if (canva) canvaConfigured.value = (await canva.status()).configured
    isDirty.value = isNew
    documentHistory.start((dirty) => (isDirty.value = dirty), isNew)
    saveHandler.value = saveItem
  } catch (error) {
    item.value = undefined
    editorLoadError.value = errorMessage(error)
  } finally {
    editorLoading.value = false
  }
}

onUnmounted(() => {
  documentHistory.stop()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveItem() {
  if (!item.value || saving.value) return
  clearSelectedElement()
  saving.value = true
  try {
    await store.save(item.value)
    isDirty.value = false
    if (route.params.id === 'new') await router.replace(`/library/slides/${item.value.id}`)
  } finally {
    saving.value = false
  }
}

function addSlide() {
  if (!item.value) return
  const slide = blankSlide(item.value.slides.length + 1)
  item.value.slides.push(slide)
  selectedSlideId.value = slide.id
  selectedElementId.value = ''
}

function openCanvaDialog() {
  clearSelectedElement()
  canvaInitialDesignId.value = undefined
  canvaDialog.value = true
}

// The full design-list/page-picker/connect flow lives in CanvaImportDialog now — this just
// builds/updates this presentation's LibrarySlides from whatever pages it hands back.
function handleCanvaImported(result: CanvaImportResult) {
  if (!item.value) return
  const designId = result.design.id
  const existingByPage = new Map<number, LibrarySlide>()
  for (const slide of item.value.slides) {
    if (slide.source.type === 'canva' && slide.source.designId === designId) {
      existingByPage.set(slide.source.pageNumber, slide)
    }
  }
  const importedAt = new Date().toISOString()
  const slides: LibrarySlide[] = result.pages.map(({ pageNumber, media }) => {
    const existing = existingByPage.get(pageNumber)
    if (existing?.source.type === 'canva') {
      return {
        ...existing,
        label: `${result.design.title} — ${pageNumber}`,
        scene: {
          ...existing.scene,
          background: { ...existing.scene.background, mediaId: media.id },
        },
        source: {
          ...existing.source,
          renderedMediaId: media.id,
          lastImportedAt: importedAt,
        },
      }
    }
    return {
      id: `slide-part-${crypto.randomUUID()}`,
      label: `${result.design.title} — ${pageNumber}`,
      scene: {
        ...createBlankScene(),
        background: {
          color: '#000000',
          mediaId: media.id,
          fit: 'cover',
          focalPoint: { x: 0.5, y: 0.5 },
        },
      },
      source: {
        type: 'canva',
        designId,
        pageNumber,
        renderedMediaId: media.id,
        lastImportedAt: importedAt,
      },
    }
  })
  // Fewer pages than before (some unchecked in the picker) is handled the same way as before:
  // every existing slide for this design is removed first, then only the (possibly filtered)
  // returned pages are spliced back in.
  const existingIndexes = item.value.slides
    .map((slide, index) =>
      slide.source.type === 'canva' && slide.source.designId === designId ? index : -1,
    )
    .filter((index) => index >= 0)
  const insertAt =
    existingIndexes[0] ??
    item.value.slides.findIndex((slide) => slide.id === selectedSlideId.value) + 1
  item.value.slides = item.value.slides.filter(
    (slide) => !(slide.source.type === 'canva' && slide.source.designId === designId),
  )
  item.value.slides.splice(Math.max(0, insertAt), 0, ...slides)
  if (!slides.some((slide) => slide.id === selectedSlideId.value)) {
    selectedSlideId.value = slides[0]?.id ?? selectedSlideId.value
  }
  void mediaStore.load()
}

async function openSelectedCanvaDesign() {
  if (selectedSlide.value?.source.type !== 'canva') return
  const canva = getAdapter().canva
  if (!canva) return
  await canva.openDesign(selectedSlide.value.source.designId)
}

function refreshSelectedCanvaDesign() {
  if (selectedSlide.value?.source.type !== 'canva') return
  canvaInitialDesignId.value = selectedSlide.value.source.designId
  canvaDialog.value = true
}

function selectSlide(id: string) {
  selectedSlideId.value = id
  selectedElementId.value = ''
  editingElementId.value = ''
}

function selectElement(id: string) {
  selectedElementId.value = id
  if (editingElementId.value !== id) editingElementId.value = ''
}

function clearSelectedElement() {
  selectedElementId.value = ''
  editingElementId.value = ''
  moveableTarget.value = undefined
}

function editElement(id: string) {
  const element = scene.value?.elements.find((candidate) => candidate.id === id)
  if (element?.type !== 'text') return
  selectedElementId.value = id
  editingElementId.value = id
}

function updateElementText(id: string, text: string) {
  const element = scene.value?.elements.find((candidate) => candidate.id === id)
  if (element?.type === 'text') element.text = text
}

async function removeSlide(slide: LibrarySlide) {
  if (!item.value || item.value.slides.length === 1) return
  clearSelectedElement()
  if (!(await confirmDialog.confirm(`Remove "${slide.label}"?`, 'Remove'))) return
  const index = item.value.slides.indexOf(slide)
  item.value.slides.splice(index, 1)
  selectedSlideId.value = item.value.slides[Math.max(0, index - 1)]?.id ?? ''
  selectedElementId.value = ''
}

function addText() {
  const element = createTextElement()
  scene.value?.elements.push(element)
  selectedElementId.value = element.id
}

const shapeOptions: Array<{ title: string; value: SlideShapeElement['shape']; icon: string }> = [
  { title: 'Rectangle', value: 'rectangle', icon: 'mdi-rectangle-outline' },
  { title: 'Ellipse', value: 'ellipse', icon: 'mdi-ellipse-outline' },
  { title: 'Line', value: 'line', icon: 'mdi-minus' },
  { title: 'Triangle', value: 'triangle', icon: 'mdi-triangle-outline' },
]

function addShape(kind: SlideShapeElement['shape']) {
  const isLinear = kind === 'line'
  const shape: SlideShapeElement = {
    id: `element-${crypto.randomUUID()}`,
    type: 'shape',
    name: shapeOptions.find((option) => option.value === kind)?.title ?? 'Shape',
    shape: kind,
    x: 660,
    y: isLinear ? 515 : 390,
    width: 600,
    height: isLinear ? 50 : 300,
    rotation: 0,
    opacity: 1,
    fill: '#1976d2',
    fillMode: 'solid',
    stroke: { color: '#1976d2', width: 4 },
    cornerRadius: 0,
  }
  scene.value?.elements.push(shape)
  selectedElementId.value = shape.id
}

function addImage(mediaId: string) {
  const image: SlideImageElement = {
    id: `element-${crypto.randomUUID()}`,
    type: 'image',
    name: mediaStore.items.find((m) => m.id === mediaId)?.title ?? 'Image',
    mediaId,
    x: 480,
    y: 210,
    width: 960,
    height: 660,
    rotation: 0,
    opacity: 1,
    lockAspectRatio: true,
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0.5 },
  }
  scene.value?.elements.push(image)
  selectedElementId.value = image.id
  mediaDialog.value = false
}

function addQr() {
  const qr: SlideQrElement = {
    id: `element-${crypto.randomUUID()}`,
    type: 'qr',
    name: 'QR Code',
    x: 660,
    y: 300,
    width: 480,
    height: 480,
    rotation: 0,
    opacity: 1,
    lockAspectRatio: true,
    content: { kind: 'url', url: '' },
  }
  scene.value?.elements.push(qr)
  selectedElementId.value = qr.id
}

// Reconstructs `content` from scratch on kind switch rather than patching in place — url and
// wifi fields don't overlap, so half-updating would leave stale fields from the other kind.
function setQrKind(kind: 'url' | 'wifi') {
  if (!qrElement.value) return
  qrElement.value.content =
    kind === 'url' ? { kind: 'url', url: '' } : { kind: 'wifi', ssid: '', encryption: 'WPA' }
}

function addCountdown() {
  const countdown = createCountdownElement()
  scene.value?.elements.push(countdown)
  selectedElementId.value = countdown.id
}

function setCountdownMode(mode: SlideCountdownElement['mode']) {
  if (countdownElement.value) countdownElement.value.mode = mode
}

// <input type="datetime-local"> has no timezone of its own (interpreted as local time by
// `new Date(...)` either direction) — converts to/from the ISO string actually stored on the
// element, same round trip the old Countdown service item's Add dialog used.
const countdownTargetTimeLocal = computed<string>({
  get: () => {
    const iso = countdownElement.value?.targetTime
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  },
  set: (value: string) => {
    if (!countdownElement.value) return
    countdownElement.value.targetTime = value ? new Date(value).toISOString() : undefined
  },
})

function setAsBackground(mediaId?: string) {
  if (!scene.value) return
  scene.value.background.mediaId = mediaId
  scene.value.background.fit = 'cover'
  scene.value.background.focalPoint = { x: 0.5, y: 0.5 }
  mediaDialog.value = false
}

function openMediaPicker(intent: 'add' | 'replace' | 'background') {
  mediaPickerIntent.value = intent
  mediaReplacementElementId.value = intent === 'replace' ? imageElement.value?.id : undefined
  clearSelectedElement()
  mediaDialog.value = true
}

function onMediaPicked(mediaId: string, placement: 'element' | 'background') {
  if (placement === 'background' || mediaPickerIntent.value === 'background') {
    setAsBackground(mediaId)
  } else if (mediaPickerIntent.value === 'replace' && mediaReplacementElementId.value) {
    const image = scene.value?.elements.find(
      (element) => element.id === mediaReplacementElementId.value && element.type === 'image',
    )
    if (image?.type === 'image') image.mediaId = mediaId
  } else {
    addImage(mediaId)
  }
  mediaReplacementElementId.value = undefined
  mediaDialog.value = false
}

function deleteElement() {
  if (!scene.value || !selectedElement.value) return
  const index = scene.value.elements.indexOf(selectedElement.value)
  scene.value.elements.splice(index, 1)
  selectedElementId.value = ''
}

function moveLayer(to: 'front' | 'forward' | 'backward' | 'back') {
  if (!scene.value || !selectedElement.value) return
  const elements = scene.value.elements
  const from = elements.indexOf(selectedElement.value)
  const target =
    to === 'front'
      ? elements.length - 1
      : to === 'back'
        ? 0
        : to === 'forward'
          ? Math.min(elements.length - 1, from + 1)
          : Math.max(0, from - 1)
  if (target === from) return
  elements.splice(target, 0, elements.splice(from, 1)[0])
}

function onKeydown(event: KeyboardEvent) {
  shiftPressed.value = event.shiftKey
  const target = event.target as HTMLElement
  if (event.key === 'Escape' && editingElementId.value) {
    editingElementId.value = ''
    target.blur()
    return
  }
  if (target.matches('input, textarea, [contenteditable="true"]')) return
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement.value) {
    event.preventDefault()
    deleteElement()
  }
  const delta = event.shiftKey ? 10 : 1
  if (
    selectedElement.value &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault()
    if (event.key === 'ArrowLeft') selectedElement.value.x -= delta
    if (event.key === 'ArrowRight') selectedElement.value.x += delta
    if (event.key === 'ArrowUp') selectedElement.value.y -= delta
    if (event.key === 'ArrowDown') selectedElement.value.y += delta
  }
}
function onKeyup(event: KeyboardEvent) {
  shiftPressed.value = event.shiftKey
}

function sceneScale(): number {
  return canvasHost.value && scene.value
    ? scene.value.width / canvasHost.value.getBoundingClientRect().width
    : 1
}

let transformStart = { x: 0, y: 0 }
let pendingGeometry: { x: number; y: number; width?: number; height?: number } | undefined
function onMoveableDragStart() {
  if (!selectedElement.value) return
  transformStart = { x: selectedElement.value.x, y: selectedElement.value.y }
  pendingGeometry = { ...transformStart }
}
function onMoveableDrag(event: {
  beforeTranslate: number[]
  transform: string
  target: HTMLElement | SVGElement
}) {
  const scale = sceneScale()
  pendingGeometry = {
    x: Math.round(transformStart.x + (event.beforeTranslate[0] ?? 0) * scale),
    y: Math.round(transformStart.y + (event.beforeTranslate[1] ?? 0) * scale),
  }
  event.target.style.transform = event.transform
}
function commitMoveableGeometry(event: { target: HTMLElement | SVGElement }) {
  if (!selectedElement.value || !pendingGeometry) return
  const resized = pendingGeometry.width !== undefined
  selectedElement.value.x = pendingGeometry.x
  selectedElement.value.y = pendingGeometry.y
  if (pendingGeometry.width !== undefined) selectedElement.value.width = pendingGeometry.width
  if (pendingGeometry.height !== undefined) selectedElement.value.height = pendingGeometry.height
  pendingGeometry = undefined
  if (resized) {
    event.target.style.width = ''
    event.target.style.height = ''
  }
  event.target.style.transform = `rotate(${selectedElement.value.rotation}deg)`
  nextTick(() => moveableRef.value?.updateRect())
}

function onMoveableResizeStart() {
  if (!selectedElement.value) return
  transformStart = { x: selectedElement.value.x, y: selectedElement.value.y }
  pendingGeometry = {
    ...transformStart,
    width: selectedElement.value.width,
    height: selectedElement.value.height,
  }
}
function onMoveableResize(event: {
  width: number
  height: number
  drag: { beforeTranslate: number[]; transform: string }
  target: HTMLElement | SVGElement
}) {
  const scale = sceneScale()
  pendingGeometry = {
    x: Math.round(transformStart.x + (event.drag.beforeTranslate[0] ?? 0) * scale),
    y: Math.round(transformStart.y + (event.drag.beforeTranslate[1] ?? 0) * scale),
    width: Math.max(40, Math.round(event.width * scale)),
    height: Math.max(40, Math.round(event.height * scale)),
  }
  event.target.style.width = `${event.width}px`
  event.target.style.height = `${event.height}px`
  event.target.style.transform = event.drag.transform
}

function onMoveableRotate(event: { rotation: number }) {
  if (selectedElement.value) selectedElement.value.rotation = normalizeRotation(event.rotation)
}

function normalizeRotation(rotation: number) {
  const normalized = rotation % 360
  const rounded = Math.round(normalized * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

function updateNumber(
  key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity',
  value: unknown,
) {
  if (!selectedElement.value || typeof value !== 'number') return
  selectedElement.value[key] = key === 'rotation' ? normalizeRotation(value) : value
}
function updateTextStyle<K extends keyof SlideTextElement['style']>(
  key: K,
  value: SlideTextElement['style'][K],
) {
  if (textElement.value) textElement.value.style[key] = value
}
</script>

<template>
  <AsyncLoadState
    v-if="editorLoading || editorLoadError"
    :loading="editorLoading"
    :error="editorLoadError"
    label="presentation"
    @retry="loadEditor"
  />
  <EditorNotFoundState
    v-else-if="notFound"
    icon="mdi-image-off-outline"
    title="Presentation Not Found"
    message="This presentation may have been deleted or moved."
    :back-to="{ path: '/library/slides' }"
    back-label="Back to Slides"
  />
  <div
    v-else-if="item && scene"
    class="editor"
    :class="{ 'editor--compact': isEditorCompact }"
  >
    <header class="editor-header">
      <div class="editor-heading">
        <v-btn to="/library/slides" variant="text" prepend-icon="mdi-arrow-left" class="back-button"
          >Slides</v-btn
        >
        <div>
          <div class="editor-eyebrow">Slide Editor</div>
          <h1>{{ item.label || 'Untitled Presentation' }}</h1>
        </div>
      </div>
      <div class="editor-summary">
        <template v-if="isEditorCompact">
          <v-btn
            icon="mdi-filmstrip"
            variant="text"
            size="small"
            :color="openDrawer === 'filmstrip' ? 'primary' : undefined"
            :title="openDrawer === 'filmstrip' ? 'Close slides panel' : 'Open slides panel'"
            :aria-label="openDrawer === 'filmstrip' ? 'Close slides panel' : 'Open slides panel'"
            @click="toggleEditorDrawer('filmstrip')"
          />
          <v-btn
            icon="mdi-tune-variant"
            variant="text"
            size="small"
            :color="openDrawer === 'properties' ? 'primary' : undefined"
            :title="openDrawer === 'properties' ? 'Close properties panel' : 'Open properties panel'"
            :aria-label="
              openDrawer === 'properties' ? 'Close properties panel' : 'Open properties panel'
            "
            @click="toggleEditorDrawer('properties')"
          />
        </template>
        <span
          ><v-icon icon="mdi-view-carousel-outline" size="17" />{{ item.slides.length }}
          {{ item.slides.length === 1 ? 'Slide' : 'Slides' }}</span
        >
        <span
          ><v-icon icon="mdi-history" size="17" />{{
            item.usage.lastUsedDate ? `Last Used ${item.usage.lastUsedDate}` : 'Not Yet Used'
          }}</span
        >
      </div>
    </header>

    <aside
      class="filmstrip"
      :class="{ 'drawer-open': isEditorCompact && openDrawer === 'filmstrip' }"
    >
      <div class="presentation-details">
        <div class="panel-heading">Presentation Details</div>
        <v-text-field
          v-model="item.label"
          label="Presentation Title"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-combobox
          v-model="item.tags"
          label="Tags"
          variant="outlined"
          density="compact"
          multiple
          chips
          closable-chips
          hide-details
        />
      </div>

      <div v-if="item.slides.length > 1" class="presentation-details">
        <div class="panel-heading">Auto-Advance</div>
        <v-switch
          :model-value="!!item.autoAdvance"
          label="Enabled"
          color="primary"
          density="compact"
          hide-details
          @update:model-value="updateAutoAdvanceEnabled"
        />
        <div v-if="item.autoAdvance" class="auto-advance-row">
          <v-text-field
            :model-value="item.autoAdvance.intervalSeconds"
            label="Interval"
            type="number"
            min="1"
            max="99"
            suffix="sec"
            variant="outlined"
            density="compact"
            hide-details
            class="interval-field"
            @update:model-value="updateAutoAdvanceInterval"
          />
          <v-switch
            :model-value="item.autoAdvance.loop"
            label="Loop"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="updateAutoAdvanceLoop"
          />
        </div>
      </div>

      <div class="filmstrip-heading">
        <span>Slides</span>
        <strong>{{ item.slides.length }}</strong>
      </div>
      <VueDraggable
        v-model="item.slides"
        handle=".slide-grip"
        :animation="150"
        class="thumbnail-list"
      >
        <div
          v-for="(slide, index) in item.slides"
          :key="slide.id"
          class="thumbnail-row"
          :class="{ active: slide.id === selectedSlideId }"
          @click="selectSlide(slide.id)"
        >
          <span class="slide-grip"
            ><v-icon icon="mdi-drag-vertical" size="17" />{{ index + 1 }}</span
          >
          <div class="thumbnail"><SlideSceneRenderer :scene="slide.scene" /></div>
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            :disabled="item.slides.length === 1"
            @click.stop="removeSlide(slide)"
          />
        </div>
      </VueDraggable>
      <v-btn
        prepend-icon="mdi-plus"
        variant="tonal"
        color="primary"
        class="add-slide-button"
        @click="addSlide"
        >Add Slide</v-btn
      >
    </aside>

    <main class="workspace">
      <v-alert
        v-if="store.mutationError"
        type="error"
        variant="tonal"
        density="compact"
        closable
        class="editor-save-alert"
        @click:close="store.clearMutationError"
      >
        Presentation changes were not saved: {{ store.mutationError }}
      </v-alert>
      <div class="toolbar">
        <div class="toolbar-group add-group add-group--full">
          <v-btn prepend-icon="mdi-format-text" variant="tonal" @click="addText">Text</v-btn>
          <v-btn prepend-icon="mdi-image-outline" variant="tonal" @click="openMediaPicker('add')"
            >Image</v-btn
          >
          <v-menu>
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                prepend-icon="mdi-shape-outline"
                append-icon="mdi-menu-down"
                variant="tonal"
                >Shape</v-btn
              >
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="option in shapeOptions"
                :key="option.value"
                :title="option.title"
                :prepend-icon="option.icon"
                @click="addShape(option.value)"
              />
            </v-list>
          </v-menu>
          <v-btn prepend-icon="mdi-qrcode" variant="tonal" @click="addQr">QR Code</v-btn>
          <v-btn prepend-icon="mdi-timer-outline" variant="tonal" @click="addCountdown"
            >Countdown</v-btn
          >
        </div>
        <!-- Same set of actions as above, flattened into one menu (including Shape's own
             variants — only 4, not worth a nested submenu) once there's no room for five
             separate buttons. Both this and add-group--full above are always in the DOM; a
             container query (not a JS width breakpoint) picks which one actually shows — see
             the CSS. That's deliberate: the toolbar's *own* available width doesn't track the
             window width in a simple way, since the filmstrip/properties side columns eat a
             fixed ~570px only while they're still permanent grid columns (above
             isEditorCompact) and give it all back once they become drawers — a single window-
             width threshold can't represent that non-monotonic relationship, but a container
             query measuring the toolbar's actual rendered width naturally does. -->
        <div class="toolbar-group add-group add-group--compact">
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" prepend-icon="mdi-plus" append-icon="mdi-menu-down" variant="tonal">
                Add
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item title="Text" prepend-icon="mdi-format-text" @click="addText" />
              <v-list-item
                title="Image"
                prepend-icon="mdi-image-outline"
                @click="openMediaPicker('add')"
              />
              <v-list-item
                v-for="option in shapeOptions"
                :key="option.value"
                :title="option.title"
                :prepend-icon="option.icon"
                @click="addShape(option.value)"
              />
              <v-list-item title="QR Code" prepend-icon="mdi-qrcode" @click="addQr" />
              <v-list-item title="Countdown" prepend-icon="mdi-timer-outline" @click="addCountdown" />
            </v-list>
          </v-menu>
        </div>
        <div v-if="canvaConfigured" class="toolbar-group">
          <v-menu>
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                prepend-icon="mdi-palette-outline"
                append-icon="mdi-menu-down"
                variant="tonal"
              >
                Canva
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item
                title="Import"
                prepend-icon="mdi-palette-outline"
                @click="openCanvaDialog"
              />
              <v-list-item
                v-if="selectedSlide?.source.type === 'canva'"
                title="Edit"
                prepend-icon="mdi-open-in-new"
                @click="openSelectedCanvaDesign"
              />
              <v-list-item
                v-if="selectedSlide?.source.type === 'canva'"
                title="Refresh"
                prepend-icon="mdi-cloud-refresh-outline"
                @click="refreshSelectedCanvaDesign"
              />
            </v-list>
          </v-menu>
        </div>
        <div class="toolbar-group">
          <v-menu>
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                prepend-icon="mdi-arrange-bring-forward"
                append-icon="mdi-menu-down"
                variant="tonal"
                :disabled="!selectedElement"
              >
                Arrange
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item
                title="Bring Forward"
                prepend-icon="mdi-arrange-bring-forward"
                @click="moveLayer('forward')"
              />
              <v-list-item
                title="Bring to Front"
                prepend-icon="mdi-arrange-bring-to-front"
                @click="moveLayer('front')"
              />
              <v-list-item
                title="Send Backward"
                prepend-icon="mdi-arrange-send-backward"
                @click="moveLayer('backward')"
              />
              <v-list-item
                title="Send to Back"
                prepend-icon="mdi-arrange-send-to-back"
                @click="moveLayer('back')"
              />
            </v-list>
          </v-menu>
        </div>
      </div>
      <div class="canvas-scroll">
        <v-switch
          v-model="showSafeArea"
          label="Safe Area"
          hide-details
          density="compact"
          color="primary"
          class="safe-area-toggle"
        />
        <div ref="canvasHost" class="canvas-host">
          <SlideSceneRenderer
            :scene="scene"
            interactive
            :selected-id="selectedElementId"
            :editing-id="editingElementId"
            :show-safe-area="showSafeArea"
            @select="selectElement"
            @edit="editElement"
            @text-change="updateElementText"
          />
          <Moveable
            v-if="moveableTarget && selectedElement && !selectedElement.locked && !editingElementId"
            ref="moveableRef"
            :target="moveableTarget"
            :container="canvasHost"
            :draggable="true"
            :resizable="true"
            :rotatable="true"
            :keep-ratio="keepRatio"
            :snappable="true"
            :snap-center="true"
            :snap-element="true"
            :element-guidelines="elementGuidelines"
            :horizontal-guidelines="horizontalGuidelines"
            :vertical-guidelines="verticalGuidelines"
            :throttle-drag="1"
            :throttle-resize="1"
            :throttle-rotate="1"
            @drag-start="onMoveableDragStart"
            @drag="onMoveableDrag"
            @drag-end="commitMoveableGeometry"
            @resize-start="onMoveableResizeStart"
            @resize="onMoveableResize"
            @resize-end="commitMoveableGeometry"
            @rotate="onMoveableRotate"
          />
        </div>
      </div>
    </main>

    <aside
      class="properties"
      :class="{ 'drawer-open': isEditorCompact && openDrawer === 'properties' }"
    >
      <div class="inspector-heading">
        <div class="panel-heading">Properties</div>
        <h2>
          {{
            selectedElement?.name || (selectedElement ? 'Element' : selectedSlide?.label || 'Slide')
          }}
        </h2>
        <p>
          {{
            selectedElement ? 'Adjust the selected layer.' : 'Adjust this slide and its background.'
          }}
        </p>
      </div>
      <template v-if="selectedElement">
        <div class="property-section-title">Layout</div>
        <v-text-field
          v-model="selectedElement.name"
          label="Layer Name"
          density="compact"
          variant="outlined"
        />
        <div class="property-grid">
          <v-number-input
            :model-value="selectedElement.x"
            label="X"
            density="compact"
            control-variant="hidden"
            @update:model-value="updateNumber('x', $event)"
          />
          <v-number-input
            :model-value="selectedElement.y"
            label="Y"
            density="compact"
            control-variant="hidden"
            @update:model-value="updateNumber('y', $event)"
          />
          <v-number-input
            :model-value="selectedElement.width"
            label="Width"
            density="compact"
            control-variant="hidden"
            @update:model-value="updateNumber('width', $event)"
          />
          <v-number-input
            :model-value="selectedElement.height"
            label="Height"
            density="compact"
            control-variant="hidden"
            @update:model-value="updateNumber('height', $event)"
          />
          <v-number-input
            :model-value="selectedElement.rotation"
            label="Rotation (°)"
            density="compact"
            control-variant="hidden"
            :step="1"
            @update:model-value="updateNumber('rotation', $event)"
          />
        </div>
        <v-switch
          v-model="lockAspectRatio"
          label="Lock Aspect Ratio"
          density="compact"
          hide-details
        />
        <p class="text-caption text-medium-emphasis mb-3">
          You can also hold Shift while dragging the resize handle.
        </p>
        <v-slider
          v-model="selectedElement.opacity"
          label="Opacity"
          :min="0"
          :max="1"
          :step="0.05"
          thumb-label
        />
        <template v-if="textElement">
          <div class="property-section-title property-section-title--spaced">Text</div>
          <v-textarea v-model="textElement.text" label="Text" variant="outlined" rows="4" />
          <v-select
            :model-value="textElement.style.fontFamily"
            :items="bundledPresentationFonts"
            item-title="title"
            item-value="value"
            label="Font"
            density="compact"
            hint="Bundled with Worship Studio for consistent presentation on every computer."
            persistent-hint
            @update:model-value="updateTextStyle('fontFamily', String($event))"
          />
          <div class="property-grid">
            <v-number-input
              :model-value="textElement.style.fontSize"
              label="Size"
              density="compact"
              control-variant="hidden"
              :min="8"
              @update:model-value="updateTextStyle('fontSize', Number($event))"
            />
            <v-color-input v-model="textElement.style.color" label="Color" density="compact" />
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-btn-toggle v-model="textElement.style.textAlign" mandatory>
              <v-btn value="left" icon="mdi-format-align-left" />
              <v-btn value="center" icon="mdi-format-align-center" />
              <v-btn value="right" icon="mdi-format-align-right" />
            </v-btn-toggle>
            <v-btn-toggle>
              <v-btn
                icon="mdi-format-bold"
                :active="textElement.style.fontWeight >= 700"
                @click="
                  textElement.style.fontWeight = textElement.style.fontWeight >= 700 ? 400 : 700
                "
              />
              <v-btn
                icon="mdi-format-italic"
                :active="textElement.style.italic"
                @click="textElement.style.italic = !textElement.style.italic"
              />
              <v-btn
                icon="mdi-format-underline"
                :active="textElement.style.underline"
                @click="textElement.style.underline = !textElement.style.underline"
              />
            </v-btn-toggle>
          </div>
          <v-select
            v-model="textEffectType"
            :items="[
              { title: 'None', value: 'none' },
              { title: 'Outline', value: 'outline' },
              { title: 'Drop Shadow', value: 'shadow' },
              { title: 'Glow', value: 'glow' },
            ]"
            label="Text Effect"
            density="compact"
            class="mt-4"
          />
          <div v-if="textEffectType !== 'none'" class="property-grid">
            <v-color-input v-model="textEffectColor" label="Effect Color" density="compact" />
            <v-number-input
              v-model="textEffectSize"
              label="Strength"
              density="compact"
              control-variant="hidden"
              :min="1"
              :max="30"
            />
          </div>
          <div v-if="textEffectType === 'shadow' && textElement.style.effect" class="property-grid">
            <v-number-input
              v-model="textElement.style.effect.offsetX"
              label="Horizontal Offset"
              density="compact"
              control-variant="hidden"
              :min="-50"
              :max="50"
            />
            <v-number-input
              v-model="textElement.style.effect.offsetY"
              label="Vertical Offset"
              density="compact"
              control-variant="hidden"
              :min="-50"
              :max="50"
            />
          </div>
        </template>
        <template v-if="imageElement">
          <div class="property-section-title property-section-title--spaced">Image</div>
          <v-select
            v-model="imageElement.fit"
            :items="['cover', 'contain', 'fill']"
            label="Image Fit"
            density="compact"
          />
          <v-btn block variant="outlined" @click="openMediaPicker('replace')">Replace image</v-btn>
        </template>
        <template v-if="shapeElement">
          <div class="property-section-title property-section-title--spaced">Shape</div>
          <v-select
            v-model="shapeElement.shape"
            :items="shapeOptions"
            item-title="title"
            item-value="value"
            label="Shape"
            density="compact"
          />
          <v-select
            v-if="shapeElement.shape !== 'line'"
            v-model="shapeElement.fillMode"
            :items="[
              { title: 'Solid Fill', value: 'solid' },
              { title: 'Outline Only', value: 'outline' },
            ]"
            label="Style"
            density="compact"
          />
          <v-color-input
            v-if="shapeElement.fillMode !== 'outline' && shapeElement.shape !== 'line'"
            v-model="shapeElement.fill"
            label="Fill Color"
            density="compact"
          />
          <v-color-input
            v-if="shapeElement.fillMode === 'outline' || shapeElement.shape === 'line'"
            v-model="shapeStrokeColor"
            label="Line Color"
            density="compact"
          />
          <v-number-input
            v-if="shapeElement.fillMode === 'outline' || shapeElement.shape === 'line'"
            v-model="shapeStrokeWidth"
            label="Line Width"
            density="compact"
            control-variant="hidden"
            :min="1"
            :max="40"
          />
          <v-number-input
            v-if="shapeElement.shape === 'rectangle'"
            v-model="shapeElement.cornerRadius"
            label="Corner Radius"
            density="compact"
            control-variant="hidden"
            :min="0"
            :max="300"
          />
        </template>
        <template v-if="qrElement">
          <div class="property-section-title property-section-title--spaced">QR Code</div>
          <v-btn-toggle
            :model-value="qrElement.content.kind"
            mandatory
            density="compact"
            divided
            class="mb-3"
            @update:model-value="(value: 'url' | 'wifi') => setQrKind(value)"
          >
            <v-btn value="url" size="small">URL</v-btn>
            <v-btn value="wifi" size="small">WiFi</v-btn>
          </v-btn-toggle>
          <v-text-field
            v-if="qrElement.content.kind === 'url'"
            v-model="qrElement.content.url"
            label="URL"
            placeholder="https://example.com/give"
            density="compact"
            variant="outlined"
          />
          <template v-else-if="qrElement.content.kind === 'wifi'">
            <v-text-field
              v-model="qrElement.content.ssid"
              label="Network Name (SSID)"
              density="compact"
              variant="outlined"
              class="mb-2"
            />
            <v-text-field
              v-model="qrElement.content.password"
              label="Password (optional)"
              density="compact"
              variant="outlined"
              class="mb-2"
            />
            <v-select
              v-model="qrElement.content.encryption"
              :items="[
                { title: 'WPA/WPA2', value: 'WPA' },
                { title: 'WEP', value: 'WEP' },
                { title: 'None (open network)', value: 'nopass' },
              ]"
              label="Security"
              density="compact"
            />
          </template>
        </template>
        <template v-if="countdownElement">
          <div class="property-section-title property-section-title--spaced">Countdown</div>
          <v-btn-toggle
            :model-value="countdownElement.mode"
            mandatory
            density="compact"
            divided
            class="mb-3"
            @update:model-value="(value: SlideCountdownElement['mode']) => setCountdownMode(value)"
          >
            <v-btn value="service" size="small">Service Time</v-btn>
            <v-btn value="custom" size="small">Custom Time</v-btn>
            <v-btn value="days" size="small">Days Until</v-btn>
          </v-btn-toggle>
          <p
            v-if="countdownElement.mode === 'service'"
            class="text-caption text-medium-emphasis mb-3"
          >
            Counts down to whichever service this slide is presented in. Shows a placeholder here
            since this slide isn't tied to a service yet.
          </p>
          <v-text-field
            v-if="countdownElement.mode === 'custom'"
            v-model="countdownTargetTimeLocal"
            type="datetime-local"
            label="Target Date &amp; Time"
            density="compact"
            variant="outlined"
            class="mb-3"
          />
          <v-text-field
            v-if="countdownElement.mode === 'days'"
            v-model="countdownElement.targetDate"
            type="date"
            label="Target Day"
            density="compact"
            variant="outlined"
            class="mb-3"
          />
          <v-text-field
            v-model="countdownElement.label"
            label="Label (optional)"
            placeholder="e.g. Vacation Bible School"
            density="compact"
            variant="outlined"
            class="mb-3"
          />
          <v-select
            :model-value="countdownElement.style.fontFamily"
            :items="bundledPresentationFonts"
            item-title="title"
            item-value="value"
            label="Font"
            density="compact"
            hint="Bundled with Worship Studio for consistent presentation on every computer."
            persistent-hint
            @update:model-value="
              (value: string) => {
                if (countdownElement) countdownElement.style.fontFamily = value
              }
            "
          />
          <div class="property-grid">
            <v-number-input
              v-model="countdownElement.style.fontSize"
              label="Size"
              density="compact"
              control-variant="hidden"
              :min="8"
            />
            <v-color-input v-model="countdownElement.style.color" label="Color" density="compact" />
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-btn-toggle v-model="countdownElement.style.textAlign" mandatory>
              <v-btn value="left" icon="mdi-format-align-left" />
              <v-btn value="center" icon="mdi-format-align-center" />
              <v-btn value="right" icon="mdi-format-align-right" />
            </v-btn-toggle>
            <v-btn-toggle>
              <v-btn
                icon="mdi-format-bold"
                :active="countdownElement.style.fontWeight >= 700"
                @click="
                  countdownElement.style.fontWeight =
                    countdownElement.style.fontWeight >= 700 ? 400 : 700
                "
              />
            </v-btn-toggle>
          </div>
        </template>
        <v-btn
          class="mt-4"
          block
          color="error"
          variant="tonal"
          prepend-icon="mdi-delete"
          @click="deleteElement"
          >Delete Element</v-btn
        >
      </template>
      <template v-else>
        <div class="property-section-title">Slide</div>
        <v-text-field
          v-model="selectedSlide!.label"
          label="Slide Name"
          density="compact"
          variant="outlined"
        />
        <v-color-input
          v-model="scene.background.color"
          label="Background Color"
          density="compact"
        />
        <v-btn
          block
          variant="outlined"
          prepend-icon="mdi-image"
          @click="openMediaPicker('background')"
          >Choose Background</v-btn
        >
        <div v-if="scene.background.mediaId" class="background-position-controls">
          <v-select
            v-model="scene.background.fit"
            :items="[
              { title: 'Fill slide — crop as needed', value: 'cover' },
              { title: 'Fit whole image', value: 'contain' },
            ]"
            item-title="title"
            item-value="value"
            label="Background Fit"
            density="compact"
            hide-details
          />

          <div class="background-position-heading">
            <div>
              <strong>Image position</strong>
              <span v-if="scene.background.fit === 'cover'"
                >Choose which part of the cropped image stays visible.</span
              >
              <span v-else>Position the fitted image within the slide.</span>
            </div>
            <v-btn
              size="x-small"
              variant="text"
              :disabled="backgroundPositionX === 50 && backgroundPositionY === 50"
              @click="centerBackground"
            >
              Center
            </v-btn>
          </div>

          <label class="background-position-axis">
            <span><strong>Horizontal</strong><small>Left</small><small>Right</small></span>
            <v-slider
              v-model="backgroundPositionX"
              :min="0"
              :max="100"
              :step="1"
              thumb-label
              hide-details
              color="primary"
            />
          </label>
          <label class="background-position-axis">
            <span><strong>Vertical</strong><small>Top</small><small>Bottom</small></span>
            <v-slider
              v-model="backgroundPositionY"
              :min="0"
              :max="100"
              :step="1"
              thumb-label
              hide-details
              color="primary"
            />
          </label>
        </div>
        <v-btn
          v-if="scene.background.mediaId"
          block
          variant="text"
          @click="scene.background.mediaId = undefined"
          >Remove Background</v-btn
        >
      </template>
    </aside>

    <div
      v-if="isEditorCompact"
      class="drawer-backdrop"
      :class="{ 'drawer-backdrop--visible': openDrawer !== null }"
      @click="openDrawer = null"
    />

    <MediaPickerDialog v-model="mediaDialog" @select="onMediaPicked" />
    <CanvaImportDialog
      v-model="canvaDialog"
      :initial-design-id="canvaInitialDesignId"
      :default-design-title="item?.label"
      @imported="handleCanvaImported"
    />
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: 250px minmax(180px, 1fr) 320px;
  grid-template-rows: 78px minmax(0, 1fr);
  /* 100% rather than a hardcoded viewport-height offset — this renders inside <v-main
     scrollable> (App.vue), whose own inner .v-main__scroller already excludes the app-bar's
     height from its box. */
  height: 100%;
  /* The side columns are fixed width and the middle one has a real floor (see minmax above) —
     once a window gets too narrow for all three to fit, this scrolls horizontally instead of
     letting the middle column get squeezed to zero, which previously let its own content (the
     toolbar) render past its own boundary and visually overlap the Properties panel next to it. */
  overflow-x: auto;
  overflow-y: hidden;
  background: rgb(var(--v-theme-background));
}
/* Below Vuetify's mdAndDown (~1280px, matching isEditorCompact) the filmstrip and properties
   columns become toggleable overlay drawers instead of permanent grid columns, so the canvas
   (what's actually being edited) gets the full width — same pattern as
   ServiceWorkspaceView.vue's order-list/preview-panel drawers. The header row's own height
   (78px, grid-template-rows above) is unchanged here, so the drawers' `top` can stay a plain
   constant instead of needing to measure anything. Slid on/off via position:absolute +
   transform, which never changes either panel's own layout box. */
.editor--compact {
  grid-template-columns: minmax(0, 1fr);
  position: relative;
  overflow: hidden;
}
.editor--compact .filmstrip,
.editor--compact .properties {
  position: absolute;
  top: 78px;
  bottom: 0;
  z-index: 6;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  transition: transform 0.22s ease;
}
.editor--compact .filmstrip {
  left: 0;
  width: min(280px, 100%);
  border-right: none;
  transform: translateX(-100%);
}
.editor--compact .filmstrip.drawer-open {
  transform: translateX(0);
}
.editor--compact .properties {
  right: 0;
  width: min(340px, 100%);
  border-left: none;
  transform: translateX(100%);
}
.editor--compact .properties.drawer-open {
  transform: translateX(0);
}
.drawer-backdrop {
  position: absolute;
  top: 78px;
  left: 0;
  right: 0;
  bottom: 0;
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
.editor-header {
  z-index: 3;
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 11px 20px 11px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 0.9);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.08);
}
/* .editor-heading's back button and .editor-summary's chips/drawer-toggle icons are all
   flex:none (fixed to their own content) — only the h1 in between can shrink, so a genuinely
   narrow (phone) width runs out of room to give and the two sides overlap instead of just
   crowding the title. Wrapping onto two rows below gives each side the full width instead. */
@media (max-width: 480px) {
  .editor-header {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .editor-heading,
  .editor-summary {
    flex-basis: 100%;
  }
  .editor-summary {
    justify-content: flex-end;
  }
  /* The header row wrapping to two lines above needs more than the usual fixed 78px — grown
     here, along with every other place 78px is hardcoded as "the header's height" (the compact
     drawers/backdrop below, which are always active at this width since isEditorCompact's own
     ~1280px threshold is far wider than this one). */
  .editor {
    grid-template-rows: 120px minmax(0, 1fr);
  }
  .editor--compact .filmstrip,
  .editor--compact .properties,
  .drawer-backdrop {
    top: 120px;
  }
}
.editor-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}
.back-button {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  text-transform: none;
}
.editor-eyebrow,
.panel-heading,
.property-section-title {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}
.editor-eyebrow {
  margin-bottom: 2px;
  color: rgb(var(--v-theme-secondary));
}
.editor-heading h1 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-summary {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
}
.editor-summary span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.4);
  color: rgba(var(--v-theme-on-surface), 0.57);
  font-size: 0.72rem;
  font-weight: 570;
}
.filmstrip,
.properties {
  min-height: 0;
  overflow-y: auto;
  background: rgba(var(--v-theme-surface), 0.78);
}
.filmstrip {
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.presentation-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 13px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.17);
}
.presentation-details :deep(.v-field),
.properties :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-background), 0.5);
  font-size: 0.78rem;
}
.presentation-details :deep(.v-chip) {
  font-size: 0.67rem;
}
.filmstrip-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.filmstrip-heading strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.68rem;
}
.thumbnail-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 9px;
}
.thumbnail-row {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 6px;
  padding: 7px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.28);
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.thumbnail-row:hover {
  border-color: rgba(var(--v-theme-secondary), 0.22);
  background: rgba(var(--v-theme-secondary), 0.045);
}
.thumbnail-row.active {
  border-color: rgba(var(--v-theme-secondary), 0.42);
  background: rgba(var(--v-theme-secondary), 0.11);
  box-shadow: inset 3px 0 rgb(var(--v-theme-secondary));
}
.slide-grip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  cursor: grab;
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
}
.slide-grip:active {
  cursor: grabbing;
}
.thumbnail {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 4px;
  background: #000;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
}
.add-slide-button {
  width: calc(100% - 18px);
  margin: 10px 9px 14px;
  font-size: 0.74rem;
  text-transform: none;
}
.properties {
  border-right: 0;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  padding: 0 16px 22px;
}
.inspector-heading {
  position: sticky;
  z-index: 2;
  top: 0;
  margin: 0 -16px 16px;
  padding: 15px 16px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 0.96);
  backdrop-filter: blur(10px);
}
.inspector-heading h2 {
  overflow: hidden;
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 0.98rem;
  font-weight: 680;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-heading p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.7rem;
}
.property-section-title {
  margin: 2px 0 10px;
  color: rgb(var(--v-theme-secondary));
}
.property-section-title--spaced {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.properties :deep(.v-input) {
  margin-bottom: 4px;
}
.presentation-details :deep(.v-label),
.properties :deep(.v-label),
.toolbar :deep(.v-label),
.safe-area-toggle :deep(.v-label) {
  font-size: 0.77rem;
}
.background-position-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
  padding: 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.34);
}
.background-position-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.background-position-heading strong,
.background-position-heading span {
  display: block;
}
.background-position-heading strong {
  font-size: 0.76rem;
}
.background-position-heading span {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.66rem;
  line-height: 1.35;
}
.background-position-axis {
  display: block;
}
.background-position-axis > span {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 2px;
}
.background-position-axis strong {
  font-size: 0.69rem;
  font-weight: 650;
}
.background-position-axis small {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.59rem;
}
.background-position-axis small:last-child {
  min-width: 33px;
  text-align: right;
}
.background-position-axis :deep(.v-slider) {
  margin-inline: 1px;
}
.workspace {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background:
    radial-gradient(circle at 50% 12%, rgba(var(--v-theme-secondary), 0.055), transparent 410px),
    #14171c;
}
.editor-save-alert {
  flex: 0 0 auto;
  margin: 8px 12px 0;
}
.toolbar {
  container: editor-toolbar / inline-size;
  display: flex;
  flex-wrap: wrap;
  row-gap: 6px;
  min-height: 64px;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 0.9);
}
/* .toolbar-group (two-class selector, so it reliably outranks that single-class rule below
   regardless of source order) sets display:flex on every toolbar group including this one —
   without matching that specificity here, .toolbar-group's own rule would win the cascade tie
   and this would never actually hide. */
.toolbar-group.add-group--compact {
  display: none;
}
/* The five Add buttons plus a conditional Canva button plus Arrange need roughly ~770px in the
   worst case (Canva present) before anything gets cut off — 820px leaves some margin.
   Deliberately a container query against the toolbar's own rendered width, not a JS window-width
   breakpoint: see the template comment on add-group--compact for why a single window-width
   number can't represent this correctly. */
@container editor-toolbar (max-width: 820px) {
  .toolbar-group.add-group--full {
    display: none;
  }
  .toolbar-group.add-group--compact {
    display: flex;
  }
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 5px;
}
.toolbar-group :deep(.v-btn) {
  font-size: 0.72rem;
  letter-spacing: 0;
  text-transform: none;
}
.canvas-scroll {
  position: relative;
  display: grid;
  flex: 1;
  place-items: center;
  padding: 26px;
  overflow: auto;
  container-type: size;
}
/* Floats over the top-right corner of the editing area rather than living in the toolbar —
   it's a view option for the canvas itself, not an action, so it reads more like a setting on
   what you're looking at than another toolbar button. Same chip treatment as .editor-summary
   span (border + translucent surface, not a stark black pill) so it reads as part of this app's
   own UI rather than a foreign overlay — still enough contrast to stay legible over whatever's
   actually on the slide beneath it. */
.safe-area-toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  flex: none;
  padding: 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}
.canvas-host {
  position: relative;
  width: min(100cqw, 177.7778cqh);
  flex: none;
  aspect-ratio: 16 / 9;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #000;
  box-shadow: 0 16px 46px rgba(0, 0, 0, 0.5);
}
.property-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 8px;
}
.auto-advance-row {
  display: flex;
  align-items: center;
  gap: 20px;
}
.interval-field {
  flex: none;
  /* Value is never more than 2 digits, but wide enough for the "Interval" label itself to show
     in full rather than truncating — a fixed width instead of stretching to match the row. */
  width: 108px;
}
/* Independent of the drawer collapse above (a plain CSS breakpoint, not tied to isEditorCompact)
   — trims the toolbar down before the side columns themselves become drawers. */
@media (max-width: 1280px) {
  .editor-summary span:last-child {
    display: none;
  }
}
</style>
