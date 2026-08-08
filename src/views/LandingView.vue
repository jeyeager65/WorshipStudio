<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { usePeopleStore } from '@/stores/people'
import { useSongsStore } from '@/stores/songs'
import ServiceCard from '@/components/ServiceCard.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import type { Service } from '@/models/service'
import { personFormalName } from '@/models/library'
import { findSermonItem, sermonMainReference, sermonPreacherId } from '@/utils/sermonInfo'
import { formatServiceTime, serviceDateTimeSortKey } from '@/utils/serviceTime'
import { localCalendarDate } from '@/utils/calendarDate'

const store = useServicesStore()
const confirmDialog = useConfirmDialogStore()
const peopleStore = usePeopleStore()
const songsStore = useSongsStore()

async function deleteService(service: Service) {
  if (
    !(await confirmDialog.confirm(
      `Delete the "${service.type} — ${service.date}" service?`,
      'Delete',
    ))
  )
    return
  await store.remove(service.id)
  // Deleting a service silently updates any of its songs' usage stats on the backend (see
  // songs::recompute_usage) — refresh the shared songs store so that shows up immediately.
  await songsStore.load()
}
onMounted(() => {
  if (!store.loaded) store.load()
  if (!peopleStore.loaded) peopleStore.load()
})

function preacherName(service: Service): string | undefined {
  const person = peopleStore.people.find((p) => p.id === sermonPreacherId(service))
  return person ? personFormalName(person) : undefined
}

const tab = ref<'home' | 'planning' | 'browse'>('home')
const browseScope = ref<'recent' | 'all'>('recent')
const browseQuery = ref('')
const browseType = ref<string | null>(null)
const browsePreacher = ref<string | null>(null)
const browseBibleBook = ref<string | null>(null)

const todayIso = () => localCalendarDate()

const visibleServices = computed(() => store.services)

const todayServices = computed(() =>
  visibleServices.value
    .filter((service) => service.date === todayIso())
    .sort((a, b) => serviceDateTimeSortKey(a).localeCompare(serviceDateTimeSortKey(b))),
)

const allUpcomingServices = computed(() =>
  visibleServices.value
    .filter((service) => service.date > todayIso())
    .sort((a, b) => serviceDateTimeSortKey(a).localeCompare(serviceDateTimeSortKey(b))),
)
const scheduleEndIso = computed(() => {
  const end = new Date(`${todayIso()}T12:00:00`)
  end.setDate(end.getDate() + 14)
  return localCalendarDate(end)
})
const upcomingServices = computed(() =>
  allUpcomingServices.value.filter((service) => service.date <= scheduleEndIso.value),
)
const futureServiceGroups = computed(() => {
  const groups = new Map<string, Service[]>()
  for (const service of allUpcomingServices.value) {
    const key = service.date.slice(0, 7)
    const services = groups.get(key) ?? []
    services.push(service)
    groups.set(key, services)
  }
  return [...groups.entries()].map(([key, services]) => ({
    key,
    label: new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
    services,
  }))
})

const pastServices = computed(() =>
  visibleServices.value
    .filter((service) => service.date < todayIso())
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        serviceDateTimeSortKey(a).localeCompare(serviceDateTimeSortKey(b)),
    ),
)

function bibleBookFromReference(reference: string): string {
  return (
    reference
      .trim()
      .match(/^(.+?)\s+\d/)?.[1]
      ?.trim() ?? reference.trim()
  )
}

function serviceBibleBooks(service: Service): string[] {
  const sermon = findSermonItem(service)
  if (!sermon) return []
  return [
    ...new Set(
      sermon.passages.map((passage) => bibleBookFromReference(passage.reference)).filter(Boolean),
    ),
  ]
}

const allBrowseServices = computed(() =>
  [...visibleServices.value].sort((a, b) =>
    serviceDateTimeSortKey(b).localeCompare(serviceDateTimeSortKey(a)),
  ),
)
const recentServices = computed(() => pastServices.value.slice(0, 10))
const browseScopeServices = computed(() =>
  browseScope.value === 'recent' ? recentServices.value : allBrowseServices.value,
)
const serviceTypeOptions = computed(() =>
  [...new Set(visibleServices.value.map((service) => service.type))].sort(),
)
const preacherOptions = computed(() =>
  [
    ...new Set(
      visibleServices.value
        .map((service) => preacherName(service))
        .filter((name): name is string => !!name),
    ),
  ].sort(),
)
const bibleBookOptions = computed(() =>
  [...new Set(visibleServices.value.flatMap(serviceBibleBooks))].sort(),
)
const hasBrowseCriteria = computed(
  () => !!(browseQuery.value || browseType.value || browsePreacher.value || browseBibleBook.value),
)
const hasBrowseFilters = computed(() => browseScope.value !== 'recent' || hasBrowseCriteria.value)

function clearBrowseFilters() {
  browseScope.value = 'recent'
  browseQuery.value = ''
  browseType.value = null
  browsePreacher.value = null
  browseBibleBook.value = null
}

const browseResults = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which is what silently broke the clear button.
  const query = (browseQuery.value ?? '').trim().toLowerCase()
  return browseScopeServices.value.filter((service) => {
    if (browseType.value && service.type !== browseType.value) return false
    if (browsePreacher.value && preacherName(service) !== browsePreacher.value) return false
    if (browseBibleBook.value && !serviceBibleBooks(service).includes(browseBibleBook.value))
      return false
    if (!query) return true
    const sermonItem = findSermonItem(service)
    const passage = sermonItem ? sermonMainReference(sermonItem) : undefined
    return [
      service.type,
      formatServiceTime(service.time),
      sermonItem?.title,
      preacherName(service),
      passage,
    ].some((field) => field?.toLowerCase().includes(query))
  })
})
</script>

<template>
  <main class="services-page">
    <header class="services-hero">
      <div>
        <div class="page-eyebrow">Service Planning</div>
        <h1>Services</h1>
        <p>
          Prepare upcoming worship services, review past plans, and open today’s service for
          presentation.
        </p>
      </div>
      <div class="hero-side">
        <div class="services-summary" aria-label="Services summary">
          <div class="summary-stat">
            <strong>{{ allUpcomingServices.length }}</strong
            ><span>Upcoming</span>
          </div>
          <div class="summary-stat">
            <strong>{{ pastServices.length }}</strong
            ><span>Past</span>
          </div>
        </div>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" to="/create-service"
          >Create Service</v-btn
        >
      </div>
    </header>

    <section class="services-directory">
      <div class="services-toolbar">
        <div class="directory-title">
          <h2>
            {{
              tab === 'home'
                ? 'Service Schedule'
                : tab === 'planning'
                  ? 'Plan Ahead'
                  : 'Browse Services'
            }}
          </h2>
          <p>
            {{
              tab === 'home'
                ? 'Today and services within the next two weeks'
                : tab === 'planning'
                  ? 'Plan every future service on your calendar'
                  : 'Search current and previous service plans'
            }}
          </p>
        </div>
        <div v-if="tab === 'browse'" class="toolbar-actions">
          <v-text-field
            v-model="browseQuery"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search service, sermon, passage, or preacher"
            aria-label="Search all services"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="service-search"
          />
        </div>
      </div>

      <v-tabs v-model="tab" class="service-tabs">
        <v-tab value="home" prepend-icon="mdi-calendar-today-outline">Schedule</v-tab>
        <v-tab value="planning" prepend-icon="mdi-calendar-clock-outline">Plan Ahead</v-tab>
        <v-tab value="browse" prepend-icon="mdi-archive-search-outline">Browse</v-tab>
      </v-tabs>

      <div class="directory-content">
        <AsyncLoadState
          v-if="!store.loaded"
          :loading="store.loading"
          :error="store.loadError"
          label="services"
          @retry="store.load"
        />
        <AsyncLoadState
          v-if="store.loaded && store.loadError"
          :loading="false"
          :error="store.loadError"
          label="updated services"
          compact
          class="mb-4"
          @retry="store.load"
        />
        <div v-if="store.loaded && tab === 'home'">
          <section v-if="todayServices.length" class="service-group service-group--today">
            <div class="group-heading">
              <div>
                <span class="group-kicker">Current</span>
                <h3>Today’s Service</h3>
              </div>
              <span class="group-count"
                >{{ todayServices.length }}
                {{ todayServices.length === 1 ? 'service' : 'services' }}</span
              >
            </div>
            <div class="service-list">
              <ServiceCard
                v-for="service in todayServices"
                :key="service.id"
                :service="service"
                :preacher-name="preacherName(service)"
                badge="TODAY"
                @delete="deleteService(service)"
              />
            </div>
          </section>

          <section class="service-group">
            <div class="group-heading">
              <div>
                <span class="group-kicker">Coming Up</span>
                <h3>Next Two Weeks</h3>
              </div>
              <span class="group-count">{{ upcomingServices.length }} within two weeks</span>
            </div>
            <div v-if="upcomingServices.length" class="service-list">
              <ServiceCard
                v-for="service in upcomingServices"
                :key="service.id"
                :service="service"
                :preacher-name="preacherName(service)"
                @delete="deleteService(service)"
              />
            </div>
            <div v-else class="services-empty">
              <span><v-icon icon="mdi-calendar-plus-outline" size="29" /></span>
              <div>
                <h3>No Services in the Next Two Weeks</h3>
                <p v-if="allUpcomingServices.length">
                  Your later services are available under Plan Ahead.
                </p>
                <p v-else>Create a service to begin planning your next gathering.</p>
              </div>
              <v-btn
                v-if="allUpcomingServices.length"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-calendar-clock-outline"
                @click="tab = 'planning'"
                >Plan Ahead</v-btn
              >
              <v-btn
                v-else
                color="primary"
                variant="tonal"
                prepend-icon="mdi-plus"
                to="/create-service"
                >Create Service</v-btn
              >
            </div>
          </section>
        </div>

        <div v-else-if="store.loaded && tab === 'planning'">
          <template v-if="futureServiceGroups.length">
            <section v-for="group in futureServiceGroups" :key="group.key" class="service-group">
              <div class="group-heading">
                <div>
                  <span class="group-kicker">Future Services</span>
                  <h3>{{ group.label }}</h3>
                </div>
                <span class="group-count"
                  >{{ group.services.length }}
                  {{ group.services.length === 1 ? 'service' : 'services' }}</span
                >
              </div>
              <div class="service-list">
                <ServiceCard
                  v-for="service in group.services"
                  :key="service.id"
                  :service="service"
                  :preacher-name="preacherName(service)"
                  @delete="deleteService(service)"
                />
              </div>
            </section>
          </template>
          <div v-else class="services-empty">
            <span><v-icon icon="mdi-calendar-check-outline" size="29" /></span>
            <div>
              <h3>No Future Services Yet</h3>
              <p>Create a service to begin planning an upcoming gathering.</p>
            </div>
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" to="/create-service"
              >Create Service</v-btn
            >
          </div>
        </div>

        <div v-else-if="store.loaded && tab === 'browse'" class="browse-layout">
          <aside class="browse-filters" aria-label="Filter services">
            <div class="filter-header">
              <div>
                <span>Filters</span>
                <small>Choose a range, then narrow the results</small>
              </div>
              <v-btn
                v-if="hasBrowseFilters"
                variant="text"
                color="primary"
                size="small"
                @click="clearBrowseFilters"
                >Clear</v-btn
              >
            </div>
            <div class="filter-fields">
              <div class="filter-field">
                <label><v-icon icon="mdi-calendar-range" size="17" />Services Shown</label>
                <div class="visible-filter-options">
                  <button
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browseScope === 'recent' }"
                    :aria-pressed="browseScope === 'recent'"
                    @click="browseScope = 'recent'"
                  >
                    <span>Recent Services</span><strong>{{ recentServices.length }}</strong>
                  </button>
                  <button
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browseScope === 'all' }"
                    :aria-pressed="browseScope === 'all'"
                    @click="browseScope = 'all'"
                  >
                    <span>All Services</span><strong>{{ visibleServices.length }}</strong>
                  </button>
                </div>
              </div>
              <div class="filter-field">
                <label><v-icon icon="mdi-church-outline" size="17" />Service Type</label>
                <div class="visible-filter-options">
                  <button
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browseType === null }"
                    :aria-pressed="browseType === null"
                    @click="browseType = null"
                  >
                    <span>All Types</span><strong>{{ browseScopeServices.length }}</strong>
                  </button>
                  <button
                    v-for="type in serviceTypeOptions"
                    :key="type"
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browseType === type }"
                    :aria-pressed="browseType === type"
                    @click="browseType = type"
                  >
                    <span>{{ type }}</span>
                    <strong>{{
                      browseScopeServices.filter((service) => service.type === type).length
                    }}</strong>
                  </button>
                </div>
              </div>
              <div class="filter-field">
                <label><v-icon icon="mdi-account-voice" size="17" />Preacher</label>
                <div class="visible-filter-options">
                  <button
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browsePreacher === null }"
                    :aria-pressed="browsePreacher === null"
                    @click="browsePreacher = null"
                  >
                    <span>All Preachers</span
                    ><strong>{{
                      browseScopeServices.filter((service) => !!preacherName(service)).length
                    }}</strong>
                  </button>
                  <button
                    v-for="preacher in preacherOptions"
                    :key="preacher"
                    type="button"
                    class="visible-filter-option"
                    :class="{ 'visible-filter-option--active': browsePreacher === preacher }"
                    :aria-pressed="browsePreacher === preacher"
                    @click="browsePreacher = preacher"
                  >
                    <span>{{ preacher }}</span>
                    <strong>{{
                      browseScopeServices.filter((service) => preacherName(service) === preacher)
                        .length
                    }}</strong>
                  </button>
                </div>
              </div>
              <div class="filter-field">
                <label for="service-book-filter"
                  ><v-icon icon="mdi-book-open-page-variant-outline" size="17" />Bible Book</label
                >
                <v-select
                  id="service-book-filter"
                  v-model="browseBibleBook"
                  :items="bibleBookOptions"
                  placeholder="All Books"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                />
              </div>
            </div>
            <div class="filter-summary">
              <v-icon icon="mdi-filter-check-outline" size="18" />
              <span
                >{{ browseResults.length }}
                {{ browseResults.length === 1 ? 'service' : 'services' }} shown</span
              >
            </div>
          </aside>

          <section class="service-group browse-group">
            <div class="group-heading">
              <div>
                <span class="group-kicker">{{
                  hasBrowseCriteria
                    ? 'Filtered Results'
                    : browseScope === 'all'
                      ? 'Complete Directory'
                      : 'History'
                }}</span>
                <h3>
                  {{
                    hasBrowseCriteria
                      ? 'Matching Services'
                      : browseScope === 'all'
                        ? 'All Services'
                        : 'Recent Services'
                  }}
                </h3>
              </div>
              <span class="group-count"
                >{{ browseResults.length }}
                {{ browseResults.length === 1 ? 'service' : 'services' }}</span
              >
            </div>
            <div v-if="browseResults.length" class="service-list">
              <ServiceCard
                v-for="service in browseResults"
                :key="service.id"
                :service="service"
                :preacher-name="preacherName(service)"
                @delete="deleteService(service)"
              />
            </div>
            <div v-else class="services-empty services-empty--centered">
              <span><v-icon icon="mdi-calendar-search-outline" size="29" /></span>
              <div>
                <h3>No Services Found</h3>
                <p>Try changing the search or clearing one of the filters.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.services-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-amber), 0.045), transparent 420px),
    rgb(var(--v-theme-background));
}
.services-hero,
.services-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.services-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-amber));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.services-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.services-hero p {
  max-width: 650px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.hero-side {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
}
.services-summary {
  display: flex;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 92px;
  flex-direction: column;
  align-items: center;
  padding: 10px 14px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-amber));
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  font-weight: 680;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.services-directory {
  overflow: hidden;
}
.services-toolbar {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.directory-title h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.directory-title p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.service-search {
  width: min(420px, 34vw);
}
.service-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.8rem;
}
.service-tabs {
  min-height: 49px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.service-tabs :deep(.v-tab) {
  font-size: 0.76rem;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: none;
}
.directory-content {
  min-height: 420px;
  padding: 20px;
}
.browse-layout {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.browse-filters {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.25);
}
.filter-header {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px 10px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.filter-header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.filter-header span {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.8rem;
  font-weight: 700;
}
.filter-header small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.66rem;
}
.filter-fields {
  display: flex;
  flex-direction: column;
  gap: 17px;
  padding: 15px 13px 17px;
}
.filter-field label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 2px 7px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.7rem;
  font-weight: 680;
  letter-spacing: 0.025em;
}
.filter-field label .v-icon {
  color: rgb(var(--v-theme-amber));
}
.filter-field :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-surface), 0.62);
  font-size: 0.76rem;
}
.filter-field :deep(.v-field__outline) {
  --v-field-border-opacity: 0.12;
}
.visible-filter-options {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.visible-filter-option {
  display: grid;
  width: 100%;
  min-height: 37px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 580;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.visible-filter-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.visible-filter-option strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
}
.visible-filter-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.88);
}
.visible-filter-option--active {
  border-color: rgba(var(--v-theme-amber), 0.22);
  background: rgba(var(--v-theme-amber), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.visible-filter-option--active strong {
  background: rgba(var(--v-theme-amber), 0.13);
  color: rgb(var(--v-theme-amber));
}
.visible-filter-option:focus-visible {
  outline: 2px solid rgba(var(--v-theme-amber), 0.5);
  outline-offset: 1px;
}
.filter-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
}
.filter-summary .v-icon {
  color: rgb(var(--v-theme-teal));
}
.browse-group {
  min-width: 0;
}
.service-group + .service-group {
  margin-top: 25px;
  padding-top: 23px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.group-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 12px;
  padding: 0 2px;
}
.group-kicker {
  display: block;
  margin-bottom: 2px;
  color: rgb(var(--v-theme-amber));
  font-size: 0.67rem;
  font-weight: 720;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.group-heading h3,
.services-empty h3 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.9rem;
  font-weight: 680;
}
.group-count {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.72rem;
}
.service-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.services-empty {
  display: grid;
  min-height: 110px;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.26);
}
.services-empty > span {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-amber), 0.1);
  color: rgb(var(--v-theme-amber));
}
.services-empty p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.74rem;
}
.services-empty--centered {
  grid-template-columns: 46px minmax(0, 1fr);
}
@media (max-width: 850px) {
  .services-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .hero-side {
    width: 100%;
    justify-content: space-between;
  }
  .services-toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 17px 18px;
  }
  .toolbar-actions,
  .service-search {
    width: 100%;
  }
  .browse-layout {
    grid-template-columns: 1fr;
  }
  .filter-fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .services-page {
    padding: 16px 12px 36px;
  }
  .services-hero {
    padding: 20px;
  }
  .hero-side {
    align-items: stretch;
    flex-direction: column;
  }
  .services-summary {
    align-self: flex-start;
  }
  .toolbar-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .directory-content {
    padding: 14px 10px;
  }
  .filter-fields {
    grid-template-columns: 1fr;
  }
  .services-empty {
    grid-template-columns: 44px minmax(0, 1fr);
  }
  .services-empty > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>
