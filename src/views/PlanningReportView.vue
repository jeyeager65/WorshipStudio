<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import { buildPlanningReport } from '@/utils/planningReport'
import { personDisplayName, personFormalName } from '@/models/library'
import { reportBranding } from '@/reports/branding'
import { buildPlanningDocument, buildPlanningWorkbook } from '@/reports/builders/planning'
import {
  exportCompletionMessage,
  exportDocumentReport,
  exportWorkbookReport,
} from '@/reports/exportReport'
import type { ReportFormat } from '@/reports/types'

const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()

// Defaults to today through 3 months out — planning ahead is forward-looking, unlike the
// backward-looking Song Usage report. Local calendar-date components (not toISOString, which
// converts to UTC and can land on a different day near midnight) — same reasoning as
// songUsageReport.ts's formatLocalDate.
const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = new Date()
const threeMonthsOut = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate())
const fromDate = ref(toIso(today))
const toDate = ref(toIso(threeMonthsOut))
const serviceType = ref('all')
const exportingFormat = ref<ReportFormat>()
const exportMessage = ref('')
const exportError = ref(false)

// Always reloaded fresh (not gated on each store's `loaded` flag) — this is a planning report
// an operator may revisit repeatedly across a session, and it should reflect whatever's
// actually on disk right now, not a snapshot cached from whenever the app first booted or another
// view first happened to touch these stores.
onMounted(async () => {
  await Promise.all([
    servicesStore.load(),
    songsStore.load(),
    peopleStore.load(),
    settingsStore.load(),
    serviceTypesStore.load(),
    roleGroupsStore.load(),
    rolesStore.load(),
  ])
})

const personNames = computed(
  () => new Map(peopleStore.people.map((p) => [p.id, personDisplayName(p)])),
)
const formalPersonNames = computed(
  () => new Map(peopleStore.people.map((p) => [p.id, personFormalName(p)])),
)
const serviceTypeNames = computed(
  () => new Map(serviceTypesStore.serviceTypes.map((type) => [type.id, type.name])),
)

const rows = computed(() =>
  buildPlanningReport(
    servicesStore.services,
    songsStore.songs,
    personNames.value,
    rolesStore.roles,
    roleGroupsStore.roleGroups,
    {
      fromDate: fromDate.value,
      toDate: toDate.value,
      serviceType: serviceType.value,
    },
    formalPersonNames.value,
    serviceTypeNames.value,
  ),
)

const serviceTypeOptions = computed(() => [
  { title: 'All Types', value: 'all' },
  ...serviceTypesStore.serviceTypes.map((type) => ({ title: type.name, value: type.id })),
])

const totalSongs = computed(() =>
  rows.value.reduce((total, row) => total + row.songTitles.length, 0),
)
const totalAssignments = computed(() =>
  rows.value.reduce(
    (total, row) =>
      total +
      row.rosterGroups.reduce((groupTotal, group) => groupTotal + group.assignments.length, 0),
    0,
  ),
)

function dateParts(date: string) {
  const value = new Date(`${date}T00:00:00`)
  return {
    month: value.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    day: value.toLocaleDateString(undefined, { day: 'numeric' }),
  }
}

const planningReportInput = computed(() => ({
  rows: rows.value,
  fromDate: fromDate.value,
  toDate: toDate.value,
  serviceType:
    serviceType.value === 'all'
      ? 'all'
      : (serviceTypeNames.value.get(serviceType.value) ?? serviceType.value),
  branding: reportBranding(settingsStore.librarySettings),
}))

async function exportPlanning(format: ReportFormat) {
  exportingFormat.value = format
  exportMessage.value = ''
  exportError.value = false
  try {
    const result =
      format === 'xlsx'
        ? await exportWorkbookReport(buildPlanningWorkbook(planningReportInput.value))
        : await exportDocumentReport(buildPlanningDocument(planningReportInput.value), format)
    if (result !== 'cancelled') exportMessage.value = exportCompletionMessage(format, result)
  } catch (error) {
    console.error(`Failed to export multi-week plan as ${format}`, error)
    exportError.value = true
    exportMessage.value = 'Could not create the report. Please try again.'
  } finally {
    exportingFormat.value = undefined
  }
}
</script>

<template>
  <main class="report-page planning-report">
    <header class="report-hero">
      <div>
        <router-link to="/reports" class="report-back no-print"
          ><v-icon icon="mdi-arrow-left" size="16" /> Reports</router-link
        >
        <div class="report-eyebrow">Planning Report</div>
        <h1>Multi-Week Plan</h1>
        <p>Upcoming sermons, songs, and team assignments in one read-only document.</p>
      </div>
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            class="no-print"
            variant="flat"
            color="primary"
            prepend-icon="mdi-export-variant"
            append-icon="mdi-menu-down"
            :loading="!!exportingFormat"
            >Export</v-btn
          >
        </template>
        <v-list density="compact" min-width="270">
          <v-list-item
            title="Edit in Word"
            subtitle="Editable planning document"
            prepend-icon="mdi-file-word-outline"
            @click="exportPlanning('docx')"
          />
          <v-list-item
            title="Open PDF"
            subtitle="Fixed layout for distribution"
            prepend-icon="mdi-file-pdf-box"
            @click="exportPlanning('pdf')"
          />
          <v-list-item
            title="Open in Excel"
            subtitle="Services, songs, and assignments sheets"
            prepend-icon="mdi-file-excel-outline"
            @click="exportPlanning('xlsx')"
          />
        </v-list>
      </v-menu>
    </header>

    <section class="filter-panel no-print" aria-labelledby="planning-filter-title">
      <div class="panel-heading">
        <span class="panel-icon"><v-icon icon="mdi-calendar-range-outline" size="20" /></span>
        <div>
          <h2 id="planning-filter-title">Planning window</h2>
          <p>Choose the services to include in this document.</p>
        </div>
      </div>
      <div class="filter-fields">
        <v-text-field
          v-model="fromDate"
          type="date"
          label="Start Date"
          variant="outlined"
          density="compact"
          hide-details
          class="date-field"
        />
        <v-text-field
          v-model="toDate"
          type="date"
          label="End Date"
          variant="outlined"
          density="compact"
          hide-details
          class="date-field"
        />
        <v-select
          v-model="serviceType"
          :items="serviceTypeOptions"
          label="Service Type"
          variant="outlined"
          density="compact"
          hide-details
          class="type-field"
        />
      </div>
    </section>

    <div class="summary-grid" aria-label="Report summary">
      <div class="summary-card summary-card--primary">
        <span><v-icon icon="mdi-church-outline" size="19" /> Services</span
        ><strong>{{ rows.length }}</strong>
      </div>
      <div class="summary-card summary-card--teal">
        <span><v-icon icon="mdi-music-note-multiple" size="19" /> Planned songs</span
        ><strong>{{ totalSongs }}</strong>
      </div>
      <div class="summary-card summary-card--amber">
        <span><v-icon icon="mdi-account-group-outline" size="19" /> Assignments</span
        ><strong>{{ totalAssignments }}</strong>
      </div>
    </div>

    <section class="results-panel">
      <div class="results-heading">
        <div>
          <span>Service plans</span>
          <h2>{{ rows.length ? 'Included services' : 'No matching services' }}</h2>
        </div>
        <span class="row-count"
          >{{ rows.length }} {{ rows.length === 1 ? 'service' : 'services' }}</span
        >
      </div>

      <div v-if="rows.length" class="service-reports">
        <article v-for="row in rows" :key="row.serviceId" class="service-report">
          <div class="service-date" aria-hidden="true">
            <span>{{ dateParts(row.date).month }}</span
            ><strong>{{ dateParts(row.date).day }}</strong>
          </div>
          <div class="service-report-content">
            <header class="service-report-heading">
              <div>
                <h3>{{ row.type }}</h3>
                <p>{{ row.dateLine }}</p>
              </div>
              <v-btn
                class="no-print"
                :to="`/service/${row.serviceId}`"
                variant="text"
                size="small"
                append-icon="mdi-arrow-right"
                >Open service</v-btn
              >
            </header>
            <div class="sermon-line">
              <v-icon icon="mdi-book-open-page-variant-outline" size="17" />
              <span v-if="row.sermonTitle"
                ><strong>{{ row.sermonTitle }}</strong
                ><template v-if="row.mainPassage"> · {{ row.mainPassage }}</template
                ><template v-if="row.preacher"> · {{ row.preacher }}</template></span
              >
              <span v-else class="missing-value">Sermon details not yet decided</span>
            </div>
            <div class="plan-columns">
              <section>
                <h4><v-icon icon="mdi-account-group-outline" size="16" /> Assignments</h4>
                <div v-if="row.rosterGroups.length" class="roster-groups">
                  <div
                    v-for="(group, groupIndex) in row.rosterGroups"
                    :key="group.category ?? `other-${groupIndex}`"
                    class="roster-group"
                  >
                    <h5 v-if="group.category">{{ group.category }}</h5>
                    <ul>
                      <li
                        v-for="assignment in group.assignments"
                        :key="`${assignment.role}-${assignment.person}`"
                      >
                        {{ assignment.role }} — {{ assignment.person
                        }}{{ assignment.tentative ? '?' : '' }}
                      </li>
                    </ul>
                  </div>
                </div>
                <p v-else class="missing-value">No assignments yet</p>
              </section>
              <section>
                <h4><v-icon icon="mdi-music-note-outline" size="16" /> Planned Songs</h4>
                <ol v-if="row.songTitles.length">
                  <li v-for="song in row.songTitles" :key="song">{{ song }}</li>
                </ol>
                <p v-else class="missing-value">No songs planned yet</p>
              </section>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="report-empty">
        <span><v-icon icon="mdi-calendar-blank-outline" size="28" /></span>
        <div>
          <h3>No services found</h3>
          <p>Try a wider date range or another service type.</p>
        </div>
      </div>
    </section>

    <footer class="report-footer no-print">
      <span
        ><v-icon icon="mdi-information-outline" size="17" /> Make corrections in the original
        service, then reopen this report.</span
      >
      <div class="d-flex ga-2 flex-wrap justify-end">
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-file-word-outline"
          :loading="exportingFormat === 'docx'"
          :disabled="!!exportingFormat"
          @click="exportPlanning('docx')"
          >Edit in Word</v-btn
        >
        <v-btn
          variant="tonal"
          prepend-icon="mdi-file-pdf-box"
          :loading="exportingFormat === 'pdf'"
          :disabled="!!exportingFormat"
          @click="exportPlanning('pdf')"
          >Open PDF</v-btn
        >
        <v-btn
          variant="tonal"
          color="success"
          prepend-icon="mdi-file-excel-outline"
          :loading="exportingFormat === 'xlsx'"
          :disabled="!!exportingFormat"
          @click="exportPlanning('xlsx')"
          >Open in Excel</v-btn
        >
      </div>
    </footer>
    <v-snackbar
      :model-value="!!exportMessage"
      :color="exportError ? 'error' : 'success'"
      timeout="3000"
      @update:model-value="(open: boolean) => !open && (exportMessage = '')"
    >
      {{ exportMessage }}
    </v-snackbar>
  </main>
</template>

<style scoped>
.report-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background: rgb(var(--v-theme-background));
}
.report-hero,
.filter-panel,
.results-panel,
.summary-grid,
.report-footer {
  max-width: 1080px;
  margin-right: auto;
  margin-left: auto;
}
.report-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding: 24px 26px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
}
.report-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
  font-weight: 620;
  text-decoration: none;
}
.report-back:hover {
  color: rgb(var(--v-theme-primary));
}
.report-eyebrow,
.results-heading span:first-child {
  color: rgb(var(--v-theme-teal));
  font-size: 0.67rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.report-hero h1 {
  margin: 2px 0 0;
  font-size: 1.55rem;
  font-weight: 680;
  letter-spacing: -0.02em;
}
.report-hero p {
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.8rem;
}
.filter-panel,
.results-panel {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.7);
}
.filter-panel {
  margin-bottom: 14px;
}
.panel-heading,
.results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.panel-heading {
  justify-content: flex-start;
}
.panel-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-teal), 0.1);
  color: rgb(var(--v-theme-teal));
}
.panel-heading h2,
.results-heading h2 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 680;
}
.panel-heading p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.66rem;
}
.filter-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 16px 17px;
}
.date-field {
  max-width: 170px;
}
.type-field {
  max-width: 220px;
}
.filter-fields :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.35);
  font-size: 0.76rem;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.summary-card {
  --summary-color: var(--v-theme-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 17px;
  border: 1px solid rgba(var(--summary-color), 0.16);
  border-radius: 9px;
  background: rgba(var(--summary-color), 0.045);
}
.summary-card--teal {
  --summary-color: var(--v-theme-teal);
}
.summary-card--amber {
  --summary-color: var(--v-theme-amber);
}
.summary-card span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: rgba(var(--v-theme-on-surface), 0.57);
  font-size: 0.7rem;
  font-weight: 620;
}
.summary-card span .v-icon {
  color: rgb(var(--summary-color));
}
.summary-card strong {
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
}
.results-heading h2 {
  margin-top: 2px;
}
.row-count {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.69rem;
}
.service-reports {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}
.service-report {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 16px;
  padding: 15px;
  break-inside: avoid;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-left: 3px solid rgb(var(--v-theme-teal));
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.3);
}
.service-date {
  display: flex;
  width: 56px;
  height: 64px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--v-theme-teal), 0.22);
  border-radius: 9px;
  background: rgba(var(--v-theme-teal), 0.08);
}
.service-date span {
  color: rgb(var(--v-theme-teal));
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.07em;
}
.service-date strong {
  margin-top: 2px;
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.service-report-content {
  min-width: 0;
}
.service-report-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.service-report-heading h3 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
}
.service-report-heading p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.67rem;
}
.sermon-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.72rem;
}
.sermon-line .v-icon {
  color: rgb(var(--v-theme-primary));
}
.plan-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.plan-columns section {
  min-width: 0;
}
.plan-columns h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.67rem;
  font-weight: 700;
  letter-spacing: 0.025em;
  text-transform: uppercase;
}
.plan-columns h4 .v-icon {
  color: rgb(var(--v-theme-teal));
}
.roster-groups {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.roster-group h5 {
  margin: 0 0 1px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.68rem;
  font-weight: 700;
}
.plan-columns ul,
.plan-columns ol {
  margin: 0;
  padding-left: 20px;
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.7rem;
  line-height: 1.65;
}
.missing-value {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.7rem;
  font-style: italic;
}
.report-empty {
  display: flex;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  gap: 13px;
}
.report-empty > span {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 11px;
  background: rgba(var(--v-theme-slate), 0.1);
  color: rgb(var(--v-theme-slate));
}
.report-empty h3 {
  margin: 0;
  font-size: 0.82rem;
}
.report-empty p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.7rem;
}
.report-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 14px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.68rem;
}
.report-footer > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
@media print {
  .no-print {
    display: none !important;
  }
  .report-page {
    padding: 0;
    background: white;
    color: #111;
  }
  .summary-grid,
  .results-panel {
    max-width: none;
  }
  .results-panel,
  .service-report {
    border-color: #bbb;
    background: white;
  }
}
@media (max-width: 700px) {
  .summary-grid,
  .plan-columns {
    grid-template-columns: 1fr;
  }
  .report-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .date-field,
  .type-field {
    max-width: none;
  }
}
@media (max-width: 560px) {
  .report-page {
    padding: 16px 12px 36px;
  }
  .report-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .service-report {
    grid-template-columns: 1fr;
  }
}
</style>
