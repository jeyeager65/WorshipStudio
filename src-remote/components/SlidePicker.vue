<script setup lang="ts">
import { ref } from 'vue'
import { useRemoteAction } from '../composables/useRemoteAction'
import type { SlideSummary } from '../composables/usePoll'

const props = defineProps<{
  slides: SlideSummary[]
  /** `${content.itemLabel} — ${content.subLabel}` of whatever's currently live, to highlight
   *  the matching entry — the server doesn't expose a live index directly, but this format is
   *  the exact same one the labels themselves are built from (see describeSlide() in
   *  useLiveTransport.ts), so a plain string match is enough without adding another field. */
  currentLabel?: string
  /** See App.vue's own doc comment — true when the adaptive layout freed up real vertical room
   *  for this panel rather than squeezing it below a full-bleed mirror. Defaults the panel open
   *  so that room is actually used instead of requiring an extra tap first. */
  spacious?: boolean
}>()

const { pending, sendAction } = useRemoteAction()
const expanded = ref(!!props.spacious)

function pick(index: number) {
  void sendAction('goto', { index })
  // Spacious mode has its own dedicated, permanent room for this panel (not an overlay) — no
  // reason to collapse it after every tap, unlike the cramped/side-by-side case where it's
  // still worth reclaiming the space.
  if (!props.spacious) expanded.value = false
}
</script>

<template>
  <div class="slide-picker">
    <button type="button" class="toggle" @click="expanded = !expanded">
      <span>Slides ({{ props.slides.length }})</span>
      <span class="chevron" :class="{ open: expanded }" aria-hidden="true">&#8250;</span>
    </button>
    <div v-if="expanded" class="panel">
      <button
        v-for="slide in props.slides"
        :key="slide.index"
        type="button"
        class="slide-row"
        :class="{ current: slide.label === props.currentLabel }"
        :disabled="pending"
        @click="pick(slide.index)"
      >
        {{ slide.label }}
      </button>
      <p v-if="props.slides.length === 0" class="empty">No slides in this service.</p>
    </div>
  </div>
</template>

<style scoped>
.slide-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-top: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
}
.toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ws-space-3) var(--ws-space-4);
  border: none;
  background: transparent;
  color: var(--ws-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chevron {
  display: inline-block;
  transform: rotate(90deg);
  transition: transform var(--ws-transition-fast);
  color: var(--ws-text-secondary);
}
.chevron.open {
  transform: rotate(-90deg);
}
.panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--ws-space-2) var(--ws-space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slide-row {
  text-align: left;
  padding: var(--ws-space-2) var(--ws-space-3);
  border: none;
  border-radius: var(--ws-radius-sm);
  background: transparent;
  color: var(--ws-text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.slide-row:active:not(:disabled) {
  background: var(--ws-surface-variant);
}
.slide-row.current {
  background: var(--ws-surface-variant);
  color: var(--ws-text);
  font-weight: 600;
}
.empty {
  padding: var(--ws-space-3);
  color: var(--ws-text-secondary);
  font-size: 0.85rem;
  margin: 0;
}
</style>
