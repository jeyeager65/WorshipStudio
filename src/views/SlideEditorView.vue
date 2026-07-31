<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import Moveable from 'vue3-moveable'
import SlideSceneRenderer from '@/components/slides/SlideSceneRenderer.vue'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import { getAdapter } from '@/adapters'
import { useSlidesStore } from '@/stores/slides'
import { useMediaStore } from '@/stores/media'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { createBlankScene, createTextElement } from '@/utils/slideScene'
import type {
  LibrarySlide,
  SlideElement,
  SlideImageElement,
  SlideLibraryItem,
  SlideShapeElement,
  SlideTextElement,
} from '@/models/library'

const route = useRoute()
const router = useRouter()
const store = useSlidesStore()
const mediaStore = useMediaStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()
const item = ref<SlideLibraryItem>()
const selectedSlideId = ref('')
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
let stopItemWatch: (() => void) | undefined

function blankItem(): SlideLibraryItem {
  const slide = blankSlide(1)
  return {
    id: `slide-${crypto.randomUUID()}`,
    label: 'New Presentation',
    documentVersion: 2,
    slides: [slide],
    usage: { usesPastYear: 0 },
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
  get: () =>
    selectedElement.value?.lockAspectRatio ?? selectedElement.value?.type === 'image',
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
        .map((element) => canvasHost.value?.querySelector<HTMLElement>(`[data-scene-element-id="${CSS.escape(element.id)}"]`))
        .filter((element): element is HTMLElement => !!element)
    : [],
)
const horizontalGuidelines = computed(() => canvasHost.value ? [canvasHost.value.clientHeight / 2] : [])
const verticalGuidelines = computed(() => canvasHost.value ? [canvasHost.value.clientWidth / 2] : [])

watch(
  [selectedElementId, selectedSlideId],
  async () => {
    await nextTick()
    moveableTarget.value = selectedElementId.value
      ? (canvasHost.value?.querySelector<HTMLElement>(`[data-scene-element-id="${CSS.escape(selectedElementId.value)}"]`) ?? undefined)
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

onMounted(async () => {
  const isNew = route.params.id === 'new'
  item.value = isNew ? blankItem() : await getAdapter().slides.get(route.params.id as string)
  if (item.value) {
    for (const slide of item.value.slides) {
      for (const element of slide.scene.elements) {
        element.rotation = normalizeRotation(element.rotation)
      }
    }
    selectedSlideId.value = item.value.slides[0]?.id ?? ''
  }
  if (!mediaStore.loaded) await mediaStore.load()
  isDirty.value = isNew
  stopItemWatch = watch(item, () => (isDirty.value = true), { deep: true })
  saveHandler.value = saveItem
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
})

onUnmounted(() => {
  stopItemWatch?.()
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

function setAsBackground(mediaId?: string) {
  if (!scene.value) return
  scene.value.background.mediaId = mediaId
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
  return canvasHost.value && scene.value ? scene.value.width / canvasHost.value.getBoundingClientRect().width : 1
}

let transformStart = { x: 0, y: 0 }
let pendingGeometry: { x: number; y: number; width?: number; height?: number } | undefined
function onMoveableDragStart() {
  if (!selectedElement.value) return
  transformStart = { x: selectedElement.value.x, y: selectedElement.value.y }
  pendingGeometry = { ...transformStart }
}
function onMoveableDrag(event: { beforeTranslate: number[]; transform: string; target: HTMLElement | SVGElement }) {
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
  <div v-if="item && scene" class="editor">
    <aside class="filmstrip">
      <v-text-field
        v-model="item.label"
        label="Presentation name"
        variant="outlined"
        density="compact"
        hide-details
        class="ma-3"
      />
      <VueDraggable v-model="item.slides" handle=".slide-grip" :animation="150">
        <div
          v-for="(slide, index) in item.slides"
          :key="slide.id"
          class="thumbnail-row"
          :class="{ active: slide.id === selectedSlideId }"
          @click="selectSlide(slide.id)"
        >
          <span class="slide-grip">{{ index + 1 }}</span>
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
      <v-btn prepend-icon="mdi-plus" variant="text" block @click="addSlide">Add slide</v-btn>
    </aside>

    <main class="workspace">
      <div class="toolbar">
        <v-btn prepend-icon="mdi-format-text" @click="addText">Text</v-btn>
        <v-btn prepend-icon="mdi-image-outline" @click="openMediaPicker('add')">Image</v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" prepend-icon="mdi-shape-outline" append-icon="mdi-menu-down">Shape</v-btn>
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
        <v-divider vertical />
        <v-btn
          icon="mdi-arrange-bring-forward"
          title="Bring forward"
          :disabled="!selectedElement"
          @click="moveLayer('forward')"
        />
        <v-btn
          icon="mdi-arrange-bring-to-front"
          title="Bring to front"
          :disabled="!selectedElement"
          @click="moveLayer('front')"
        />
        <v-btn
          icon="mdi-arrange-send-backward"
          title="Send backward"
          :disabled="!selectedElement"
          @click="moveLayer('backward')"
        />
        <v-btn
          icon="mdi-arrange-send-to-back"
          title="Send to back"
          :disabled="!selectedElement"
          @click="moveLayer('back')"
        />
        <v-spacer />
        <v-switch v-model="showSafeArea" label="Safe area" hide-details density="compact" />
      </div>
      <div class="canvas-scroll">
        <div
          ref="canvasHost"
          class="canvas-host"
        >
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

    <aside class="properties">
      <template v-if="selectedElement">
        <div class="text-overline mb-2">Element</div>
        <v-text-field
          v-model="selectedElement.name"
          label="Layer name"
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
          label="Lock aspect ratio"
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
          <v-textarea v-model="textElement.text" label="Text" variant="outlined" rows="4" />
          <v-combobox
            :model-value="textElement.style.fontFamily"
            :items="['Inter', 'Arial', 'Georgia', 'Montserrat', 'Times New Roman']"
            label="Font"
            density="compact"
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
          <v-btn-toggle v-model="textElement.style.textAlign" mandatory>
            <v-btn value="left" icon="mdi-format-align-left" />
            <v-btn value="center" icon="mdi-format-align-center" />
            <v-btn value="right" icon="mdi-format-align-right" />
          </v-btn-toggle>
          <v-btn-toggle class="ml-2">
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
          <v-select
            v-model="textEffectType"
            :items="[
              { title: 'None', value: 'none' },
              { title: 'Outline', value: 'outline' },
              { title: 'Drop shadow', value: 'shadow' },
              { title: 'Glow', value: 'glow' },
            ]"
            label="Text effect"
            density="compact"
            class="mt-4"
          />
          <div v-if="textEffectType !== 'none'" class="property-grid">
            <v-color-input
              v-model="textEffectColor"
              label="Effect color"
              density="compact"
            />
            <v-number-input
              v-model="textEffectSize"
              label="Strength"
              density="compact"
              control-variant="hidden"
              :min="1"
              :max="30"
            />
          </div>
          <div
            v-if="textEffectType === 'shadow' && textElement.style.effect"
            class="property-grid"
          >
            <v-number-input
              v-model="textElement.style.effect.offsetX"
              label="Horizontal offset"
              density="compact"
              control-variant="hidden"
              :min="-50"
              :max="50"
            />
            <v-number-input
              v-model="textElement.style.effect.offsetY"
              label="Vertical offset"
              density="compact"
              control-variant="hidden"
              :min="-50"
              :max="50"
            />
          </div>
        </template>
        <template v-if="imageElement">
          <v-select
            v-model="imageElement.fit"
            :items="['cover', 'contain', 'fill']"
            label="Image fit"
            density="compact"
          />
          <v-btn block variant="outlined" @click="openMediaPicker('replace')">Replace image</v-btn>
        </template>
        <template v-if="shapeElement">
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
              { title: 'Solid fill', value: 'solid' },
              { title: 'Outline only', value: 'outline' },
            ]"
            label="Style"
            density="compact"
          />
          <v-color-input
            v-if="shapeElement.fillMode !== 'outline' && shapeElement.shape !== 'line'"
            v-model="shapeElement.fill"
            label="Fill color"
            density="compact"
          />
          <v-color-input
            v-if="shapeElement.fillMode === 'outline' || shapeElement.shape === 'line'"
            v-model="shapeStrokeColor"
            label="Line color"
            density="compact"
          />
          <v-number-input
            v-if="shapeElement.fillMode === 'outline' || shapeElement.shape === 'line'"
            v-model="shapeStrokeWidth"
            label="Line width"
            density="compact"
            control-variant="hidden"
            :min="1"
            :max="40"
          />
          <v-number-input
            v-if="shapeElement.shape === 'rectangle'"
            v-model="shapeElement.cornerRadius"
            label="Corner radius"
            density="compact"
            control-variant="hidden"
            :min="0"
            :max="300"
          />
        </template>
        <v-btn
          class="mt-4"
          block
          color="error"
          variant="tonal"
          prepend-icon="mdi-delete"
          @click="deleteElement"
          >Delete element</v-btn
        >
      </template>
      <template v-else>
        <div class="text-overline mb-2">Slide</div>
        <v-text-field
          v-model="selectedSlide!.label"
          label="Slide name"
          density="compact"
          variant="outlined"
        />
        <v-color-input
          v-model="scene.background.color"
          label="Background color"
          density="compact"
        />
        <v-btn block variant="outlined" prepend-icon="mdi-image" @click="openMediaPicker('background')"
          >Choose background</v-btn
        >
        <v-btn
          v-if="scene.background.mediaId"
          block
          variant="text"
          @click="scene.background.mediaId = undefined"
          >Remove background</v-btn
        >
        <p class="text-caption text-medium-emphasis mt-4">
          Blue marks the full-height 16:10 crop; yellow marks the full-height 4:3 crop.
        </p>
      </template>
    </aside>

    <MediaPickerDialog v-model="mediaDialog" @select="onMediaPicked" />
  </div>
  <v-container v-else><p>Slide not found.</p></v-container>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 290px;
  height: calc(100vh - 48px);
  overflow: hidden;
}
.filmstrip,
.properties {
  overflow-y: auto;
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.properties {
  border-right: 0;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 16px;
}
.workspace {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #17191d;
}
.toolbar {
  min-height: 52px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  background: rgb(var(--v-theme-surface));
}
.canvas-scroll {
  flex: 1;
  container-type: size;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 16px;
}
.canvas-host {
  position: relative;
  flex: none;
  width: min(100cqw, 177.7778cqh);
  aspect-ratio: 16 / 9;
  background: #000;
  box-shadow: 0 8px 32px #000a;
}
.thumbnail-row {
  display: grid;
  grid-template-columns: 24px 1fr 26px;
  align-items: center;
  gap: 5px;
  padding: 8px;
  cursor: pointer;
}
.thumbnail-row.active {
  background: rgba(var(--v-theme-primary), 0.16);
}
.slide-grip {
  font-size: 12px;
  cursor: grab;
  text-align: center;
}
.thumbnail {
  aspect-ratio: 16 / 9;
  background: #000;
  overflow: hidden;
}
.property-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
