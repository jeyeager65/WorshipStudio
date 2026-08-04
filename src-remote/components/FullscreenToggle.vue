<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

// iOS Safari has no Fullscreen API for arbitrary elements — `document.fullscreenEnabled` is
// `false` there, so this hides itself entirely rather than showing a button that silently does
// nothing (see the plan's manual-verification note on iOS Safari's own Fullscreen quirks).
const supported = typeof document !== 'undefined' && document.fullscreenEnabled
const isFullscreen = ref(!!document.fullscreenElement)

function onChange() {
  isFullscreen.value = !!document.fullscreenElement
}

function toggle() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen().catch(() => {})
}

onMounted(() => document.addEventListener('fullscreenchange', onChange))
onUnmounted(() => document.removeEventListener('fullscreenchange', onChange))
</script>

<template>
  <button
    v-if="supported"
    type="button"
    class="fs-toggle"
    :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
    @click="toggle"
  >
    {{ isFullscreen ? '⤡' : '⤢' }}
  </button>
</template>

<style scoped>
.fs-toggle {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--ws-radius-sm);
  background: transparent;
  color: var(--ws-text-secondary);
  font-size: 1rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.fs-toggle:active {
  background: var(--ws-surface-variant);
}
</style>
