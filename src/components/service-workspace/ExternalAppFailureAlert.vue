<script setup lang="ts">
defineProps<{ error: string }>()
defineEmits<{ retry: []; skip: [] }>()
</script>

<template>
  <!-- Operator-only, never shown to the congregation (spec section 12) — the audience display
       stays on whatever was live before. -->
  <v-alert type="warning" variant="elevated" density="compact" class="external-app-alert">
    <div class="d-flex align-center ga-3">
      <span>⚠️ {{ error }}</span>
      <v-spacer />
      <v-btn variant="flat" size="small" color="white" @click="$emit('retry')">Try Again</v-btn>
      <v-btn variant="text" size="small" @click="$emit('skip')">Skip</v-btn>
    </div>
  </v-alert>
</template>

<style scoped>
.external-app-alert {
  flex-shrink: 0;
  margin: 0 20px 10px;
}
</style>
