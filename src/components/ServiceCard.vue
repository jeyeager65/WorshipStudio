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
  /** Resolved by the parent from service.serviceTypeId via the service types store — same
   *  "dumb presentational prop" reasoning as preacherName above. */
  serviceTypeName: string
  /** Resolved by the parent from service.serviceTemplateId via the service templates store —
   *  same "dumb presentational prop" reasoning as preacherName above. Undefined/empty means no
   *  template has been applied. */
  serviceTemplateName?: string
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
const hasAppliedTemplate = computed(() => !!props.serviceTemplateName?.trim())

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
          <h3>{{ serviceTypeName }}</h3>
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
          :title="serviceTemplateName || 'No template applied'"
          ><v-icon icon="mdi-file-tree-outline" size="17" />{{
            serviceTemplateName || 'No template applied'
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
      <!-- Same overflow menu the Song and People cards use (mdi-dots-horizontal, Edit above a
           text-error Delete), rather than a delete icon of its own. Consistency is the main
           reason; the other is that the icon it replaces was revealed on hover, which a touch
           screen cannot do — see the hover rules in the style block below. "Open" is redundant
           with tapping the card, and earns its place by making the menu say what the card does
           instead of offering deletion as the only listed action. -->
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-dots-horizontal"
            variant="text"
            size="small"
            class="row-actions"
            aria-label="Service actions"
            @click.stop
          />
        </template>
        <v-list density="compact">
          <v-list-item
            prepend-icon="mdi-pencil-outline"
            title="Open Service"
            @click="openWorkspace"
          />
          <v-list-item
            prepend-icon="mdi-delete-outline"
            title="Delete Service"
            class="text-error"
            @click="emit('delete')"
          />
        </v-list>
      </v-menu>
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
  /* Honest signal that this <v-card> — a plain div, not a native <a>/<button> — is clickable.
     This was once also believed to fix iOS's double-tap on these cards; it does not, and the
     real fix is the `@media (hover: hover)` gating below. Kept because it is correct on its own
     terms, not because it solves that. */
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
/* Every :hover rule for these cards is gated on a device that can actually hover. iOS applies
   :hover on the first tap; where that paints something new under the finger — the remove button
   below — WebKit treats the tap as a hover rather than a click and waits for a second one. That
   is the two-taps-to-select bug, and no amount of `cursor: pointer` addresses it, because the
   trigger is the content change, not the element's perceived clickability. */
.service-card:focus-visible {
  border-color: color-mix(in srgb, var(--date-color) 38%, transparent);
  background: color-mix(in srgb, var(--date-color) 4.5%, rgba(var(--v-theme-background), 0.34));
  box-shadow: 0 9px 24px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}
@media (hover: hover) {
  .service-card:hover {
    border-color: color-mix(in srgb, var(--date-color) 38%, transparent);
    background: color-mix(in srgb, var(--date-color) 4.5%, rgba(var(--v-theme-background), 0.34));
    box-shadow: 0 9px 24px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }
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
/* Always present, unlike the delete icon this replaced. A neutral overflow affordance can sit
   there permanently without reading as clutter or inviting an accidental delete, which is what
   made hover-reveal seem necessary in the first place — and hover-reveal is exactly what a touch
   screen cannot do. */
.row-actions {
  opacity: 0.6;
}
.row-actions:hover,
.row-actions:focus-visible {
  opacity: 1;
}
@media (max-width: 760px) {
  .service-card-content {
    grid-template-columns: 60px minmax(0, 1fr) 76px 36px;
  }
  .service-counts {
    display: none;
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
