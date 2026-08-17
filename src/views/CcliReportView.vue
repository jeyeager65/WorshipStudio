<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { computeCcliUsage, quickRangeDates, type QuickRange } from '@/utils/ccliUsage'
import { reportBranding } from '@/reports/branding'
import { buildSongUsageDocument, buildSongUsageWorkbook } from '@/reports/builders/ccli'
import {
  exportCompletionMessage,
  exportDocumentReport,
  exportWorkbookReport,
} from '@/reports/exportReport'
import type { ReportFormat } from '@/reports/types'

const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()

const today = new Date()
const initialRange = quickRangeDates('ytd', today)
const fromDate = ref(initialRange.fromDate)
const toDate = ref(initialRange.toDate)
const serviceType = ref('all')
const activeQuickRange = ref<QuickRange | undefined>('ytd')
const exportingFormat = ref<ReportFormat>()
const exportMessage = ref('')
const exportError = ref(false)

onMounted(async () => {
  await Promise.all([
    servicesStore.loaded ? Promise.resolve() : servicesStore.load(),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    settingsStore.load(),
    serviceTypesStore.loaded ? Promise.resolve() : serviceTypesStore.load(),
  ])
})

function applyQuickRange(range: QuickRange | undefined) {
  // v-chip-group without `mandatory` lets clicking the active chip deselect it — nothing
  // meaningful to apply in that case, so the date fields are left exactly as they are.
  if (!range) return
  activeQuickRange.value = range
  const dates = quickRangeDates(range, today)
  fromDate.value = dates.fromDate
  toDate.value = dates.toDate
}

const summary = computed(() =>
  computeCcliUsage(servicesStore.services, songsStore.songs, {
    fromDate: fromDate.value,
    toDate: toDate.value,
    serviceType: serviceType.value,
  }),
)

const serviceTypeOptions = computed(() => [
  { title: 'All Types', value: 'all' },
  ...serviceTypesStore.serviceTypes.map((type) => ({ title: type.name, value: type.id })),
])

const reportRangeLabel = computed(() => {
  const format = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${format(fromDate.value)} – ${format(toDate.value)}`
})

const songUsageInput = computed(() => ({
  summary: summary.value,
  fromDate: fromDate.value,
  toDate: toDate.value,
  serviceType: serviceType.value,
  branding: reportBranding(settingsStore.librarySettings),
}))

async function exportSongUsage(format: 'pdf' | 'xlsx') {
  exportingFormat.value = format
  exportMessage.value = ''
  exportError.value = false
  try {
    const result =
      format === 'xlsx'
        ? await exportWorkbookReport(buildSongUsageWorkbook(songUsageInput.value))
        : await exportDocumentReport(buildSongUsageDocument(songUsageInput.value), 'pdf')
    if (result !== 'cancelled') exportMessage.value = exportCompletionMessage(format, result)
  } catch (error) {
    console.error(`Failed to export song usage as ${format}`, error)
    exportError.value = true
    exportMessage.value = 'Could not create the report. Please try again.'
  } finally {
    exportingFormat.value = undefined
  }
}
</script>

<template>
  <main class="report-page ccli-report">
    <header class="report-hero">
      <div>
        <router-link to="/reports" class="report-back no-print"
          ><v-icon icon="mdi-arrow-left" size="16" /> Reports</router-link
        >
        <div class="report-eyebrow">Library Report</div>
        <h1>Song Usage</h1>
        <p>
          How songs have been used across services—for planning, church records, and CCLI reporting.
        </p>
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
          >
            Export
          </v-btn>
        </template>
        <v-list density="compact" min-width="260">
          <v-list-item
            title="Open in Excel"
            subtitle="Sortable workbook for further analysis"
            prepend-icon="mdi-file-excel-outline"
            @click="exportSongUsage('xlsx')"
          />
          <v-list-item
            title="Open PDF"
            subtitle="Fixed layout for printing or records"
            prepend-icon="mdi-file-pdf-box"
            @click="exportSongUsage('pdf')"
          />
        </v-list>
      </v-menu>
    </header>

    <section class="filter-panel no-print" aria-labelledby="ccli-filter-title">
      <div class="panel-heading">
        <span class="panel-icon"><v-icon icon="mdi-filter-variant" size="20" /></span>
        <div>
          <h2 id="ccli-filter-title">Report range</h2>
          <p>Results update immediately as filters change.</p>
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
          @update:model-value="activeQuickRange = undefined"
        />
        <v-text-field
          v-model="toDate"
          type="date"
          label="End Date"
          variant="outlined"
          density="compact"
          hide-details
          class="date-field"
          @update:model-value="activeQuickRange = undefined"
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
        <v-chip-group
          v-model="activeQuickRange"
          selected-class="quick-range--active"
          @update:model-value="applyQuickRange"
        >
          <v-chip value="quarter" variant="outlined" size="small">This Quarter</v-chip>
          <v-chip value="ytd" variant="outlined" size="small">Year to Date</v-chip>
          <v-chip value="last-year" variant="outlined" size="small">Last Year</v-chip>
        </v-chip-group>
      </div>
    </section>

    <div class="summary-grid" aria-label="Report summary">
      <div class="summary-card summary-card--primary">
        <span><v-icon icon="mdi-music-note-multiple" size="19" /> Song uses</span
        ><strong>{{ summary.totalUses }}</strong>
      </div>
      <div class="summary-card summary-card--teal">
        <span><v-icon icon="mdi-playlist-music-outline" size="19" /> Unique songs</span
        ><strong>{{ summary.uniqueSongs }}</strong>
      </div>
      <div class="summary-card summary-card--amber">
        <span><v-icon icon="mdi-church-outline" size="19" /> Services</span
        ><strong>{{ summary.servicesIncluded }}</strong>
      </div>
    </div>

    <section class="results-panel">
      <div class="results-heading">
        <div>
          <span>Usage detail</span>
          <h2>{{ reportRangeLabel }}</h2>
        </div>
        <span class="row-count"
          >{{ summary.rows.length }} {{ summary.rows.length === 1 ? 'song' : 'songs' }}</span
        >
      </div>
      <v-table v-if="summary.rows.length" class="usage-table">
        <thead>
          <tr>
            <th>Song</th>
            <th>CCLI #</th>
            <th>Author</th>
            <th class="count-column">Uses</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in summary.rows" :key="row.songId">
            <td class="song-title">{{ row.title }}</td>
            <td class="ccli-number">{{ row.ccli ?? '—' }}</td>
            <td class="author-cell">{{ row.author ?? '—' }}</td>
            <td class="count-column">
              <span class="usage-count">{{ row.timesUsed }}</span>
            </td>
          </tr>
        </tbody>
      </v-table>
      <div v-else class="report-empty">
        <span><v-icon icon="mdi-music-note-off-outline" size="28" /></span>
        <div>
          <h3>No song usage found</h3>
          <p>Try a wider date range or another service type.</p>
        </div>
      </div>
    </section>

    <footer class="report-footer no-print">
      <span
        ><v-icon icon="mdi-information-outline" size="17" /> Excel is best for analysis; PDF is best
        for a fixed record.</span
      >
      <div class="d-flex ga-2">
        <v-btn
          variant="tonal"
          color="success"
          prepend-icon="mdi-file-excel-outline"
          :loading="exportingFormat === 'xlsx'"
          :disabled="!!exportingFormat"
          @click="exportSongUsage('xlsx')"
          >Open in Excel</v-btn
        >
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-file-pdf-box"
          :loading="exportingFormat === 'pdf'"
          :disabled="!!exportingFormat"
          @click="exportSongUsage('pdf')"
          >Open PDF</v-btn
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
  color: rgb(var(--v-theme-primary));
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
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
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
.filter-fields :deep(.quick-range--active) {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
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
.usage-table {
  background: transparent;
}
.usage-table th {
  height: 38px !important;
  background: rgba(var(--v-theme-background), 0.28);
  color: rgba(var(--v-theme-on-surface), 0.48) !important;
  font-size: 0.64rem !important;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.usage-table td {
  height: 48px !important;
  border-color: rgba(var(--v-theme-on-surface), 0.06) !important;
  font-size: 0.75rem;
}
.song-title {
  font-weight: 680;
}
.ccli-number {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-family: ui-monospace, monospace;
}
.author-cell {
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.count-column {
  width: 80px;
  text-align: right !important;
}
.usage-count {
  display: inline-grid;
  min-width: 30px;
  height: 25px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 750;
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
  .results-panel {
    border-color: #bbb;
    background: white;
  }
  .summary-card {
    border-color: #ccc;
    background: white;
  }
  .usage-table th {
    background: #f3f3f3;
    color: #444 !important;
  }
}
@media (max-width: 700px) {
  .summary-grid {
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
}
</style>
