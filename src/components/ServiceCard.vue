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
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
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
      <v-card-subtitle v-if="subtitle" class="subtitle-accent opacity-100">{{ subtitle }}</v-card-subtitle>
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
/* Vuetify's real v-card-subtitle size (0.875rem) reads smaller than the plain caption div
   below it, since that div's "text-caption" class isn't an actual Vuetify utility in this
   build and just inherits the app's root font-size (see base.css) instead of a true small
   caption size — matching that same root-relative size here rather than chasing Vuetify's
   own (smaller) subtitle default. */
.subtitle-accent {
  font-size: 1rem;
  color: color-mix(in srgb, rgb(var(--v-theme-primary)) 35%, white);
}
.row-remove {
  opacity: 0;
}
.service-card:hover .row-remove {
  opacity: 1;
}
</style>
