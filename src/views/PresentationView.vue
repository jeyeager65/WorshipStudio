<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import type { LiveSlideContent } from '@/adapters/types'

/**
 * The audience-facing window (see src/adapters/tauri/index.ts's `live` port) — never routed
 * to normally, only ever rendered when App.vue detects it's running in the "presentation"
 * Tauri window. No app-bar, no Vuetify: just the current slide, full-bleed, via the shared
 * SlideContentRenderer (also used by the operator's Previous/Current/Next preview thumbnails
 * in ServiceWorkspaceView).
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
onUnmounted(() => {
  unlisten?.()
})
</script>

<template>
  <SlideContentRenderer :content="current" />
</template>
