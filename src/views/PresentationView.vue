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
</script>

<template>
  <div class="presentation-root">
    <div v-if="current" class="presentation-content">
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
</style>
