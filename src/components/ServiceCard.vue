<script setup lang="ts">
import { computed } from 'vue'
import type { Service } from '@/models/service'

const props = defineProps<{
  service: Service
  badge?: string
}>()
const emit = defineEmits<{ delete: [] }>()

const dateLabel = computed(() =>
  new Date(`${props.service.date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  }),
)

// Sermon title + key passage + preacher, combined on one line per spec section 9's
// three-line service card layout.
const subtitle = computed(() =>
  [props.service.sermonTitle, props.service.keyPassage, props.service.preacher].filter(Boolean).join(' · '),
)

const songCount = computed(() => props.service.items.filter((item) => item.type === 'song').length)

const statusLabel = computed(() => (props.service.items.length === 0 ? 'not yet started' : 'draft'))
</script>

<template>
  <v-card
    :to="`/service/${service.id}`"
    variant="outlined"
    rounded="lg"
    class="service-card mb-2"
    :class="{ 'service-card--highlight': badge }"
  >
    <v-card-item>
      <template #append>
        <v-chip v-if="badge" color="secondary" size="small" variant="outlined" class="font-weight-medium mr-2">
          {{ badge }}
        </v-chip>
        <v-btn
          icon="mdi-trash-can-outline"
          variant="flat"
          color="error"
          size="small"
          class="row-remove"
          @click.stop.prevent="emit('delete')"
        />
      </template>
      <v-card-title class="text-body-1 font-weight-bold">{{ service.type }} — {{ dateLabel }}</v-card-title>
      <v-card-subtitle v-if="subtitle" class="text-primary opacity-100">{{ subtitle }}</v-card-subtitle>
      <div class="text-caption text-medium-emphasis mt-1">
        {{ songCount }} song{{ songCount === 1 ? '' : 's' }} · {{ statusLabel }}
      </div>
    </v-card-item>
  </v-card>
</template>

<style scoped>
.service-card {
  transition: border-color 0.12s ease;
}
.service-card:hover {
  border-color: rgb(var(--v-theme-primary));
}
.service-card--highlight {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.row-remove {
  opacity: 0;
}
.service-card:hover .row-remove {
  opacity: 1;
}
</style>
