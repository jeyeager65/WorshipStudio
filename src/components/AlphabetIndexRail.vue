<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  letters: string[]
  availableLetters: Set<string>
}>()

const emit = defineEmits<{ select: [letter: string] }>()

const railEl = ref<HTMLElement>()
const activeLetter = ref<string>()
const railHeight = ref(0)

// Sizing bounds for one letter's slot. Below MIN_SLOT letters stop being comfortably hittable —
// that's the threshold that decides when the rail sheds content rather than squeezing further.
// MAX_SLOT stops a tall window from turning each letter into an oversized target with the
// alphabet floating in the middle of a mostly-empty strip.
const MIN_SLOT = 16
const MAX_SLOT = 30

interface RailSlot {
  key: string
  label: string
  letter: string
  bullet: boolean
}

function plainSlots(letters: string[]): RailSlot[] {
  return letters.map((letter) => ({ key: letter, label: letter, letter, bullet: false }))
}

// Drops letters and stands a bullet in for each skipped run, the way the iOS Contacts index
// does. Every slot still carries a real letter (a bullet reports the middle of the run it
// replaced), so dragging across an elided rail still reaches everything.
function elidedSlots(letters: string[], maxFit: number): RailSlot[] {
  // k letters separated by k-1 bullets is 2k-1 slots, so k is bounded by (maxFit + 1) / 2.
  const k = Math.max(2, Math.floor((maxFit + 1) / 2))
  const indexAt = (step: number) => Math.round((step * (letters.length - 1)) / (k - 1))
  const out: RailSlot[] = []
  for (let step = 0; step < k; step++) {
    const index = indexAt(step)
    if (step > 0) {
      const middle = Math.floor((indexAt(step - 1) + index) / 2)
      out.push({ key: `bullet-${step}`, label: '•', letter: letters[middle], bullet: true })
    }
    out.push({ key: letters[index], label: letters[index], letter: letters[index], bullet: false })
  }
  return out
}

// Three tiers, each shedding only what the height actually forces:
//   1. the whole alphabet, empty letters greyed out — the most scannable, so preferred;
//   2. only the letters the list actually uses — every entry still individually reachable, and
//      dropping the greyed-out ones costs nothing the operator can act on anyway;
//   3. those same used letters, elided with bullets — the last resort, since it's the only tier
//      where a letter stops being directly hittable.
// The rail itself is never scrollable at any tier: a scroller you must scroll before you can use
// it defeats the point of a quick-scroll index.
const slots = computed<RailSlot[]>(() => {
  const all = props.letters
  const height = railHeight.value
  if (!height || all.length * MIN_SLOT <= height) return plainSlots(all)

  const used = all.filter((letter) => props.availableLetters.has(letter))
  if (used.length && used.length * MIN_SLOT <= height) return plainSlots(used)

  const source = used.length > 2 ? used : all
  return elidedSlots(source, Math.max(3, Math.floor(height / MIN_SLOT)))
})

// Slots share the rail's height so the strip fills it at any window size, and the glyph scales
// with its slot so it stays legible (and centered) rather than rattling around in it.
const slotHeight = computed(() =>
  slots.value.length && railHeight.value
    ? Math.min(MAX_SLOT, railHeight.value / slots.value.length)
    : MAX_SLOT,
)
const fontSize = computed(() => Math.max(8, Math.min(15.5, slotHeight.value * 0.62)))
const railWidth = computed(() => Math.max(16, Math.min(26, slotHeight.value * 1.05)))

let observer: ResizeObserver | undefined
function measure() {
  if (railEl.value) railHeight.value = railEl.value.clientHeight
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && railEl.value) {
    observer = new ResizeObserver(measure)
    observer.observe(railEl.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())

// The rail always reports the slot under the finger, but jumps the list to the nearest letter
// that actually has a group — same as iOS Contacts, where dragging across a letter with no
// entries still lands somewhere sensible instead of doing nothing.
function nearestAvailableLetter(letter: string): string | undefined {
  if (props.availableLetters.has(letter)) return letter
  const index = props.letters.indexOf(letter)
  for (let distance = 1; distance < props.letters.length; distance++) {
    const before = props.letters[index - distance]
    if (before && props.availableLetters.has(before)) return before
    const after = props.letters[index + distance]
    if (after && props.availableLetters.has(after)) return after
  }
  return undefined
}

function letterAtPoint(clientY: number): string | undefined {
  const el = railEl.value
  if (!el) return undefined
  for (const item of el.querySelectorAll<HTMLElement>('[data-letter]')) {
    const rect = item.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) return item.dataset.letter
  }
  return undefined
}

function selectAtPoint(clientY: number) {
  const letter = letterAtPoint(clientY)
  if (!letter) return
  const target = nearestAvailableLetter(letter)
  activeLetter.value = target ?? letter
  if (target) emit('select', target)
}

// Capture keeps a drag that wanders off the rail (easy with a finger) still steering the list.
// It's an enhancement, not a requirement, so a failure to capture must not stop the tap itself
// from registering — setPointerCapture throws for any pointer the browser doesn't consider
// active, which is why these are guarded rather than called bare.
const captured = ref(false)
function onPointerDown(event: PointerEvent) {
  try {
    railEl.value?.setPointerCapture(event.pointerId)
    captured.value = true
  } catch {
    captured.value = false
  }
  selectAtPoint(event.clientY)
}
function onPointerMove(event: PointerEvent) {
  if (!captured.value) return
  selectAtPoint(event.clientY)
}
function onPointerUp(event: PointerEvent) {
  activeLetter.value = undefined
  captured.value = false
  try {
    railEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    // Never captured (or already released) — nothing to undo.
  }
}
</script>

<template>
  <div class="alphabet-rail-wrap">
    <!-- Only while dragging: with small or elided slots the rail itself can't confirm where you
         are, and on a phone a finger covers the letters outright. -->
    <div v-if="activeLetter" class="alphabet-rail-bubble" aria-hidden="true">
      {{ activeLetter }}
    </div>
    <nav
      ref="railEl"
      class="alphabet-rail"
      :style="{ '--rail-width': `${railWidth}px` }"
      aria-label="Jump to letter"
      @pointerdown.prevent="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span
        v-for="slot in slots"
        :key="slot.key"
        :data-letter="slot.letter"
        class="alphabet-rail-letter"
        :style="{ height: `${slotHeight}px`, fontSize: `${fontSize}px` }"
        :class="{
          'alphabet-rail-letter--active': !slot.bullet && activeLetter === slot.letter,
          'alphabet-rail-letter--bullet': slot.bullet,
          'alphabet-rail-letter--empty': !slot.bullet && !availableLetters.has(slot.letter),
        }"
        >{{ slot.label }}</span
      >
    </nav>
  </div>
</template>

<style scoped>
/* Sized by the flex parent (the page), so the rail spans its full height and never scrolls away
   with the list beside it.
   z-index because the list's sticky letter headings are positioned with z-index: 1 and would
   otherwise paint over the drag bubble, clipping it mid-circle. */
.alphabet-rail-wrap {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  position: relative;
  z-index: 10;
  height: 100%;
}
/* Deliberately the same border/radius/surface/shadow as the hero and list cards these sit beside
   — the rail reads as another panel in the same layout rather than a loose strip of glyphs. */
.alphabet-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 6px 5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
  touch-action: none;
  user-select: none;
  cursor: default;
}
.alphabet-rail-letter {
  display: grid;
  place-items: center;
  width: var(--rail-width, 26px);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-weight: 700;
  line-height: 1;
}
.alphabet-rail-letter--empty {
  color: rgba(var(--v-theme-on-surface), 0.22);
}
.alphabet-rail-letter--bullet {
  color: rgba(var(--v-theme-on-surface), 0.32);
}
.alphabet-rail-letter--active {
  background: color-mix(in srgb, rgb(var(--v-theme-teal)) 85%, transparent);
  color: rgb(var(--v-theme-background));
}
/* Sits above the rail's own panel and anything the page has painted (see .alphabet-rail-wrap's
   z-index note). Opaque, not translucent — over a list card the letter has to stay readable. */
.alphabet-rail-bubble {
  display: grid;
  place-items: center;
  position: absolute;
  z-index: 1;
  right: calc(100% + 10px);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgb(var(--v-theme-teal));
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
  color: rgb(var(--v-theme-background));
  font-size: 1.5rem;
  font-weight: 700;
  pointer-events: none;
}
</style>
