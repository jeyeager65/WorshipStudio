<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import type { Announcement } from '@/models/announcement'
import {
  effectiveStopDate,
  isEventDated,
  requiresExplicitStopDate,
} from '@/utils/announcementVisibility'

const announcementsStore = useAnnouncementsStore()
const confirmDialog = useConfirmDialogStore()

onMounted(() => announcementsStore.load())

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// "Past" mirrors the same stop-showing point the printed bulletin itself uses (see
// announcementVisibility.ts) rather than a separate notion of expiry — an announcement that's
// stopped showing on the bulletin is exactly what "Past" means here.
function isPast(a: Announcement): boolean {
  const stop = effectiveStopDate(a)
  return !!stop && stop < todayIso()
}

// The date this entry is anchored to for Month/Year browsing — the event date for upcoming
// entries, or when an ongoing notice starts showing. A standing notice with no showFrom has no
// single date to file under a month/year, so it simply won't match either filter (same as a
// song with no collection not matching a collection filter).
function groupingDate(a: Announcement): string | undefined {
  return a.eventDate ?? a.showFrom
}

const searchQuery = ref('')
const activeStatus = ref<'active' | 'past'>()
const activeYear = ref<string>()
const activeMonth = ref<string>()

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const activeCount = computed(
  () => announcementsStore.announcements.filter((a) => !isPast(a)).length,
)
const pastCount = computed(() => announcementsStore.announcements.filter(isPast).length)

const yearFilters = computed(() => {
  const counts = new Map<string, number>()
  for (const a of announcementsStore.announcements) {
    const date = groupingDate(a)
    if (!date) continue
    const year = date.slice(0, 4)
    counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, count]) => ({ year, count }))
})

// Scoped to the selected year — "July" on its own doesn't mean anything useful when it could
// span any number of different years, so Month only becomes choosable once Year narrows things
// down to one.
const monthFilters = computed(() => {
  if (!activeYear.value) return []
  const counts = new Map<string, number>()
  for (const a of announcementsStore.announcements) {
    const date = groupingDate(a)
    if (!date || date.slice(0, 4) !== activeYear.value) continue
    const month = date.slice(5, 7)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, label: MONTH_NAMES[Number(month) - 1], count }))
})

function selectYear(year: string) {
  activeYear.value = activeYear.value === year ? undefined : year
  activeMonth.value = undefined
}

const activeFilterCount = computed(
  () => Number(!!activeStatus.value) + Number(!!activeYear.value) + Number(!!activeMonth.value),
)

function clearFilters() {
  activeStatus.value = undefined
  activeYear.value = undefined
  activeMonth.value = undefined
}

function clearAllFilters() {
  clearFilters()
  searchQuery.value = ''
}

const filteredAnnouncements = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (searchQuery.value ?? '').trim().toLowerCase()
  const matches = announcementsStore.announcements.filter((a) => {
    if (activeStatus.value === 'active' && isPast(a)) return false
    if (activeStatus.value === 'past' && !isPast(a)) return false
    if (activeYear.value && groupingDate(a)?.slice(0, 4) !== activeYear.value) return false
    if (activeMonth.value && groupingDate(a)?.slice(5, 7) !== activeMonth.value) return false
    if (!q) return true
    return a.text.toLowerCase().includes(q)
  })
  // Upcoming (event-dated) entries first, soonest first; standing announcements after, most
  // recently updated first — matches how each section reads on the printed bulletin itself.
  return [...matches].sort((a, b) => {
    if (isEventDated(a) !== isEventDated(b)) return isEventDated(a) ? -1 : 1
    if (isEventDated(a)) return (a.eventDate ?? '').localeCompare(b.eventDate ?? '')
    return b.updatedAt.localeCompare(a.updatedAt)
  })
})

// Every optional field is listed explicitly (even though the type would allow omitting them) —
// Object.assign only overwrites keys actually present on its source object, so a field left out
// here would leave whatever value the *previous* dialog session set still sitting on the
// reactive `draft` object below, silently carrying over into the next Add/Edit.
function newDraft(): Announcement {
  return {
    id: crypto.randomUUID(),
    text: '',
    eventDate: undefined,
    eventEndDate: undefined,
    eventTime: undefined,
    showFrom: undefined,
    showUntil: undefined,
    updatedAt: '',
    updatedByDevice: '',
  }
}

const dialogOpen = ref(false)
const isNew = ref(false)
const draft = reactive<Announcement>(newDraft())
// Radio choice driving which fields show — derived from the draft when editing an existing
// entry, chosen explicitly by the operator for a new one. Switching away from "event" clears the
// event-only fields so a half-filled event date can't linger and silently reclassify the entry.
const pattern = ref<'event' | 'ongoing'>('event')
const saveError = ref('')

function openAdd() {
  isNew.value = true
  Object.assign(draft, newDraft())
  pattern.value = 'event'
  saveError.value = ''
  dialogOpen.value = true
}

function openEdit(announcement: Announcement) {
  isNew.value = false
  // Reset to blank first, same reasoning as openAdd — otherwise a field the announcement being
  // edited doesn't itself have (e.g. no eventTime) could still show a stale value left over from
  // whatever the dialog was last used for.
  Object.assign(draft, newDraft(), announcement)
  pattern.value = isEventDated(announcement) ? 'event' : 'ongoing'
  saveError.value = ''
  dialogOpen.value = true
}

function setPattern(next: 'event' | 'ongoing') {
  pattern.value = next
  if (next === 'ongoing') {
    draft.eventDate = undefined
    draft.eventEndDate = undefined
    draft.eventTime = undefined
  } else {
    draft.showFrom = undefined
  }
}

const validationMessage = computed(() => {
  if (!draft.text.trim()) return 'Enter the announcement text.'
  if (pattern.value === 'event' && !draft.eventDate) return 'Enter an event date.'
  if (requiresExplicitStopDate(draft)) {
    return 'An ongoing announcement needs a date to stop showing on.'
  }
  return ''
})

const saving = ref(false)
async function save() {
  saveError.value = validationMessage.value
  if (saveError.value) return
  saving.value = true
  try {
    await announcementsStore.save({ ...draft })
    dialogOpen.value = false
  } finally {
    saving.value = false
  }
}

async function remove(announcement: Announcement) {
  const label =
    announcement.text.length > 60 ? `${announcement.text.slice(0, 60)}…` : announcement.text
  if (!(await confirmDialog.confirm(`Delete "${label}"?`, 'Delete'))) return
  await announcementsStore.remove(announcement.id)
}

function dateRangeLabel(a: Announcement): string {
  if (!a.eventDate) return ''
  const parts = [formatDate(a.eventDate)]
  if (a.eventEndDate) parts.push(`– ${formatDate(a.eventEndDate)}`)
  if (a.eventTime) parts.push(a.eventTime)
  return parts.join(' ')
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function stopDateLabel(a: Announcement): string {
  const stop = effectiveStopDate(a)
  return stop ? `Stops showing after ${formatDate(stop)}` : ''
}
</script>

<template>
  <main class="announcements-page">
    <header class="announcements-hero">
      <div>
        <div class="page-eyebrow">Bulletin</div>
        <h1>Announcements</h1>
        <p>
          Upcoming events and ongoing notices for the printed bulletin — separate from Slide Library
          announcement slides, since print entries usually say more than an on-screen slide does.
        </p>
      </div>
      <div class="announcements-summary" aria-label="Announcements summary">
        <div class="summary-stat">
          <strong>{{ announcementsStore.announcements.length }}</strong>
          <span>Total</span>
        </div>
        <div class="summary-stat">
          <strong>{{ activeCount }}</strong>
          <span>Active</span>
        </div>
        <div class="summary-stat">
          <strong>{{ pastCount }}</strong>
          <span>Past</span>
        </div>
      </div>
    </header>

    <section class="announcements-directory">
      <div class="announcements-toolbar">
        <div>
          <h2>All Announcements</h2>
          <p>
            {{ filteredAnnouncements.length }}
            {{ filteredAnnouncements.length === 1 ? 'announcement' : 'announcements' }}
            <template v-if="activeFilterCount">
              with {{ activeFilterCount }} active
              {{ activeFilterCount === 1 ? 'filter' : 'filters' }}</template
            >
            <template v-if="searchQuery"> matching your search</template>
          </p>
        </div>
        <div class="announcements-actions">
          <v-text-field
            v-if="announcementsStore.announcements.length > 0"
            v-model="searchQuery"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search announcement text"
            aria-label="Search announcements"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="announcement-search"
          />
          <v-btn
            variant="flat"
            color="primary"
            prepend-icon="mdi-bullhorn-outline"
            @click="openAdd"
          >
            Add Announcement
          </v-btn>
        </div>
      </div>

      <AsyncLoadState
        v-if="!announcementsStore.loaded"
        :loading="announcementsStore.loading"
        :error="announcementsStore.loadError"
        label="announcements"
        @retry="announcementsStore.load"
      />
      <template v-else>
        <v-alert
          v-if="announcementsStore.mutationError"
          type="error"
          variant="tonal"
          closable
          class="ma-4 mb-0"
          @click:close="announcementsStore.clearMutationError"
        >
          Announcement changes were not saved: {{ announcementsStore.mutationError }}
        </v-alert>

        <LibraryEmptyState
          v-if="announcementsStore.announcements.length === 0"
          icon="mdi-bullhorn-outline"
          title="No Announcements Yet"
          message="Add an upcoming event or an ongoing notice to include on the printed bulletin."
        >
          <v-btn variant="flat" color="primary" @click="openAdd">Add Announcement</v-btn>
        </LibraryEmptyState>

        <div v-else class="announcements-directory-body">
          <aside class="announcement-filters" aria-label="Filter announcements">
            <button
              type="button"
              class="announcement-filter announcement-filter--all"
              :class="{ 'announcement-filter--active': activeFilterCount === 0 }"
              @click="clearFilters"
            >
              <span class="announcement-filter-icon"
                ><v-icon icon="mdi-bullhorn-outline" size="18"
              /></span>
              <span>All Announcements</span>
              <strong>{{ announcementsStore.announcements.length }}</strong>
            </button>

            <div class="filter-section">
              <div class="filter-heading">Status</div>
              <button
                type="button"
                class="announcement-filter announcement-filter--status"
                :class="{ 'announcement-filter--active': activeStatus === 'active' }"
                @click="activeStatus = activeStatus === 'active' ? undefined : 'active'"
              >
                <span class="announcement-filter-icon"
                  ><v-icon icon="mdi-calendar-check-outline" size="17"
                /></span>
                <span>Active</span>
                <strong>{{ activeCount }}</strong>
              </button>
              <button
                type="button"
                class="announcement-filter announcement-filter--status"
                :class="{ 'announcement-filter--active': activeStatus === 'past' }"
                @click="activeStatus = activeStatus === 'past' ? undefined : 'past'"
              >
                <span class="announcement-filter-icon"
                  ><v-icon icon="mdi-calendar-remove-outline" size="17"
                /></span>
                <span>Past</span>
                <strong>{{ pastCount }}</strong>
              </button>
            </div>

            <div class="filter-section">
              <div class="filter-heading">Year</div>
              <button
                v-for="filter in yearFilters"
                :key="filter.year"
                type="button"
                class="announcement-filter announcement-filter--year"
                :class="{ 'announcement-filter--active': activeYear === filter.year }"
                @click="selectYear(filter.year)"
              >
                <span class="announcement-filter-icon"
                  ><v-icon icon="mdi-calendar-blank-outline" size="17"
                /></span>
                <span>{{ filter.year }}</span>
                <strong>{{ filter.count }}</strong>
              </button>
              <p v-if="yearFilters.length === 0" class="filter-empty">No dated entries yet</p>
            </div>

            <div class="filter-section">
              <div class="filter-heading">Month</div>
              <template v-if="activeYear">
                <button
                  v-for="filter in monthFilters"
                  :key="filter.month"
                  type="button"
                  class="announcement-filter announcement-filter--month"
                  :class="{ 'announcement-filter--active': activeMonth === filter.month }"
                  @click="activeMonth = activeMonth === filter.month ? undefined : filter.month"
                >
                  <span class="announcement-filter-icon"
                    ><v-icon icon="mdi-calendar-month-outline" size="17"
                  /></span>
                  <span>{{ filter.label }}</span>
                  <strong>{{ filter.count }}</strong>
                </button>
              </template>
              <p v-else class="filter-empty">Select a year to filter by month</p>
            </div>
          </aside>

          <div class="announcement-results">
            <LibraryEmptyState
              v-if="filteredAnnouncements.length === 0"
              icon="mdi-bullhorn-outline"
              title="No Matches Found"
              message="No announcements match the current filters and search."
            >
              <v-btn variant="text" color="primary" @click="clearAllFilters">Clear Filters</v-btn>
            </LibraryEmptyState>

            <div v-else class="announcement-list">
              <article v-for="a in filteredAnnouncements" :key="a.id" class="announcement-card">
                <div class="announcement-body">
                  <span
                    class="announcement-kind"
                    :class="{ 'announcement-kind--event': isEventDated(a) }"
                  >
                    {{ isEventDated(a) ? 'Upcoming' : 'Standing' }}
                  </span>
                  <p class="announcement-text">{{ a.text }}</p>
                  <p v-if="dateRangeLabel(a)" class="announcement-meta">{{ dateRangeLabel(a) }}</p>
                  <p v-if="a.showFrom" class="announcement-meta">
                    Starts showing {{ formatDate(a.showFrom) }}
                  </p>
                  <p v-if="stopDateLabel(a)" class="announcement-meta">{{ stopDateLabel(a) }}</p>
                </div>
                <div class="announcement-actions">
                  <v-btn
                    icon="mdi-pencil-outline"
                    variant="text"
                    size="small"
                    aria-label="Edit"
                    @click="openEdit(a)"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    variant="text"
                    size="small"
                    color="error"
                    aria-label="Delete"
                    @click="remove(a)"
                  />
                </div>
              </article>
            </div>
          </div>
        </div>
      </template>
    </section>

    <v-dialog v-model="dialogOpen" max-width="560">
      <v-card>
        <v-card-title>{{ isNew ? 'Add Announcement' : 'Edit Announcement' }}</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="draft.text"
            label="Announcement text"
            variant="outlined"
            rows="3"
            auto-grow
            hide-details="auto"
            class="mb-4"
          />

          <v-radio-group
            :model-value="pattern"
            inline
            hide-details
            class="mb-2"
            @update:model-value="(v) => setPattern(v as 'event' | 'ongoing')"
          >
            <v-radio label="Upcoming event (has a date)" value="event" />
            <v-radio label="Ongoing / standing notice" value="ongoing" />
          </v-radio-group>

          <template v-if="pattern === 'event'">
            <div class="date-row">
              <v-text-field
                v-model="draft.eventDate"
                type="date"
                label="Event date"
                variant="outlined"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model="draft.eventEndDate"
                type="date"
                label="Through (optional)"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
            <v-text-field
              v-model="draft.eventTime"
              label="Time (optional, e.g. 4:30pm or 1–6pm)"
              variant="outlined"
              density="compact"
              hide-details
              class="mt-3"
            />
          </template>
          <template v-else>
            <div class="date-row">
              <v-text-field
                v-model="draft.showFrom"
                type="date"
                label="Start showing (optional)"
                variant="outlined"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model="draft.showUntil"
                type="date"
                label="Stop showing"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
          </template>

          <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mt-4">
            {{ saveError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialogOpen = false">Cancel</v-btn>
          <v-btn variant="flat" color="primary" :loading="saving" @click="save"> Save </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.announcements-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-rose), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.announcements-hero,
.announcements-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.announcements-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-rose));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.announcements-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.announcements-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.announcements-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-rose));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.announcements-directory {
  overflow: hidden;
}
.announcements-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 78px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.announcements-toolbar h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.announcements-toolbar p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.announcements-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.announcement-search {
  width: min(350px, 28vw);
}
.announcement-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.announcements-directory-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 420px;
}
.announcement-filters {
  padding: 14px 11px 18px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.filter-section {
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.filter-heading {
  padding: 0 9px 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.announcement-filter {
  --filter-color: rgb(var(--v-theme-slate));
  position: relative;
  display: grid;
  width: 100%;
  min-height: 42px;
  grid-template-columns: 29px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 4px 9px 4px 7px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 590;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.announcement-filter::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--filter-color);
  content: '';
  opacity: 0;
}
.announcement-filter:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.announcement-filter--active {
  border-color: color-mix(in srgb, var(--filter-color) 22%, transparent);
  background: color-mix(in srgb, var(--filter-color) 10%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.announcement-filter--active::before {
  opacity: 1;
}
.announcement-filter:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--filter-color) 65%, transparent);
  outline-offset: 1px;
}
.announcement-filter--all,
.announcement-filter--status {
  --filter-color: rgb(var(--v-theme-rose));
}
.announcement-filter--year {
  --filter-color: rgb(var(--v-theme-teal));
}
.announcement-filter--month {
  --filter-color: rgb(var(--v-theme-violet));
}
.announcement-filter-icon {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--filter-color) 11%, transparent);
  color: var(--filter-color);
}
.announcement-filter strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.filter-empty {
  margin: 2px 9px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
}
.announcement-results {
  min-width: 0;
}
.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.announcement-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.34);
}
.announcement-body {
  min-width: 0;
  flex: 1;
}
.announcement-kind {
  display: inline-block;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.announcement-kind--event {
  background: rgba(var(--v-theme-rose), 0.12);
  color: rgb(var(--v-theme-rose));
}
.announcement-text {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.92rem;
  line-height: 1.45;
  white-space: pre-wrap;
}
.announcement-meta {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.announcement-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}
.date-row {
  display: flex;
  gap: 12px;
}
.date-row > * {
  flex: 1;
}
@media (max-width: 980px) {
  .announcements-toolbar,
  .announcements-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .announcement-search {
    width: min(520px, 100%);
  }
}
@media (max-width: 880px) {
  .announcements-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .announcements-summary {
    align-self: flex-start;
  }
  .announcements-directory-body {
    grid-template-columns: 1fr;
  }
  .announcement-filters {
    display: flex;
    gap: 5px;
    padding: 9px 11px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .filter-section {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    padding: 0 0 0 8px;
    border-top: 0;
    border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .filter-heading,
  .filter-empty {
    display: none;
  }
  .announcement-filter {
    width: auto;
    min-width: max-content;
    grid-template-columns: 27px auto auto;
    margin-bottom: 0;
  }
}
@media (max-width: 700px) {
  .announcements-page {
    padding: 14px 12px 40px;
  }
  /* The whole hero card (eyebrow, title, description, stats) is nice-to-have context, not
     essential, and it eats space that matters more on a narrow/short screen. */
  .announcements-hero {
    display: none;
  }
}
</style>
