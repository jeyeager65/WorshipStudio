<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { formatCountdown, formatDaysUntil } from '@/utils/countdown'
import type {
  SlideCountdownElement,
  SlideElement,
  SlideQrElement,
  SlideScene,
  SlideTextElement,
} from '@/models/library'

const props = withDefaults(
  defineProps<{
    scene: SlideScene
    interactive?: boolean
    selectedId?: string
    editingId?: string
    showSafeArea?: boolean
    /** This service's own date/time (ISO) — lets a Countdown element in 'service' mode count
     *  down to it. Undefined in the Slide Editor, which edits a reusable Library Slide with no
     *  notion of which service (if any) it'll eventually be presented in. */
    serviceDateTime?: string
  }>(),
  { interactive: false, showSafeArea: false },
)

const emit = defineEmits<{
  select: [id: string]
  edit: [id: string]
  textChange: [id: string, text: string]
}>()
const mediaUrls = reactive(new Map<string, string>())
const textNodes = new Map<string, HTMLElement>()

function setTextNode(id: string, node: unknown) {
  if (node instanceof HTMLElement) textNodes.set(id, node)
  else textNodes.delete(id)
}

watch(
  () => props.editingId,
  async (id) => {
    if (!id) return
    await nextTick()
    textNodes.get(id)?.focus()
  },
)

function onElementPointerDown(event: PointerEvent, id: string) {
  if (!props.interactive) return
  emit('select', id)
  if (props.editingId === id) event.stopPropagation()
}

function onTextInput(id: string, event: Event) {
  emit('textChange', id, (event.currentTarget as HTMLElement).innerText)
}

const mediaIds = computed(() => {
  const ids = props.scene.elements.filter((e) => e.type === 'image').map((e) => e.mediaId)
  if (props.scene.background.mediaId) ids.push(props.scene.background.mediaId)
  return [...new Set(ids)]
})

watch(
  mediaIds,
  async (ids) => {
    await Promise.all(
      ids.map(async (id) => {
        const url = await getAdapter().media.getPreviewUrl(id)
        if (url) {
          // Blob/data URLs used by the browser demo are exact opaque identifiers and cannot
          // accept query parameters. Desktop asset URLs can, which forces WebView2 to read an
          // in-place Canva refresh instead of reusing its cached pixels.
          const versionedUrl = /^(blob:|data:)/.test(url)
            ? url
            : `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
          mediaUrls.set(id, versionedUrl)
        }
      }),
    )
  },
  { immediate: true },
)

// QR codes are generated on demand from each element's own content (see the Rust qr_data_url
// command, shared with Remote Control pairing) rather than stored as image data — cached here
// by element id, regenerated only when that element's own encoded text actually changes.
const qrDataUrls = reactive(new Map<string, string>())
const qrLastTextById = new Map<string, string>()

function qrContentText(element: SlideQrElement): string {
  const content = element.content
  if (content.kind === 'url') return content.url
  // Standard WIFI: join-network format phone camera apps already recognize when scanning.
  const escape = (value: string) => value.replace(/([\\;,:"])/g, '\\$1')
  const password = content.password ? `P:${escape(content.password)};` : ''
  return `WIFI:T:${content.encryption};S:${escape(content.ssid)};${password};`
}

const qrTextsById = computed(() => {
  const map = new Map<string, string>()
  for (const element of props.scene.elements) {
    if (element.type === 'qr') map.set(element.id, qrContentText(element))
  }
  return map
})

watch(
  qrTextsById,
  async (textsById) => {
    for (const id of [...qrDataUrls.keys()]) {
      if (!textsById.has(id)) {
        qrDataUrls.delete(id)
        qrLastTextById.delete(id)
      }
    }
    await Promise.all(
      [...textsById].map(async ([id, text]) => {
        if (!text) {
          qrDataUrls.delete(id)
          return
        }
        if (qrLastTextById.get(id) === text) return
        qrLastTextById.set(id, text)
        const dataUrl = await getAdapter().slides.generateQrCode(text)
        if (dataUrl) qrDataUrls.set(id, dataUrl)
        else qrDataUrls.delete(id)
      }),
    )
  },
  { immediate: true },
)

// Countdown elements need a live-ticking clock — only run the interval when the scene actually
// has one, same "don't do work nothing needs" reasoning as the QR fetching above.
const hasCountdownElements = computed(() =>
  props.scene.elements.some((e) => e.type === 'countdown'),
)
const nowTick = ref(new Date())
let nowTickInterval: ReturnType<typeof setInterval> | undefined
watch(
  hasCountdownElements,
  (has) => {
    clearInterval(nowTickInterval)
    nowTickInterval = has ? setInterval(() => (nowTick.value = new Date()), 1000) : undefined
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(nowTickInterval))

function countdownLabel(element: SlideCountdownElement): string | undefined {
  if (element.label) return element.label
  if (element.mode === 'service' && !props.serviceDateTime)
    return 'Add this slide to a service to preview'
  return undefined
}

function countdownValue(element: SlideCountdownElement): string {
  if (element.mode === 'service') {
    return props.serviceDateTime ? formatCountdown(props.serviceDateTime, nowTick.value) : '--:--'
  }
  if (element.mode === 'days') {
    return element.targetDate ? formatDaysUntil(element.targetDate, nowTick.value) : '— Days'
  }
  return element.targetTime ? formatCountdown(element.targetTime, nowTick.value) : '--:--'
}

const backgroundStyle = computed(() => {
  const background = props.scene.background
  const url = background.mediaId ? mediaUrls.get(background.mediaId) : undefined
  return {
    backgroundColor: background.color,
    backgroundImage: url ? `url("${url}")` : undefined,
    backgroundSize: background.fit,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `${(background.focalPoint?.x ?? 0.5) * 100}% ${(background.focalPoint?.y ?? 0.5) * 100}%`,
  }
})

function elementStyle(element: SlideElement) {
  return {
    left: `${(element.x / props.scene.width) * 100}%`,
    top: `${(element.y / props.scene.height) * 100}%`,
    width: `${(element.width / props.scene.width) * 100}%`,
    height: `${(element.height / props.scene.height) * 100}%`,
    transform: `rotate(${element.rotation}deg)`,
    opacity: element.opacity,
    display: element.hidden ? 'none' : undefined,
  }
}

function textEffectStyle(element: SlideTextElement) {
  const effect = element.style.effect
  if (!effect || effect.type === 'none') return undefined
  const unit = (value: number) => `${(value / props.scene.height) * 100}cqh`
  if (effect.type === 'outline') {
    return `0 0 ${unit(effect.size)} ${effect.color}, 0 0 ${unit(effect.size)} ${effect.color}`
  }
  if (effect.type === 'glow') {
    return `0 0 ${unit(effect.size * 2)} ${effect.color}, 0 0 ${unit(effect.size * 3)} ${effect.color}`
  }
  return `${unit(effect.offsetX ?? 6)} ${unit(effect.offsetY ?? 6)} ${unit(effect.size)} ${effect.color}`
}

function safeAreaStyle(aspectRatio: number, color: string) {
  const safeWidth = Math.min(props.scene.width, props.scene.height * aspectRatio)
  const sideInset = (props.scene.width - safeWidth) / 2
  return {
    left: `${(sideInset / props.scene.width) * 100}%`,
    top: 0,
    right: `${(sideInset / props.scene.width) * 100}%`,
    bottom: 0,
    borderColor: color,
    color,
  }
}
</script>

<template>
  <div class="scene" @pointerdown.self="interactive && emit('select', '')">
    <div
      class="scene-stage"
      :style="{ ...backgroundStyle, '--scene-aspect': scene.width / scene.height }"
      @pointerdown.self="interactive && emit('select', '')"
    >
      <div
        v-for="element in scene.elements"
        :key="element.id"
        :data-scene-element-id="element.id"
        class="scene-element"
        :class="{ interactive, selected: selectedId === element.id }"
        :style="elementStyle(element)"
        @pointerdown="onElementPointerDown($event, element.id)"
      >
        <div
          v-if="element.type === 'text'"
          :ref="(node) => setTextNode(element.id, node)"
          class="text-element"
          :class="{ editing: editingId === element.id }"
          :contenteditable="interactive && editingId === element.id"
          :style="{
            fontFamily: element.style.fontFamily,
            fontSize: `${(element.style.fontSize / scene.height) * 100}cqh`,
            fontWeight: element.style.fontWeight,
            fontStyle: element.style.italic ? 'italic' : undefined,
            textDecoration: element.style.underline ? 'underline' : undefined,
            color: element.style.color,
            textAlign: element.style.textAlign,
            lineHeight: element.style.lineHeight,
            letterSpacing: `${element.style.letterSpacing}px`,
            textShadow: textEffectStyle(element),
            alignItems:
              element.style.verticalAlign === 'top'
                ? 'flex-start'
                : element.style.verticalAlign === 'bottom'
                  ? 'flex-end'
                  : 'center',
          }"
          @dblclick.stop="interactive && emit('edit', element.id)"
          @input="onTextInput(element.id, $event)"
        >
          {{ element.text }}
        </div>
        <img
          v-else-if="element.type === 'image' && mediaUrls.get(element.mediaId)"
          :src="mediaUrls.get(element.mediaId)"
          :style="{
            objectFit: element.fit,
            objectPosition: `${(element.focalPoint?.x ?? 0.5) * 100}% ${(element.focalPoint?.y ?? 0.5) * 100}%`,
            borderRadius: `${element.borderRadius ?? 0}px`,
          }"
          draggable="false"
          alt=""
        />
        <div
          v-else-if="element.type === 'shape'"
          class="shape"
          :style="{
            background:
              element.shape === 'line' || element.fillMode === 'outline'
                ? 'transparent'
                : element.fill,
            borderRadius:
              element.shape === 'ellipse'
                ? '50%'
                : element.shape === 'rectangle'
                  ? `${((element.cornerRadius ?? 0) / scene.height) * 100}cqh`
                  : undefined,
            clipPath:
              element.shape === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : undefined,
            border:
              element.fillMode === 'outline' && element.stroke
                ? `${(element.stroke.width / scene.height) * 100}cqh solid ${element.stroke.color}`
                : undefined,
          }"
        >
          <span
            v-if="element.shape === 'line'"
            class="shape-line"
            :style="{
              background: element.stroke?.color ?? element.fill,
              height: `${((element.stroke?.width ?? 4) / scene.height) * 100}cqh`,
            }"
          />
        </div>
        <div v-else-if="element.type === 'qr'" class="qr-element">
          <img
            v-if="qrDataUrls.get(element.id)"
            :src="qrDataUrls.get(element.id)"
            draggable="false"
            alt="QR code"
          />
          <div v-else class="qr-placeholder">
            <span>QR</span>
          </div>
        </div>
        <div
          v-else-if="element.type === 'countdown'"
          class="countdown-element"
          :style="{
            fontFamily: element.style.fontFamily,
            color: element.style.color,
            textAlign: element.style.textAlign,
            alignItems:
              element.style.textAlign === 'left'
                ? 'flex-start'
                : element.style.textAlign === 'right'
                  ? 'flex-end'
                  : 'center',
          }"
        >
          <div v-if="countdownLabel(element)" class="countdown-label">
            {{ countdownLabel(element) }}
          </div>
          <div
            class="countdown-value"
            :style="{
              fontSize: `${(element.style.fontSize / scene.height) * 100}cqh`,
              fontWeight: element.style.fontWeight,
            }"
          >
            {{ countdownValue(element) }}
          </div>
        </div>
      </div>
      <div
        v-for="safeArea in showSafeArea ? scene.safeAreas : []"
        :key="safeArea.label"
        class="safe-area"
        :style="safeAreaStyle(safeArea.aspectRatio, safeArea.color)"
      >
        <span>{{ safeArea.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scene {
  container-type: size;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
.scene-stage {
  container-type: size;
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100cqw, calc(100cqh * var(--scene-aspect)));
  aspect-ratio: var(--scene-aspect);
  transform: translate(-50%, -50%);
}
.scene-element {
  position: absolute;
  transform-origin: center;
}
.scene-element.interactive {
  cursor: move;
}
.text-element {
  display: flex;
  width: 100%;
  height: 100%;
  white-space: pre-wrap;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.text-element.editing {
  cursor: text;
  user-select: text;
  outline: none;
}
img,
.shape {
  width: 100%;
  height: 100%;
  display: block;
}
.shape-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}
.qr-element {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: #fff;
}
/* object-fit is deliberately not configurable here (unlike image elements) — any distortion
   would break scanning, so it's always shown undistorted regardless of the element's box. */
.qr-element img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.qr-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: rgba(0, 0, 0, 0.35);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.countdown-element {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.countdown-label {
  font-size: max(10px, 3cqh);
  opacity: 0.85;
}
.countdown-value {
  font-variant-numeric: tabular-nums;
}
.safe-area {
  position: absolute;
  border-width: max(1px, 0.08cqw);
  border-style: dashed;
  pointer-events: none;
}
.safe-area span {
  position: absolute;
  top: 3px;
  left: 5px;
  color: inherit;
  font: 600 max(9px, 0.7cqw) sans-serif;
}
</style>
