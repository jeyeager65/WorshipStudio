<script setup lang="ts">
import FullscreenToggle from './FullscreenToggle.vue'

defineProps<{
  connected: boolean
  deviceName: string | undefined
  isPresenting: boolean
  /** Full Control only — View Only has no controls to hide in the first place. */
  showControlsToggle?: boolean
  controlsHidden?: boolean
}>()

defineEmits<{ 'toggle-controls': [] }>()
</script>

<template>
  <div class="status-row">
    <span class="connection-dot" :class="{ offline: !connected }" />
    <span class="device-name">{{ deviceName ?? 'Connecting…' }}</span>
    <span class="spacer" />
    <span v-if="isPresenting" class="live-text">LIVE</span>
    <button
      v-if="showControlsToggle"
      type="button"
      class="controls-toggle"
      :class="{ active: !controlsHidden }"
      :aria-label="controlsHidden ? 'Show controls' : 'Hide controls'"
      @click="$emit('toggle-controls')"
    >
      Controls
    </button>
    <FullscreenToggle />
  </div>
</template>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  gap: var(--ws-space-2);
  padding: var(--ws-space-3) var(--ws-space-4);
  font-size: 0.8rem;
  color: var(--ws-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
}
.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ws-success);
  flex-shrink: 0;
  transition: background var(--ws-transition-fast);
}
.connection-dot.offline {
  background: var(--ws-error);
}
.device-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.live-text {
  color: var(--ws-error);
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.controls-toggle {
  flex-shrink: 0;
  padding: 3px var(--ws-space-2);
  border: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
  border-radius: var(--ws-radius-sm);
  background: transparent;
  color: var(--ws-text-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.controls-toggle.active {
  border-color: var(--ws-primary);
  color: var(--ws-primary);
}
</style>
