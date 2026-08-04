<script setup lang="ts">
import PrevNextBar from './PrevNextBar.vue'
import SlidePicker from './SlidePicker.vue'
import ServicePicker from './ServicePicker.vue'
import { useRemoteAction } from '../composables/useRemoteAction'
import type { SlideSummary } from '../composables/usePoll'

defineProps<{
  isPresenting: boolean
  /** See remote_server.rs's `service_open` doc comment — true once a service is open on the
   *  operator side, regardless of whether it's presenting yet. Nothing below the service picker
   *  is meaningful before this is true, so it's the gate for all of it. */
  serviceOpen: boolean
  slides: SlideSummary[]
  currentLabel?: string
  isBlankScreen: boolean
  backgroundOnly: boolean
  /** True when the adaptive layout (App.vue) has freed up extra vertical room by shrinking the
   *  mirror to the real display's own aspect ratio — the slide picker defaults open rather than
   *  collapsed behind a tap, and its list is allowed to grow into that room. */
  spacious?: boolean
}>()

const { pending, sendAction } = useRemoteAction()
</script>

<template>
  <div class="full-control">
    <template v-if="serviceOpen">
      <button
        type="button"
        class="present-toggle"
        :class="{ live: isPresenting }"
        :disabled="pending"
        @click="sendAction('toggle-presenting')"
      >
        {{ isPresenting ? 'Stop Presenting' : 'Start Presenting' }}
      </button>
      <PrevNextBar :enabled="serviceOpen" />
      <div class="override-row">
        <button
          type="button"
          class="override-btn"
          :class="{ active: isBlankScreen }"
          :disabled="!isPresenting || pending"
          @click="sendAction('toggle-blank-screen')"
        >
          {{ isBlankScreen ? 'Restore Screen' : 'Blank Screen' }}
        </button>
        <button
          type="button"
          class="override-btn"
          :class="{ active: backgroundOnly }"
          :disabled="!isPresenting || pending"
          @click="sendAction('toggle-background-only')"
        >
          Background Only
        </button>
      </div>
      <SlidePicker class="picker-slot" :slides="slides" :current-label="currentLabel" :spacious="spacious" />
    </template>
    <!-- Nothing to start/advance/blank until a service is actually open — see serviceOpen's
         own doc comment above. -->
    <ServicePicker v-else />
  </div>
</template>

<style scoped>
.full-control {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.picker-slot {
  flex: 1;
  min-height: 0;
}
.present-toggle {
  margin: var(--ws-space-3) var(--ws-space-4) 0;
  padding: var(--ws-space-3);
  border: none;
  border-radius: var(--ws-radius-md);
  background: var(--ws-success);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--ws-transition-fast),
    opacity var(--ws-transition-fast);
  -webkit-tap-highlight-color: transparent;
}
.present-toggle:active:not(:disabled) {
  opacity: 0.85;
}
.present-toggle:disabled {
  opacity: 0.6;
  cursor: default;
}
.present-toggle.live {
  background: var(--ws-error);
}
.override-row {
  display: flex;
  gap: var(--ws-space-2);
  padding: 0 var(--ws-space-4) var(--ws-space-3);
}
.override-btn {
  flex: 1;
  padding: var(--ws-space-2);
  border: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
  border-radius: var(--ws-radius-md);
  background: transparent;
  color: var(--ws-text);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--ws-transition-fast),
    opacity var(--ws-transition-fast);
  -webkit-tap-highlight-color: transparent;
}
.override-btn:active:not(:disabled) {
  opacity: 0.8;
}
.override-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.override-btn.active {
  background: var(--ws-primary);
  border-color: var(--ws-primary);
}

@media (max-width: 480px) {
  .present-toggle {
    margin: var(--ws-space-2) var(--ws-space-3) 0;
    padding: var(--ws-space-2);
    font-size: 0.9rem;
  }
  .override-row {
    padding: 0 var(--ws-space-3) var(--ws-space-2);
  }
}
</style>
