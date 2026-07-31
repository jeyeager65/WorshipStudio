<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'
import { getAdapter } from '@/adapters'
import type { SlideElement, SlideScene, SlideTextElement } from '@/models/library'

const props = withDefaults(
  defineProps<{
    scene: SlideScene
    interactive?: boolean
    selectedId?: string
    editingId?: string
    showSafeArea?: boolean
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
        if (mediaUrls.has(id)) return
        const url = await getAdapter().media.getPreviewUrl(id)
        if (url) mediaUrls.set(id, url)
      }),
    )
  },
  { immediate: true },
)

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
              element.shape === 'triangle'
                ? 'polygon(50% 0, 100% 100%, 0 100%)'
                : undefined,
            border: element.fillMode === 'outline' && element.stroke
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
