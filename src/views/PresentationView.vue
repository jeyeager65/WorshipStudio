<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { LiveSlideContent } from '@/adapters/types'

/**
 * The audience-facing window (see src/adapters/tauri/index.ts's `live` port) — never routed
 * to normally, only ever rendered when App.vue detects it's running in the "presentation"
 * Tauri window. No app-bar, no Vuetify: just the current slide, full-bleed.
 */
const current = ref<LiveSlideContent>()
let unlisten: UnlistenFn | undefined

onMounted(async () => {
  unlisten = await listen<LiveSlideContent | null>('live:slide-changed', (event) => {
    current.value = event.payload ?? undefined
  })
  // Tells the operator window's adapter this window is actually listening now, so it can
  // (re)send the current slide — see the matching comment in openPresentationWindow().
  await emit('presentation:ready')
})
onUnmounted(() => unlisten?.())

// Wayfinding (reference-only scripture, spec section 1): books further from the current one
// shrink and fade, one fade level per book regardless of length — mirrors flipping through a
// physical Bible and seeing nearby book names.
function bookStyle(distance: number) {
  const level = Math.abs(distance)
  const sizes = ['clamp(16px, 3vw, 34px)', 'clamp(12px, 2vw, 24px)']
  const opacities = [0.55, 0.3]
  return { fontSize: sizes[level - 1] ?? sizes[sizes.length - 1], opacity: opacities[level - 1] ?? opacities[opacities.length - 1] }
}
</script>

<template>
  <div class="presentation-root">
    <div v-if="current?.wayfindingBooks" class="wayfinding-content">
      <div
        v-for="book in current.wayfindingBooks.filter((b) => b.distance < 0)"
        :key="book.name"
        class="wayfinding-book"
        :style="bookStyle(book.distance)"
      >
        {{ book.name }}
      </div>
      <div class="wayfinding-reference">{{ current.itemLabel }}</div>
      <div
        v-for="book in current.wayfindingBooks.filter((b) => b.distance > 0)"
        :key="book.name"
        class="wayfinding-book"
        :style="bookStyle(book.distance)"
      >
        {{ book.name }}
      </div>
    </div>
    <div v-else-if="current" class="presentation-content">
      <div class="presentation-label">{{ current.itemLabel }}<template v-if="current.subLabel"> — {{ current.subLabel }}</template></div>
      <div class="presentation-text">{{ current.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.presentation-root {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.presentation-content {
  max-width: 90vw;
  text-align: center;
}
.presentation-label {
  font-size: clamp(14px, 2vw, 28px);
  opacity: 0.6;
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.presentation-text {
  font-size: clamp(28px, 5vw, 72px);
  font-weight: 600;
  line-height: 1.3;
  white-space: pre-line;
}

.wayfinding-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.wayfinding-book {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.wayfinding-reference {
  font-size: clamp(40px, 7vw, 90px);
  font-weight: 700;
  margin: 18px 0;
}
</style>
