<script setup lang="ts">
import { useRemoteAction } from '../composables/useRemoteAction'

// Named `enabled` rather than `isPresenting` — the operator's own transport bar lets Prev/Next
// cue a position before Start Presenting is even pressed (nothing about goLive() requires
// presenting to already be underway), so the real precondition is "a service is open", not
// "currently live". The caller decides what that maps to.
defineProps<{ enabled: boolean }>()

const { pending, sendAction } = useRemoteAction()
</script>

<template>
  <div class="controls-bar">
    <button
      type="button"
      class="nav-button"
      :disabled="!enabled || pending"
      @click="sendAction('previous')"
    >
      <span class="chevron" aria-hidden="true">&#8249;</span>
      <span>Previous</span>
    </button>
    <button
      type="button"
      class="nav-button"
      :disabled="!enabled || pending"
      @click="sendAction('next')"
    >
      <span>Next</span>
      <span class="chevron" aria-hidden="true">&#8250;</span>
    </button>
  </div>
</template>

<style scoped>
.controls-bar {
  display: flex;
  gap: var(--ws-space-2);
  padding: var(--ws-space-3) var(--ws-space-4);
  padding-bottom: max(var(--ws-space-3), env(safe-area-inset-bottom));
}
.nav-button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--ws-space-2);
  min-height: 64px;
  border: none;
  border-radius: var(--ws-radius-md);
  background: var(--ws-primary);
  color: #fff;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--ws-transition-fast);
  -webkit-tap-highlight-color: transparent;
}
.nav-button:active:not(:disabled) {
  opacity: 0.8;
}
.nav-button:disabled {
  background: var(--ws-surface-variant);
  color: var(--ws-text-secondary);
  cursor: default;
}
.chevron {
  font-size: 1.4rem;
  line-height: 1;
}

/* Denser on phone-width screens — same buttons, less padding/height rather than a reduced
   feature set (design decision: layout density scales with viewport, capability never does). */
@media (max-width: 480px) {
  .controls-bar {
    gap: var(--ws-space-1);
    padding: var(--ws-space-2) var(--ws-space-3);
  }
  .nav-button {
    min-height: 52px;
    font-size: 0.95rem;
  }
}
</style>
