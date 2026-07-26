<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSettingsStore } from '@/stores/settings'
import { computeCcliUsage, quickRangeDates, type QuickRange } from '@/utils/ccliUsage'

const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const settingsStore = useSettingsStore()

const today = new Date()
const initialRange = quickRangeDates('ytd', today)
const fromDate = ref(initialRange.fromDate)
const toDate = ref(initialRange.toDate)
const serviceType = ref('all')
const activeQuickRange = ref<QuickRange | undefined>('ytd')

onMounted(async () => {
  await Promise.all([
    servicesStore.loaded ? Promise.resolve() : servicesStore.load(),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    settingsStore.load(),
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
  ...(settingsStore.librarySettings?.serviceTypes.map((type) => ({ title: type, value: type })) ?? []),
])

function exportPdf() {
  // Native "print to PDF" rather than a bundled PDF library — this app deliberately avoids
  // matching CCLI's own upload format (see design/feature-spec.md's CCLI section), so a
  // clean printable report is all this needs, with no new dependency.
  window.print()
}
</script>

<template>
  <v-container class="py-8 ccli-report" style="max-width: 900px">
    <h1 class="text-h5 font-weight-bold mb-1">CCLI Reporting</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">Songs used across your services, for CCLI license reporting.</p>

    <v-card variant="outlined" class="pa-4 mb-6 no-print">
      <div class="d-flex flex-wrap align-end ga-4">
        <v-text-field
          v-model="fromDate"
          type="date"
          label="Start Date"
          variant="outlined"
          density="compact"
          hide-details
          style="width: 170px"
          @update:model-value="activeQuickRange = undefined"
        />
        <v-text-field
          v-model="toDate"
          type="date"
          label="End Date"
          variant="outlined"
          density="compact"
          hide-details
          style="width: 170px"
          @update:model-value="activeQuickRange = undefined"
        />
        <v-select
          v-model="serviceType"
          :items="serviceTypeOptions"
          label="Type"
          variant="outlined"
          density="compact"
          hide-details
          style="width: 220px"
        />
        <v-chip-group v-model="activeQuickRange" selected-class="text-primary" @update:model-value="applyQuickRange">
          <v-chip value="quarter" variant="outlined">This Quarter</v-chip>
          <v-chip value="ytd" variant="outlined">Year to Date</v-chip>
          <v-chip value="last-year" variant="outlined">Last Year</v-chip>
        </v-chip-group>
      </div>
    </v-card>

    <div class="d-flex ga-3 mb-6">
      <v-card variant="outlined" class="pa-4 flex-grow-1">
        <div class="text-h5 font-weight-bold">{{ summary.totalUses }}</div>
        <div class="text-caption text-medium-emphasis">Total Song Uses</div>
      </v-card>
      <v-card variant="outlined" class="pa-4 flex-grow-1">
        <div class="text-h5 font-weight-bold">{{ summary.uniqueSongs }}</div>
        <div class="text-caption text-medium-emphasis">Unique Songs</div>
      </v-card>
      <v-card variant="outlined" class="pa-4 flex-grow-1">
        <div class="text-h5 font-weight-bold">{{ summary.servicesIncluded }}</div>
        <div class="text-caption text-medium-emphasis">Services Included</div>
      </v-card>
    </div>

    <v-table>
      <thead>
        <tr>
          <th>Song</th>
          <th>CCLI #</th>
          <th>Author</th>
          <th>Times Used</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in summary.rows" :key="row.songId">
          <td class="font-weight-bold">{{ row.title }}</td>
          <td class="text-medium-emphasis">{{ row.ccli ?? '—' }}</td>
          <td>{{ row.author ?? '—' }}</td>
          <td class="font-weight-bold text-primary">{{ row.timesUsed }}</td>
        </tr>
      </tbody>
    </v-table>
    <p v-if="summary.rows.length === 0" class="text-medium-emphasis text-body-2 mt-4">
      No song usage found in this range.
    </p>

    <div class="d-flex align-center justify-space-between mt-6 no-print">
      <span class="text-caption text-medium-emphasis">
        A clean usage report for your own records or manual entry into CCLI's portal.
      </span>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-file-pdf-box" @click="exportPdf">Export PDF Report</v-btn>
    </div>
  </v-container>
</template>

<style scoped>
@media print {
  .no-print {
    display: none !important;
  }
}
</style>
