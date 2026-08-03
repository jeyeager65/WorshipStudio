<script setup lang="ts">
defineProps<{ error: string }>()
defineEmits<{ retry: []; skip: [] }>()
</script>

<template>
  <!-- Operator-only, never shown to the congregation (spec section 12) — the audience display
       stays on whatever was live before. A fixed, centered overlay (rather than inline in the
       page flow) so it always reads as a compact card regardless of surrounding layout, instead
       of stretching to fill whatever flex space it happened to land in. The backdrop itself
       ignores clicks so the rest of the workspace stays usable while this is up. -->
  <div class="external-app-alert-overlay">
    <v-alert type="warning" variant="elevated" density="compact" class="external-app-alert">
      <div class="mb-2">⚠️ {{ error }}</div>
      <div class="d-flex justify-end ga-2">
        <v-btn variant="flat" size="small" color="white" @click="$emit('retry')">Try Again</v-btn>
        <v-btn variant="text" size="small" @click="$emit('skip')">Skip</v-btn>
      </div>
    </v-alert>
  </div>
</template>

<style scoped>
.external-app-alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.external-app-alert {
  pointer-events: auto;
  width: 90%;
  max-width: 480px;
}
</style>
