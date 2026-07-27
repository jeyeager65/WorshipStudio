<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useVolunteersStore } from '@/stores/volunteers'
import { useSettingsStore } from '@/stores/settings'
import { buildPlanningReport } from '@/utils/planningReport'

const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const volunteersStore = useVolunteersStore()
const settingsStore = useSettingsStore()

// Defaults to today through 3 months out — planning ahead is forward-looking, unlike CCLI's
// backward-looking usage report. Local calendar-date components (not toISOString, which
// converts to UTC and can land on a different day near midnight) — same reasoning as
// ccliUsage.ts's formatLocalDate.
const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = new Date()
const threeMonthsOut = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate())
const fromDate = ref(toIso(today))
const toDate = ref(toIso(threeMonthsOut))
const serviceType = ref('all')

// Always reloaded fresh (not gated on each store's `loaded` flag) — this is a planning report
// an operator may revisit repeatedly across a session, and it should reflect whatever's
// actually on disk right now, not a snapshot cached from whenever the app first booted or another
// view first happened to touch these stores.
onMounted(async () => {
  await Promise.all([servicesStore.load(), songsStore.load(), volunteersStore.load(), settingsStore.load()])
})

const volunteerNames = computed(() => new Map(volunteersStore.volunteers.map((v) => [v.id, `${v.firstName} ${v.lastName}`.trim()])))

const rows = computed(() =>
  buildPlanningReport(servicesStore.services, songsStore.songs, volunteerNames.value, {
    fromDate: fromDate.value,
    toDate: toDate.value,
    serviceType: serviceType.value,
  }),
)

const serviceTypeOptions = computed(() => [
  { title: 'All Types', value: 'all' },
  ...(settingsStore.librarySettings?.serviceTypes.map((type) => ({ title: type, value: type })) ?? []),
])

function exportPdf() {
  window.print()
}
</script>

<template>
  <v-container class="py-8 planning-report" style="max-width: 900px">
    <h1 class="text-h5 font-weight-bold mb-1">Multi-Week Planning Report</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">
      Praise team assignments and planned songs across a date range — a read-only report for planning a few weeks
      or months at once.
    </p>

    <v-card variant="outlined" class="pa-4 mb-6 no-print">
      <div class="d-flex flex-wrap align-end ga-4">
        <v-text-field v-model="fromDate" type="date" label="Start Date" variant="outlined" density="compact" hide-details style="width: 170px" />
        <v-text-field v-model="toDate" type="date" label="End Date" variant="outlined" density="compact" hide-details style="width: 170px" />
        <v-select v-model="serviceType" :items="serviceTypeOptions" label="Type" variant="outlined" density="compact" hide-details style="width: 220px" />
      </div>
    </v-card>

    <div v-for="row in rows" :key="row.serviceId" class="mb-4 pb-4 report-row">
      <div class="d-flex align-center justify-space-between">
        <div class="font-weight-bold">{{ row.dateLine }} · {{ row.type }}</div>
      </div>
      <div class="text-body-2 mt-1">
        <span v-if="row.sermonTitle">{{ row.sermonTitle }}</span>
        <span v-else class="text-medium-emphasis font-italic">Sermon title not yet decided</span>
        <span v-if="row.preacher"> — {{ row.preacher }}</span>
      </div>
      <div class="text-body-2 mt-2">
        <strong>Songs:</strong>
        <span v-if="row.songTitles.length">{{ row.songTitles.join(', ') }}</span>
        <span v-else class="text-medium-emphasis"> none planned yet</span>
      </div>
      <div class="text-body-2 mt-1">
        <strong>Praise Team / Building:</strong>
        <span v-if="row.roster.length">{{ row.roster.join(', ') }}</span>
        <span v-else class="text-medium-emphasis"> add these manually</span>
      </div>
    </div>
    <p v-if="rows.length === 0" class="text-medium-emphasis text-body-2">No services found in this range.</p>

    <div class="d-flex align-center justify-space-between mt-6 no-print">
      <span class="text-caption text-medium-emphasis">A shareable plan for the weeks ahead.</span>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-file-pdf-box" @click="exportPdf">Export PDF Report</v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.report-row {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
@media print {
  .no-print {
    display: none !important;
  }
}
</style>
