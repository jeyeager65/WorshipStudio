<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Service } from '@/models/service'
import { findSermonItem, sermonMainReference } from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'
import { localCalendarDate } from '@/utils/calendarDate'
import { isServiceIncomplete } from '@/utils/serviceStatus'
import { isPlanningSongSlot } from '@/utils/planningSongs'

const router = useRouter()

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

const dateParts = computed(() => {
  const date = new Date(`${props.service.date}T00:00:00`)
  return {
    month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
  }
})
const timeLabel = computed(() => formatServiceTime(props.service.time) ?? 'Time Not Set')

// Sermon title + main passage + preacher, combined on one line per spec section 9's
// three-line service card layout.
const subtitle = computed(() => {
  const sermonItem = findSermonItem(props.service)
  const passage = sermonItem ? sermonMainReference(sermonItem) : ''
  return [sermonItem?.title, passage, props.preacherName].filter(Boolean).join(' · ')
})

const songSlots = computed(() => props.service.items.filter(isPlanningSongSlot))
const filledSongCount = computed(
  () => songSlots.value.filter((item) => item.type === 'song').length,
)
const assignmentCount = computed(() => props.service.assignments?.length ?? 0)
const filledAssignmentCount = computed(
  () => props.service.assignments?.filter((assignment) => !!assignment.personId).length ?? 0,
)
const songProgressLabel = computed(() =>
  songSlots.value.length
    ? `${filledSongCount.value} of ${songSlots.value.length} songs`
    : '0 songs',
)
const assignmentProgressLabel = computed(() =>
  assignmentCount.value
    ? `${filledAssignmentCount.value} of ${assignmentCount.value} assigned`
    : 'No assignments',
)
const hasAppliedTemplate = computed(() => !!props.service.serviceTemplateName?.trim())

const statusLabel = computed(() => {
  if (props.service.items.length === 0) return 'not yet started'
  if (isServiceIncomplete(props.service)) return 'incomplete'
  return 'planned'
})

// Distinct background per date bucket — today's service should stand out at a glance from the
// pile of past/future ones on the same page (Home tab shows Today + Upcoming together).
const dateStatus = computed<'today' | 'future' | 'past'>(() => {
  const todayIso = localCalendarDate()
  if (props.service.date === todayIso) return 'today'
  return props.service.date > todayIso ? 'future' : 'past'
})

function openWorkspace() {
  void router.push(`/service/${props.service.id}`)
}

function openPlan() {
  void router.push(`/service/${props.service.id}/plan`)
}
</script>

<template>
  <v-card
    variant="outlined"
    rounded="lg"
    class="service-card"
    :class="`service-card--${dateStatus}`"
    tabindex="0"
    @click="openWorkspace"
    @keydown.enter="openWorkspace"
  >
    <div class="service-card-content">
      <div class="service-date" aria-hidden="true">
        <span>{{ dateParts.month }}</span>
        <strong>{{ dateParts.day }}</strong>
        <small>{{ dateParts.weekday }}</small>
      </div>
      <div class="service-identity">
        <div class="service-title-row">
          <h3>{{ service.type }}</h3>
          <span v-if="badge" class="today-badge">{{ badge }}</span>
        </div>
        <p class="service-full-date">{{ dateLabel }} <span>·</span> {{ timeLabel }}</p>
        <p v-if="subtitle" class="service-sermon">
          <v-icon icon="mdi-book-open-page-variant-outline" size="16" />{{ subtitle }}
        </p>
        <p v-else class="service-sermon service-sermon--empty">No sermon details yet</p>
      </div>
      <div class="service-counts">
        <span class="service-state" :class="`service-state--${dateStatus}`"
          ><i />{{ statusLabel }}</span
        >
        <span
          class="service-template-status"
          :title="service.serviceTemplateName || 'No template applied'"
          ><v-icon icon="mdi-file-tree-outline" size="17" />{{
            service.serviceTemplateName || 'No template applied'
          }}</span
        >
        <span v-if="hasAppliedTemplate"
          ><v-icon icon="mdi-music-note-outline" size="17" />{{ songProgressLabel }}</span
        >
        <span v-if="hasAppliedTemplate"
          ><v-icon icon="mdi-account-check-outline" size="17" />{{ assignmentProgressLabel }}</span
        >
      </div>
      <div class="service-actions">
        <v-btn
          color="primary"
          variant="tonal"
          size="small"
          prepend-icon="mdi-calendar-edit-outline"
          @click.stop="openPlan"
        >
          Plan
        </v-btn>
      </div>
      <v-btn
        icon="mdi-trash-can-outline"
        variant="text"
        color="error"
        size="small"
        class="row-remove"
        aria-label="Delete service"
        @click.stop.prevent="emit('delete')"
      />
    </div>
  </v-card>
</template>

<style scoped>
.service-card {
  --date-color: rgb(var(--v-theme-teal));
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-left: 3px solid var(--date-color);
  background: rgba(var(--v-theme-background), 0.34);
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
.service-card:hover,
.service-card:focus-visible {
  border-color: color-mix(in srgb, var(--date-color) 38%, transparent);
  background: color-mix(in srgb, var(--date-color) 4.5%, rgba(var(--v-theme-background), 0.34));
  box-shadow: 0 9px 24px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}
.service-card--today {
  --date-color: rgb(var(--v-theme-amber));
}
.service-card--future {
  --date-color: rgb(var(--v-theme-teal));
}
.service-card--past {
  --date-color: rgb(var(--v-theme-slate));
  opacity: 0.82;
}
.service-card-content {
  display: grid;
  min-height: 104px;
  grid-template-columns: 60px minmax(220px, 1fr) 180px 88px 36px;
  align-items: center;
  gap: 15px;
  padding: 11px 12px 11px 15px;
}
.service-date {
  display: flex;
  width: 58px;
  height: 72px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--date-color) 24%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--date-color) 10%, transparent);
}
.service-date span {
  color: var(--date-color);
  font-size: 0.65rem;
  font-weight: 750;
  letter-spacing: 0.07em;
}
.service-date strong {
  margin: 1px 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.3rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.service-date small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
}
.service-identity {
  min-width: 0;
}
.service-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}
.service-title-row h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.012em;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.today-badge {
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-amber), 0.28);
  border-radius: 5px;
  background: rgba(var(--v-theme-amber), 0.1);
  color: rgb(var(--v-theme-amber));
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.05em;
}
.service-full-date {
  margin: 2px 0 5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}
.service-full-date span {
  margin: 0 2px;
  color: rgba(var(--v-theme-on-surface), 0.28);
}
.service-sermon {
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-sermon .v-icon {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.service-sermon--empty {
  color: rgba(var(--v-theme-on-surface), 0.36);
}
.service-counts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.72rem;
}
.service-counts span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.service-template-status {
  min-width: 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-state {
  display: flex;
  align-items: center;
  gap: 7px;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.7rem;
  font-weight: 650;
  text-transform: capitalize;
}
.service-state > i {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--date-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--date-color) 12%, transparent);
}
.service-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.service-actions :deep(.v-btn) {
  text-transform: none;
}
.row-remove {
  opacity: 0;
}
.service-card:hover .row-remove,
.row-remove:focus-visible {
  opacity: 1;
}
@media (max-width: 760px) {
  .service-card-content {
    grid-template-columns: 60px minmax(0, 1fr) 76px 36px;
  }
  .service-counts {
    display: none;
  }
  .row-remove {
    opacity: 0.75;
  }
}
@media (max-width: 480px) {
  .service-card-content {
    grid-template-columns: 52px minmax(0, 1fr) 32px;
    gap: 11px;
    padding-left: 10px;
  }
  .service-date {
    width: 50px;
    height: 66px;
  }
  .service-actions {
    display: none;
  }
}
</style>
