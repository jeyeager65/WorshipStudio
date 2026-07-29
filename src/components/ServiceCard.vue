<script setup lang="ts">
import { computed } from 'vue'
import type { Service } from '@/models/service'
import { findSermonItem, sermonMainReference } from '@/utils/sermonInfo'

const props = defineProps<{
  service: Service
  badge?: string
  /** Resolved by the parent (see LandingView) from the sermon item's role/assignments — kept a
   *  dumb presentational prop here rather than this card reaching into the people store itself. */
  preacherName?: string
}>()
const emit = defineEmits<{ delete: [] }>()

const dateLabel = computed(() =>
  new Date(`${props.service.date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  }),
)

// Sermon title + main passage + preacher, combined on one line per spec section 9's
// three-line service card layout.
const subtitle = computed(() => {
  const sermonItem = findSermonItem(props.service)
  const passage = sermonItem ? sermonMainReference(sermonItem) : ''
  return [sermonItem?.title, passage, props.preacherName].filter(Boolean).join(' · ')
})

const songCount = computed(() => props.service.items.filter((item) => item.type === 'song').length)

const statusLabel = computed(() => (props.service.items.length === 0 ? 'not yet started' : 'draft'))

// Distinct background per date bucket — today's service should stand out at a glance from the
// pile of past/future ones on the same page (Home tab shows Today + Upcoming together).
const dateStatus = computed<'today' | 'future' | 'past'>(() => {
  const todayIso = new Date().toISOString().slice(0, 10)
  if (props.service.date === todayIso) return 'today'
  return props.service.date > todayIso ? 'future' : 'past'
})
</script>

<template>
  <v-card
    :to="`/service/${service.id}`"
    variant="outlined"
    rounded="lg"
    class="service-card mb-2"
    :class="`service-card--${dateStatus}`"
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
.service-card--today {
  background: rgba(var(--v-theme-amber), 0.22);
  border-color: rgb(var(--v-theme-amber));
  border-left: 4px solid rgb(var(--v-theme-amber));
}
.service-card--future {
  background: rgba(var(--v-theme-teal), 0.22);
  border-color: rgb(var(--v-theme-teal));
  border-left: 4px solid rgb(var(--v-theme-teal));
}
.service-card--past {
  background: rgba(var(--v-theme-slate), 0.22);
  border-color: rgb(var(--v-theme-slate));
  border-left: 4px solid rgb(var(--v-theme-slate));
}
.row-remove {
  opacity: 0;
}
.service-card:hover .row-remove {
  opacity: 1;
}
</style>
