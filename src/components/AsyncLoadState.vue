<script setup lang="ts">
defineProps<{
  loading: boolean
  error?: string
  label?: string
  compact?: boolean
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <v-alert
    v-if="error"
    type="error"
    variant="tonal"
    :density="compact ? 'compact' : 'comfortable'"
    class="async-load-error"
  >
    <div class="async-load-error__content">
      <div>
        <strong>Could not load {{ label || 'this content' }}</strong>
        <p>{{ error }}</p>
      </div>
      <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" @click="$emit('retry')">
        Retry
      </v-btn>
    </div>
  </v-alert>
  <div v-else-if="loading" class="async-loading" :class="{ 'async-loading--compact': compact }">
    <v-progress-circular indeterminate color="primary" size="28" width="3" />
    <span>Loading {{ label || 'content' }}…</span>
  </div>
</template>

<style scoped>
.async-load-error__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.async-load-error__content p {
  margin: 3px 0 0;
  font-size: 0.8rem;
  opacity: 0.82;
  overflow-wrap: anywhere;
}
.async-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.84rem;
}
.async-loading--compact {
  min-height: 100px;
}
@media (max-width: 560px) {
  .async-load-error__content {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
