<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useSongsStore } from '@/stores/songs'
import { groupUpcomingByMonth, hasStarted, needsPreacher } from '@/utils/planningAhead'
import { personFormalName } from '@/models/library'
import type { Service } from '@/models/service'
import { applySermonEdit, defaultSermonRole, findSermonItem, sermonMainReference, sermonPreacherId } from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'
import { localCalendarDate } from '@/utils/calendarDate'
import FiveMinuteTimePicker from '@/components/FiveMinuteTimePicker.vue'

const store = useServicesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const songsStore = useSongsStore()
const router = useRouter()

onMounted(() => {
  if (!store.loaded) store.load()
  if (!peopleStore.loaded) peopleStore.load()
  if (!settingsStore.loaded) settingsStore.load()
  if (!songsStore.loaded) songsStore.load()
})

function preacherName(service: Service): string | undefined {
  const person = peopleStore.people.find((p) => p.id === sermonPreacherId(service))
  return person ? personFormalName(person) : undefined
}

const todayIso = () => localCalendarDate()

const months = computed(() => groupUpcomingByMonth(store.services, todayIso()))
const monthIndex = ref(0)
const currentMonth = computed(() => months.value[monthIndex.value])
const upcomingServiceCount = computed(() =>
  months.value.reduce((total, month) => total + month.services.length, 0),
)
const needsPreacherCount = computed(
  () => months.value.flatMap((month) => month.services).filter(needsPreacher).length,
)
const notStartedCount = computed(
  () =>
    months.value.flatMap((month) => month.services).filter((service) => !hasStarted(service))
      .length,
)

function serviceDateParts(service: Service) {
  const date = new Date(`${service.date}T00:00:00`)
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    full: `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${formatServiceTime(service.time) ?? 'Time Not Set'}`,
  }
}

function sermonTitle(service: Service): string | undefined {
  return findSermonItem(service)?.title
}

function openService(serviceId: string) {
  router.push(`/service/${serviceId}`)
}

const planDialog = ref(false)
const createPlanDialog = ref(false)
const planningService = ref<Service>()
const planningSermonTitle = ref('')
const planningPassage = ref('')
const planningPreacherId = ref<string>()
const savingPlan = ref(false)
const creatingPlan = ref(false)
const newPlanDate = ref(localCalendarDate())
const newPlanTime = ref('')
const newPlanType = ref('')

const preacherOptions = computed(() =>
  peopleStore.people.map((person) => ({ title: personFormalName(person), value: person.id })),
)
const plannedSongs = computed(() => {
  const service = planningService.value
  if (!service) return []
  return (service.planningSongIds ?? []).map((songId) => ({ songId, song: songsStore.songs.find((song) => song.id === songId) }))
})

function openPlan(service: Service) {
  router.push(`/planning-ahead/${service.id}`)
}

function beginCreatePlan() {
  newPlanDate.value = localCalendarDate()
  newPlanTime.value = ''
  newPlanType.value = settingsStore.librarySettings?.serviceTypes[0] ?? ''
  createPlanDialog.value = true
}

async function createPlan() {
  if (!newPlanDate.value || !newPlanType.value || creatingPlan.value) return
  creatingPlan.value = true
  try {
    const service: Service = {
      id: `service-${crypto.randomUUID()}`,
      date: newPlanDate.value,
      time: newPlanTime.value || undefined,
      type: newPlanType.value,
      items: [],
      assignments: [],
      updatedAt: '',
      updatedByDevice: '',
    }
    await store.save(service)
    createPlanDialog.value = false
    router.push(`/planning-ahead/${service.id}`)
  } finally {
    creatingPlan.value = false
  }
}

function removePlannedSong(songId: string) {
  const service = planningService.value
  if (!service) return
  service.planningSongIds = service.planningSongIds?.filter((id) => id !== songId)
}

async function savePlan() {
  const service = planningService.value
  if (!service || savingPlan.value) return
  savingPlan.value = true
  try {
    if (planningSermonTitle.value || planningPassage.value || planningPreacherId.value || findSermonItem(service)) {
      applySermonEdit(
        service,
        {
          title: planningSermonTitle.value,
          passageReference: planningPassage.value,
          preacherId: planningPreacherId.value,
        },
        defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, service.type),
        settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
      )
    }
    service.planningNotes = service.planningNotes?.trim() || undefined
    await store.save(service)
    planDialog.value = false
  } finally {
    savingPlan.value = false
  }
}

async function chooseSongs() {
  const service = planningService.value
  if (!service) return
  await savePlan()
  router.push({ path: '/library/songs', query: { selectFor: service.id, returnTo: '/planning-ahead' } })
}
</script>

<template>
  <main class="planning-page">
    <header class="planning-hero">
      <div class="hero-copy">
        <v-btn to="/" variant="text" prepend-icon="mdi-arrow-left" class="back-button"
          >Services</v-btn
        >
        <div class="page-eyebrow">Long-Range Planning</div>
        <h1>Planning Ahead</h1>
        <p>
          See what is coming, identify missing details, and begin preparing services before the full
          order is ready. Plan songs, sermon details, and notes here; use the full service only
          when you are ready for the complete order and assignments.
        </p>
      </div>
      <div class="hero-side">
        <div class="planning-summary" aria-label="Upcoming planning summary">
          <div class="summary-stat">
            <strong>{{ upcomingServiceCount }}</strong
            ><span>Services</span>
          </div>
          <div class="summary-stat summary-stat--warning">
            <strong>{{ needsPreacherCount }}</strong
            ><span>Need Preacher</span>
          </div>
          <div class="summary-stat">
            <strong>{{ notStartedCount }}</strong
            ><span>Not Started</span>
          </div>
        </div>
        <div class="hero-actions">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" to="/create-service">Create Service</v-btn>
        </div>
      </div>
    </header>

    <section v-if="months.length" class="planning-workspace">
      <aside class="month-navigation" aria-label="Upcoming service months">
        <div class="month-navigation-heading">
          <span>Schedule</span>
          <small>{{ months.length }} {{ months.length === 1 ? 'month' : 'months' }}</small>
        </div>
        <button
          v-for="(month, index) in months"
          :key="month.monthKey"
          type="button"
          class="month-option"
          :class="{ 'month-option--active': monthIndex === index }"
          :aria-pressed="monthIndex === index"
          @click="monthIndex = index"
        >
          <span class="month-icon"><v-icon icon="mdi-calendar-month-outline" size="19" /></span>
          <span class="month-label">{{ month.monthLabel }}</span>
          <strong>{{ month.services.length }}</strong>
        </button>
      </aside>

      <div class="planning-content">
        <div class="month-toolbar">
          <div>
            <div class="month-kicker">Upcoming Services</div>
            <h2>{{ currentMonth?.monthLabel }}</h2>
            <p>
              {{ currentMonth?.services.length }}
              {{ currentMonth?.services.length === 1 ? 'service' : 'services' }} scheduled
            </p>
          </div>
          <div class="month-controls">
            <v-btn
              icon="mdi-chevron-left"
              variant="text"
              :disabled="monthIndex === 0"
              aria-label="Previous month"
              @click="monthIndex--"
            />
            <span>{{ monthIndex + 1 }} of {{ months.length }}</span>
            <v-btn
              icon="mdi-chevron-right"
              variant="text"
              :disabled="monthIndex >= months.length - 1"
              aria-label="Next month"
              @click="monthIndex++"
            />
          </div>
        </div>

        <div class="planning-columns" aria-hidden="true">
          <span>Service</span><span>Sermon</span><span>Preacher</span><span>Planning</span><span />
        </div>
        <div class="planning-list">
          <article
            v-for="service in currentMonth?.services"
            :key="service.id"
            class="planning-row"
          >
            <div class="service-cell">
              <div class="date-tile">
                <span>{{ serviceDateParts(service).weekday }}</span>
                <strong>{{ serviceDateParts(service).day }}</strong>
                <small>{{ serviceDateParts(service).month }}</small>
              </div>
              <div class="service-identity">
                <h3>{{ service.type }}</h3>
                <p>{{ serviceDateParts(service).full }}</p>
              </div>
            </div>
            <div class="planning-detail">
              <span class="mobile-label">Sermon</span>
              <strong v-if="sermonTitle(service)">{{ sermonTitle(service) }}</strong>
              <span v-else class="missing-detail"
                ><v-icon icon="mdi-alert-circle-outline" size="16" />Title Not Decided</span
              >
            </div>
            <div class="planning-detail">
              <span class="mobile-label">Preacher</span>
              <strong v-if="!needsPreacher(service)">{{ preacherName(service) }}</strong>
              <span v-else class="missing-detail"
                ><v-icon icon="mdi-account-alert-outline" size="16" />Needs Preacher</span
              >
            </div>
            <div>
              <div class="planning-actions">
                <span
                  class="planning-state"
                  :class="{ 'planning-state--started': hasStarted(service) }"
                >
                  <i />{{ hasStarted(service) ? 'Started' : 'Not Started' }}
                </span>
                <span v-if="service.planningNotes" class="planning-note-indicator">
                  <v-icon icon="mdi-note-text-outline" size="14" /> Note added
                </span>
                <v-btn size="small" variant="tonal" color="primary" @click="openPlan(service)">
                  Plan Service
                </v-btn>
              </div>
            </div>
            <v-btn
              icon="mdi-arrow-top-right"
              variant="text"
              size="small"
              class="open-service-button"
              aria-label="Open full service workspace"
              title="Open full service workspace"
              @click="openService(service.id)"
            />
          </article>
        </div>
      </div>
    </section>

    <section v-else class="planning-empty">
      <span><v-icon icon="mdi-calendar-plus-outline" size="34" /></span>
      <h2>No Upcoming Services</h2>
      <p>Create a service to start planning songs, details, and assignments.</p>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" to="/create-service">Create Service</v-btn>
    </section>

    <v-dialog v-model="createPlanDialog" max-width="520">
      <v-card>
        <v-card-title>Create a Plan</v-card-title>
        <v-card-subtitle>Start with the basics. Songs, notes, and sermon details can come next.</v-card-subtitle>
        <v-card-text class="create-plan-content">
          <v-row>
            <v-col cols="12" sm="6">
              <v-text-field v-model="newPlanDate" type="date" label="Service Date" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="6">
              <five-minute-time-picker v-model="newPlanTime" label="Start Time" />
            </v-col>
          </v-row>
          <v-select
            v-model="newPlanType"
            :items="settingsStore.librarySettings?.serviceTypes ?? []"
            label="Service Type"
            variant="outlined"
            no-data-text="No service types configured"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createPlanDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!newPlanDate || !newPlanType" :loading="creatingPlan" @click="createPlan">
            Create and Plan
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="planDialog" max-width="760" scrollable>
      <v-card v-if="planningService">
        <v-card-title>Plan {{ planningService.type }}</v-card-title>
        <v-card-subtitle>
          Build only what you know now. Open the full service when you are ready for assignments and the order of worship.
        </v-card-subtitle>
        <v-card-text class="plan-dialog-content">
          <v-row>
            <v-col cols="12" sm="6">
              <v-text-field v-model="planningSermonTitle" label="Sermon Title" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="planningPreacherId" :items="preacherOptions" label="Preacher" variant="outlined" clearable />
            </v-col>
          </v-row>
          <v-text-field v-model="planningPassage" label="Main Passage" placeholder="e.g. Matthew 6:9-13" variant="outlined" />
          <v-textarea
            v-model="planningService.planningNotes"
            label="Planning Notes"
            placeholder="Ideas, reminders, themes, or details to work out later"
            variant="outlined"
            rows="3"
            auto-grow
          />

          <div class="plan-section-heading">
            <div><h3>Planned Songs</h3><p>Browse by theme or search the library. Selecting a song adds it to this plan.</p></div>
          </div>
          <div v-if="plannedSongs.length" class="planned-song-list">
            <div v-for="entry in plannedSongs" :key="entry.songId" class="planned-song-row">
              <v-icon icon="mdi-music-note-outline" size="19" />
              <span>{{ entry.song?.title ?? 'Unavailable song' }}</span>
              <v-btn icon="mdi-close" size="x-small" variant="text" aria-label="Remove song" @click="removePlannedSong(entry.songId)" />
            </div>
          </div>
          <p v-else class="no-planned-songs">No songs selected yet.</p>

          <v-btn class="browse-songs-button" prepend-icon="mdi-music-note-plus" variant="tonal" color="primary" @click="chooseSongs">
            Choose Songs from Library
          </v-btn>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="planDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="savingPlan" @click="savePlan">Save Plan</v-btn>
          <v-btn variant="tonal" @click="openService(planningService.id)">Open Full Service</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </main>
</template>

<style scoped>
.planning-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 76% 0, rgba(var(--v-theme-primary), 0.05), transparent 440px),
    rgb(var(--v-theme-background));
}
.planning-hero,
.planning-workspace,
.planning-empty {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.planning-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 18px;
  padding: 18px 28px 27px;
}
.back-button {
  margin: 0 0 7px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  text-transform: none;
}
.page-eyebrow,
.month-kicker {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.planning-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.planning-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.82rem;
  line-height: 1.5;
}
.hero-side {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.planning-summary {
  display: flex;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 90px;
  flex-direction: column;
  align-items: center;
  padding: 10px 12px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.08rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat--warning strong {
  color: rgb(var(--v-theme-warning));
}
.summary-stat span {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.64rem;
  font-weight: 680;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.planning-workspace {
  display: grid;
  min-height: 500px;
  grid-template-columns: 225px minmax(0, 1fr);
  overflow: hidden;
}
.month-navigation {
  padding: 15px 11px 20px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.month-navigation-heading {
  display: flex;
  flex-direction: column;
  padding: 0 9px 12px;
}
.month-navigation-heading span {
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 0.78rem;
  font-weight: 700;
}
.month-navigation-heading small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.66rem;
}
.month-option {
  display: grid;
  width: 100%;
  min-height: 44px;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 5px 8px 5px 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.month-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.88);
}
.month-option--active {
  border-color: rgba(var(--v-theme-primary), 0.22);
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.month-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 6px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.month-label {
  overflow: hidden;
  font-size: 0.73rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.month-option strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.65rem;
}
.planning-content {
  min-width: 0;
}
.month-toolbar {
  display: flex;
  min-height: 90px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.month-toolbar h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.15rem;
  font-weight: 690;
}
.month-toolbar p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.72rem;
}
.month-controls {
  display: flex;
  align-items: center;
  gap: 3px;
}
.month-controls span {
  min-width: 54px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.68rem;
  text-align: center;
}
.planning-columns,
.planning-row {
  display: grid;
  grid-template-columns: minmax(240px, 1.25fr) minmax(160px, 1fr) minmax(130px, 0.75fr) 105px 24px;
  align-items: center;
  gap: 14px;
}
.planning-columns {
  min-height: 37px;
  padding: 0 15px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.planning-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px;
}
.planning-row {
  min-height: 88px;
  padding: 9px 10px 9px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.32);
}
.service-cell {
  display: grid;
  min-width: 0;
  grid-template-columns: 50px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
}
.date-tile {
  display: flex;
  width: 48px;
  height: 62px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
}
.date-tile span,
.date-tile small {
  color: rgb(var(--v-theme-primary));
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
}
.date-tile strong {
  margin: 1px 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.15rem;
  line-height: 1;
}
.date-tile small {
  color: rgba(var(--v-theme-on-surface), 0.46);
}
.service-identity {
  min-width: 0;
}
.service-identity h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 0.86rem;
  font-weight: 690;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-identity p {
  overflow: hidden;
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.planning-detail {
  min-width: 0;
}
.planning-detail strong {
  display: block;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.74rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.missing-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-warning));
  font-size: 0.7rem;
  font-weight: 620;
}
.planning-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  font-weight: 620;
}
.planning-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-slate));
}
.planning-state--started {
  color: rgba(var(--v-theme-on-surface), 0.68);
}
.planning-state--started i {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-success), 0.1);
}
.planning-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}
.planning-actions .v-btn {
  min-width: 0;
  margin-left: -8px;
  font-size: 0.68rem;
  text-transform: none;
}
.planning-note-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.66rem;
}
.planning-note-indicator .v-icon {
  color: rgb(var(--v-theme-primary));
}
.open-service-button {
  justify-self: end;
  color: rgba(var(--v-theme-on-surface), 0.48);
}
.mobile-label {
  display: none;
}
.plan-dialog-content {
  padding-top: 20px;
}
.create-plan-content {
  padding-top: 20px;
}
.plan-section-heading {
  margin: 4px 0 12px;
}
.plan-section-heading h3 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.9rem;
}
.plan-section-heading p,
.no-planned-songs {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}
.planned-song-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.planned-song-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 6px 8px 6px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.76rem;
}
.planned-song-row .v-icon {
  color: rgb(var(--v-theme-primary));
}
.planned-song-row span {
  flex: 1;
}
.browse-songs-button {
  width: 100%;
  margin-top: 14px;
  text-transform: none;
}
.planning-empty {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px;
  text-align: center;
}
.planning-empty > span {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.planning-empty h2 {
  margin: 16px 0 0;
  font-size: 1.05rem;
}
.planning-empty p {
  margin: 6px 0 18px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.78rem;
}
@media (max-width: 980px) {
  .planning-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .hero-side {
    width: 100%;
    justify-content: space-between;
  }
  .hero-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .planning-workspace {
    grid-template-columns: 190px minmax(0, 1fr);
  }
  .planning-columns,
  .planning-row {
    grid-template-columns: minmax(210px, 1.2fr) minmax(140px, 1fr) minmax(120px, 0.8fr) 24px;
  }
  .planning-columns > :nth-child(3),
  .planning-row > :nth-child(3) {
    display: none;
  }
}
@media (max-width: 760px) {
  .planning-workspace {
    grid-template-columns: 1fr;
  }
  .month-navigation {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .month-navigation-heading {
    display: none;
  }
  .month-option {
    width: auto;
    min-width: 175px;
    flex: none;
  }
}
@media (max-width: 600px) {
  .planning-page {
    padding: 16px 12px 36px;
  }
  .planning-hero {
    padding: 14px 18px 20px;
  }
  .hero-side {
    align-items: stretch;
    flex-direction: column;
  }
  .hero-actions {
    justify-content: flex-start;
  }
  .planning-summary {
    align-self: flex-start;
  }
  .planning-columns {
    display: none;
  }
  .planning-list {
    padding: 10px;
  }
  .planning-row {
    grid-template-columns: 1fr 20px;
    gap: 11px;
  }
  .planning-row > :not(.service-cell, .open-service-button) {
    grid-column: 1;
    margin-left: 61px;
  }
  .service-cell {
    grid-column: 1;
  }
  .open-service-button {
    grid-column: 2;
    grid-row: 1 / 4;
  }
  .mobile-label {
    display: block;
    margin-bottom: 2px;
    color: rgba(var(--v-theme-on-surface), 0.38);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
}
</style>
