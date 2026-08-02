<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { personDisplayName, personFormalName } from '@/models/library'
import { buildOrderOfWorship, toHtml, toPlainText } from '@/utils/orderOfWorship'
import { buildBulletinDocument } from '@/reports/builders/bulletin'
import { reportBranding } from '@/reports/branding'
import { exportCompletionMessage, exportDocumentReport } from '@/reports/exportReport'
import type { ReportFormat } from '@/reports/types'
import { localCalendarDate } from '@/utils/calendarDate'

const route = useRoute()
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const selectedServiceId = ref<string>()
const exportingFormat = ref<ReportFormat>()
const statusMessage = ref('')
const statusType = ref<'success' | 'error'>('success')

const serviceOptions = computed(() =>
  [...servicesStore.services]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((service) => ({
      title: `${formatDate(service.date)} · ${service.type}`,
      value: service.id,
    })),
)

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const selectedService = computed(() =>
  servicesStore.services.find((service) => service.id === selectedServiceId.value),
)
const personNames = computed(
  () => new Map(peopleStore.people.map((person) => [person.id, personDisplayName(person)])),
)
const formalPersonNames = computed(
  () => new Map(peopleStore.people.map((person) => [person.id, personFormalName(person)])),
)
const bulletin = computed(() =>
  selectedService.value
    ? buildOrderOfWorship(
        selectedService.value,
        songsStore.songs,
        slidesStore.slides,
        personNames.value,
        formalPersonNames.value,
      )
    : undefined,
)

onMounted(async () => {
  await Promise.all([
    servicesStore.loaded ? Promise.resolve() : servicesStore.load(),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    slidesStore.loaded ? Promise.resolve() : slidesStore.load(),
    peopleStore.loaded ? Promise.resolve() : peopleStore.load(),
    settingsStore.loaded ? Promise.resolve() : settingsStore.load(),
  ])

  const requestedServiceId = typeof route.query.service === 'string' ? route.query.service : ''
  if (servicesStore.services.some((service) => service.id === requestedServiceId)) {
    selectedServiceId.value = requestedServiceId
    return
  }

  const today = localCalendarDate()
  const nextService = [...servicesStore.services]
    .filter((service) => service.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  selectedServiceId.value = nextService?.id ?? serviceOptions.value[0]?.value
})

let statusTimeout: ReturnType<typeof setTimeout> | undefined
function showStatus(message: string, type: 'success' | 'error' = 'success') {
  statusMessage.value = message
  statusType.value = type
  clearTimeout(statusTimeout)
  statusTimeout = setTimeout(() => (statusMessage.value = ''), 3000)
}

async function exportBulletin(format: 'docx' | 'pdf') {
  if (!bulletin.value || !selectedService.value) return
  exportingFormat.value = format
  try {
    const report = buildBulletinDocument(
      bulletin.value,
      reportBranding(settingsStore.librarySettings),
      selectedService.value.date,
    )
    const result = await exportDocumentReport(report, format)
    if (result !== 'cancelled') showStatus(exportCompletionMessage(format, result))
  } catch (error) {
    console.error(`Failed to export bulletin as ${format}`, error)
    showStatus('Could not create the bulletin. Please try again.', 'error')
  } finally {
    exportingFormat.value = undefined
  }
}

async function copyBulletin() {
  if (!bulletin.value) return
  const html = toHtml(bulletin.value)
  const plainText = toPlainText(bulletin.value)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(plainText)
  }
  showStatus('Bulletin copied — paste it into an email or document')
}

const reports = [
  {
    to: '/reports/song-usage',
    eyebrow: 'Compliance',
    title: 'Song Usage',
    description:
      'Review every song used across completed services for planning, records, and CCLI reporting.',
    icon: 'mdi-music-note-check',
    color: 'primary',
    detail: 'Date range · Service type · Excel · PDF',
    action: 'Open usage report',
  },
  {
    to: '/reports/planning',
    eyebrow: 'Team Planning',
    title: 'Multi-Week Plan',
    description:
      'Share upcoming songs, sermon details, and team assignments across several weeks at once.',
    icon: 'mdi-calendar-text-outline',
    color: 'teal',
    detail: 'Date range · Assignments · Word · Excel · PDF',
    action: 'Open planning report',
  },
]
</script>

<template>
  <main class="reports-page">
    <header class="reports-hero">
      <div>
        <div class="page-eyebrow">Records &amp; Planning</div>
        <h1>Reports</h1>
        <p>Turn the information already in your services into focused, shareable documents.</p>
      </div>
      <div class="hero-mark" aria-hidden="true">
        <v-icon icon="mdi-file-chart-outline" size="34" />
      </div>
    </header>

    <section class="reports-directory" aria-labelledby="available-reports-heading">
      <div class="section-heading">
        <div>
          <span>Service Document</span>
          <h2 id="available-reports-heading">Bulletin / Order of Worship</h2>
        </div>
        <p>Generate a document from one service’s current order.</p>
      </div>

      <div class="bulletin-card">
        <span class="report-icon report-icon--amber"
          ><v-icon icon="mdi-newspaper-variant-outline" size="27"
        /></span>
        <div class="bulletin-copy">
          <h3>Create a service bulletin</h3>
          <p>Select a service, then create the finished file or copy its formatted order.</p>
        </div>
        <v-select
          v-model="selectedServiceId"
          :items="serviceOptions"
          label="Service"
          variant="outlined"
          density="compact"
          hide-details
          class="service-picker"
          :no-data-text="servicesStore.loaded ? 'No services available' : 'Loading services…'"
        />
        <div class="bulletin-actions">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-file-word-outline"
            :loading="exportingFormat === 'docx'"
            :disabled="!bulletin || !!exportingFormat"
            @click="exportBulletin('docx')"
          >
            Open Word
          </v-btn>
          <v-btn
            variant="outlined"
            prepend-icon="mdi-file-pdf-box"
            :loading="exportingFormat === 'pdf'"
            :disabled="!bulletin || !!exportingFormat"
            @click="exportBulletin('pdf')"
          >
            Open PDF
          </v-btn>
          <v-btn
            variant="text"
            icon="mdi-content-copy"
            aria-label="Copy formatted bulletin"
            :disabled="!bulletin || !!exportingFormat"
            @click="copyBulletin"
          />
        </div>
      </div>

      <v-alert
        v-if="statusMessage"
        :type="statusType"
        variant="tonal"
        density="compact"
        class="mt-3"
      >
        {{ statusMessage }}
      </v-alert>

      <div class="section-heading range-heading">
        <div>
          <span>Range Reports</span>
          <h2>Reporting across services</h2>
        </div>
        <p>Choose a report, set its range, then print or save it as a PDF.</p>
      </div>

      <div class="report-grid">
        <router-link v-for="report in reports" :key="report.to" :to="report.to" class="report-card">
          <span class="report-icon" :class="`report-icon--${report.color}`">
            <v-icon :icon="report.icon" size="26" />
          </span>
          <div class="report-copy">
            <span class="report-eyebrow">{{ report.eyebrow }}</span>
            <h3>{{ report.title }}</h3>
            <p>{{ report.description }}</p>
            <span class="report-detail">{{ report.detail }}</span>
          </div>
          <span class="report-action"
            >{{ report.action }} <v-icon icon="mdi-arrow-right" size="17"
          /></span>
        </router-link>
      </div>

      <aside class="report-guidance">
        <span class="guidance-icon"><v-icon icon="mdi-information-outline" size="21" /></span>
        <div>
          <strong>Reports stay connected to your service plans</strong>
          <p>
            There is no separate report data to maintain. Correct a song, assignment, or service
            detail at its source, then reopen the report to see the updated result.
          </p>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.reports-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 78% 0, rgba(var(--v-theme-primary), 0.055), transparent 430px),
    rgb(var(--v-theme-background));
}
.reports-hero,
.reports-directory {
  max-width: 1080px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.reports-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow,
.report-eyebrow,
.section-heading span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.reports-hero h1 {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
}
.reports-hero p {
  max-width: 620px;
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
}
.hero-mark {
  display: grid;
  width: 58px;
  height: 58px;
  flex: 0 0 58px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 15px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.reports-directory {
  padding: 24px;
}
.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 17px;
}
.section-heading h2 {
  margin: 2px 0 0;
  font-size: 1.05rem;
  font-weight: 680;
}
.section-heading p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.74rem;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.bulletin-card {
  display: grid;
  grid-template-columns: 48px minmax(190px, 1fr) minmax(220px, 0.75fr) auto;
  align-items: center;
  gap: 17px;
  padding: 18px 20px;
  border: 1px solid rgba(var(--v-theme-amber), 0.17);
  border-radius: 10px;
  background: rgba(var(--v-theme-amber), 0.035);
}
.bulletin-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.report-icon--amber {
  background: rgba(var(--v-theme-amber), 0.12);
  color: rgb(var(--v-theme-amber));
}
.bulletin-copy h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 680;
}
.bulletin-copy p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.71rem;
  line-height: 1.4;
}
.service-picker :deep(.v-field) {
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.38);
  font-size: 0.75rem;
}
.range-heading {
  margin-top: 28px;
}
.report-card {
  display: grid;
  min-height: 246px;
  grid-template-rows: auto 1fr auto;
  padding: 21px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.3);
  color: inherit;
  text-decoration: none;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    transform var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.report-card:hover,
.report-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.045);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.report-card:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 2px;
}
.report-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
}
.report-icon--primary {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.report-icon--teal {
  background: rgba(var(--v-theme-teal), 0.12);
  color: rgb(var(--v-theme-teal));
}
.report-copy {
  padding-top: 18px;
}
.report-copy h3 {
  margin: 3px 0 7px;
  font-size: 1.05rem;
  font-weight: 680;
}
.report-copy p {
  margin: 0 0 15px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
  line-height: 1.5;
}
.report-detail {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.66rem;
  font-weight: 620;
}
.report-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgb(var(--v-theme-primary));
  font-size: 0.73rem;
  font-weight: 680;
}
.report-guidance {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 18px;
  padding: 15px 17px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.23);
}
.guidance-icon {
  color: rgb(var(--v-theme-teal));
}
.report-guidance strong {
  display: block;
  font-size: 0.75rem;
}
.report-guidance p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
  line-height: 1.45;
}
@media (max-width: 720px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .bulletin-card {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .service-picker,
  .bulletin-actions {
    grid-column: 1 / -1;
  }
}
@media (max-width: 560px) {
  .reports-page {
    padding: 16px 12px 36px;
  }
  .reports-hero,
  .reports-directory {
    padding: 20px;
  }
  .hero-mark {
    display: none;
  }
}
</style>
