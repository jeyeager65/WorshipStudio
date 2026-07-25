<script setup lang="ts">
import { useUndoStore } from '@/stores/undo'

const store = useUndoStore()
</script>

<template>
  <div class="undo-stack" :style="{ bottom: `${16 + store.bottomOffsetPx}px` }">
    <transition-group name="undo-toast">
      <div v-for="toast in store.toasts" :key="toast.id" class="undo-toast">
        <span class="undo-toast-message">{{ toast.message }}</span>
        <v-btn variant="text" color="primary" size="small" density="comfortable" @click="store.undo(toast.id)">
          Undo
        </v-btn>
        <v-btn icon="mdi-close" variant="text" size="x-small" density="comfortable" @click="store.dismiss(toast.id)" />
        <div class="undo-toast-progress" :style="{ animationDuration: `${toast.durationMs}ms` }" />
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
/* Bottom-center, newest closest to the anchor and older toasts pushed upward above it
   (spec section 16: "multiple toasts stack, most recent on top"). Toasts are unshifted
   into the store array (index 0 = newest); column-reverse then renders index 0 nearest
   the bottom edge with later (older) entries stacking above it. */
.undo-stack {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  z-index: 3000;
  pointer-events: none;
}
.undo-toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 8px;
  padding: 6px 8px 6px 16px;
  min-width: 320px;
  max-width: 480px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  pointer-events: auto;
}
.undo-toast-message {
  flex-grow: 1;
  font-size: 13.5px;
}
.undo-toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: rgb(var(--v-theme-primary));
  width: 100%;
  animation-name: undo-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes undo-countdown {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}
.undo-toast-enter-active,
.undo-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.undo-toast-enter-from,
.undo-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
