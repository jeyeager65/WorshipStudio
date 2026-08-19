<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useRolesStore } from '@/stores/roles'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { personDisplayName, personFormalName } from '@/models/library'
import { buildOrderOfWorship, toHtml, toPlainText } from '@/utils/orderOfWorship'
import { buildBulletinPage2, findNextWeekService } from '@/utils/bulletinPage2'
import { buildBulletinDocument } from '@/reports/builders/bulletin'
import { renderModernBulletin } from '@/reports/modernBulletin'
import { reportBranding } from '@/reports/branding'
import { exportCompletionMessage, exportDocumentReport, exportRawPdf } from '@/reports/exportReport'
import type { ReportFormat } from '@/reports/types'
import type { Service } from '@/models/service'
import { formatServiceTime } from '@/utils/serviceTime'
import { returnPath } from '@/utils/returnNavigation'
import BulletinSettingsDialog from '@/components/bulletin/BulletinSettingsDialog.vue'

const route = useRoute()
const backTo = computed(() =>
  returnPath(route.query.returnTo, `/service/${route.params.id as string}`),
)
const backLabel = computed(() =>
  backTo.value.includes('/plan') ? 'Back to Planning' : 'Back to Service',
)
const servicesStore = useServicesStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const songCollectionsStore = useSongCollectionsStore()
const announcementsStore = useAnnouncementsStore()
const rolesStore = useRolesStore()
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())

type BulletinStyle = 'classic' | 'modern'
const bulletinStyleOptions: { title: string; value: BulletinStyle }[] = [
  { title: 'Classic', value: 'classic' },
  { title: 'Modern', value: 'modern' },
]
const bulletinStyle = ref<BulletinStyle>('modern')
const exportingFormat = ref<ReportFormat>()
const statusMessage = ref('')
const statusType = ref<'success' | 'error'>('success')
const settingsDialogOpen = ref(false)

// Fetched fresh (not derived from servicesStore.services) so this page's own editable field —
// the two footer quotes — goes through the app's standard save/undo/redo mechanism instead of
// auto-saving on blur, same pattern as AssignmentsView.vue.
const service = ref<Service>()
const documentHistory = useDocumentHistory(service, 'bulletin')

onMounted(async () => {
  const [loaded] = await Promise.all([
    getAdapter().services.get(route.params.id as string),
    servicesStore.loaded ? Promise.resolve() : servicesStore.load(),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    slidesStore.loaded ? Promise.resolve() : slidesStore.load(),
    peopleStore.loaded ? Promise.resolve() : peopleStore.load(),
    settingsStore.loaded ? Promise.resolve() : settingsStore.load(),
    serviceTypesStore.loaded ? Promise.resolve() : serviceTypesStore.load(),
    songCollectionsStore.loaded ? Promise.resolve() : songCollectionsStore.load(),
    announcementsStore.loaded ? Promise.resolve() : announcementsStore.load(),
    rolesStore.loaded ? Promise.resolve() : rolesStore.load(),
  ])
  if (loaded) {
    service.value = loaded
    documentHistory.start((dirty) => (isDirty.value = dirty))
    saveHandler.value = saveBulletin
  }
  isDirty.value = false
})
onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
  pageTitleOverride.value = undefined
})

async function saveBulletin() {
  if (!service.value || saving.value) return
  saving.value = true
  try {
    await servicesStore.save(service.value)
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

// Matches the "weekday, month day, year" format already used for Assignments/the service
// workspace's own heading (see AssignmentsView.vue's identical serviceDateLabel).
const serviceDateLabel = computed(() => {
  if (!service.value) return ''
  const date = new Date(`${service.value.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const time = formatServiceTime(service.value.time)
  return time ? `${date} · ${time}` : date
})
const serviceTypeName = computed(
  () =>
    serviceTypesStore.serviceTypes.find((type) => type.id === service.value?.serviceTypeId)
      ?.name ?? '',
)

// This page has no static router meta.title (see App.vue's pageTitle) since its content is
// per-service — same pattern as AssignmentsView.vue.
watch(
  [serviceTypeName, serviceDateLabel],
  ([type, dateLabel]) => {
    pageTitleOverride.value = service.value ? `Bulletin — ${type} — ${dateLabel}` : undefined
  },
  { immediate: true },
)

const personNames = computed(
  () => new Map(peopleStore.people.map((person) => [person.id, personDisplayName(person)])),
)
const formalPersonNames = computed(
  () => new Map(peopleStore.people.map((person) => [person.id, personFormalName(person)])),
)
// RoleDefinition id -> display name for the serving schedule table — without this,
// buildBulletinPage2 falls back to printing the raw id (e.g. "role-nursery") for every row.
const roleNames = computed(() => new Map(rolesStore.roles.map((role) => [role.id, role.name])))
const bulletin = computed(() =>
  service.value
    ? buildOrderOfWorship(
        service.value,
        songsStore.songs,
        slidesStore.slides,
        personNames.value,
        formalPersonNames.value,
        settingsStore.librarySettings?.bulletin.page1,
        songCollectionsStore.collections,
      )
    : undefined,
)

// "Next Week" for the serving schedule — the *same recurring service type* dated exactly 7 days
// later (see findNextWeekService's own doc comment), not just whatever's chronologically next.
const nextWeekService = computed(() =>
  service.value ? findNextWeekService(servicesStore.services, service.value) : undefined,
)
const bulletinPage2 = computed(() =>
  service.value && settingsStore.librarySettings?.bulletin.page2.enabled
    ? buildBulletinPage2(
        service.value,
        nextWeekService.value,
        announcementsStore.announcements,
        settingsStore.librarySettings.bulletin,
        personNames.value,
        roleNames.value,
      )
    : undefined,
)

let statusTimeout: ReturnType<typeof setTimeout> | undefined
function showStatus(message: string, type: 'success' | 'error' = 'success') {
  statusMessage.value = message
  statusType.value = type
  clearTimeout(statusTimeout)
  statusTimeout = setTimeout(() => (statusMessage.value = ''), 3000)
}

async function exportBulletin(format: 'docx' | 'pdf') {
  if (!bulletin.value || !service.value) return
  exportingFormat.value = format
  try {
    if (bulletinStyle.value === 'modern') {
      // Modern is PDF-only (its icon badges, hairlines, and letter-spaced headings have no
      // reasonable Word equivalent) — the "Open Word" button is disabled whenever it's selected.
      const bytes = await renderModernBulletin(
        bulletin.value,
        bulletinPage2.value,
        reportBranding(settingsStore.librarySettings),
      )
      const result = await exportRawPdf(`Bulletin - ${service.value.date} (Modern)`, bytes)
      if (result !== 'cancelled') showStatus(exportCompletionMessage('pdf', result))
      return
    }
    const report = buildBulletinDocument(
      bulletin.value,
      reportBranding(settingsStore.librarySettings),
      service.value.date,
      bulletinPage2.value,
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
</script>

<template>
  <main v-if="service" class="bulletin-page">
    <header class="bulletin-hero">
      <div class="bulletin-hero-toolbar">
        <v-btn variant="text" size="small" prepend-icon="mdi-chevron-left" :to="backTo">
          {{ backLabel }}
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-cog-outline"
          @click="settingsDialogOpen = true"
        >
          Bulletin Settings
        </v-btn>
      </div>
      <div class="bulletin-hero-content">
        <div>
          <div class="page-eyebrow">Service Document</div>
          <h1>Bulletin</h1>
          <p class="service-context">{{ serviceTypeName }} <span>·</span> {{ serviceDateLabel }}</p>
          <p class="page-description">
            Review this week's order of worship and announcements, then export or copy the finished
            bulletin.
          </p>
        </div>
        <div class="hero-side">
          <v-select
            v-model="bulletinStyle"
            :items="bulletinStyleOptions"
            label="Style"
            variant="outlined"
            density="compact"
            hide-details
            class="style-picker"
          />
          <div class="bulletin-buttons">
            <v-btn
              class="bulletin-btn"
              color="primary"
              variant="flat"
              prepend-icon="mdi-file-pdf-box"
              :loading="exportingFormat === 'pdf'"
              :disabled="!bulletin || !!exportingFormat"
              @click="exportBulletin('pdf')"
            >
              Open PDF
            </v-btn>
            <v-btn
              class="bulletin-btn"
              :class="{ 'bulletin-btn--inactive': bulletinStyle === 'modern' }"
              variant="outlined"
              prepend-icon="mdi-file-word-outline"
              :loading="exportingFormat === 'docx'"
              :disabled="!bulletin || !!exportingFormat || bulletinStyle === 'modern'"
              @click="exportBulletin('docx')"
            >
              Open Word
            </v-btn>
            <v-btn
              class="bulletin-btn"
              :class="{ 'bulletin-btn--inactive': bulletinStyle === 'modern' }"
              variant="outlined"
              prepend-icon="mdi-content-copy"
              :disabled="!bulletin || !!exportingFormat || bulletinStyle === 'modern'"
              @click="copyBulletin"
            >
              Copy
            </v-btn>
          </div>
        </div>
      </div>
    </header>

    <v-alert
      v-if="statusMessage"
      :type="statusType"
      variant="tonal"
      density="compact"
      class="bulletin-status-alert"
    >
      {{ statusMessage }}
    </v-alert>

    <section
      v-if="
        settingsStore.librarySettings?.bulletin.page1.footer.enabled ||
        settingsStore.librarySettings?.bulletin.page2.footer.enabled
      "
      class="bulletin-footer-card"
    >
      <h2 class="footer-card-heading">Footer Content</h2>
      <div class="bulletin-footers">
        <v-textarea
          v-if="settingsStore.librarySettings?.bulletin.page1.footer.enabled"
          v-model="service.bulletinPage1Footer"
          :label="settingsStore.librarySettings.bulletin.page1.footer.title"
          variant="outlined"
          density="compact"
          rows="2"
          auto-grow
          hide-details
        />
        <v-textarea
          v-if="settingsStore.librarySettings?.bulletin.page2.footer.enabled"
          v-model="service.bulletinPage2Footer"
          :label="settingsStore.librarySettings.bulletin.page2.footer.title"
          variant="outlined"
          density="compact"
          rows="2"
          auto-grow
          hide-details
        />
      </div>
    </section>

    <section v-if="bulletin" class="bulletin-content-card">
      <div class="section-heading">
        <div>
          <h2>{{ bulletin.title }}</h2>
          <p class="section-subtitle">{{ bulletin.dateLine }}</p>
        </div>
      </div>
      <ol class="oow-list">
        <li v-for="(line, index) in bulletin.lines" :key="index" class="oow-line">
          <div class="oow-line-main">
            <span v-if="line.role" class="oow-role">{{ line.role }}</span>
            <span v-if="line.text" class="oow-text">{{ line.text }}</span>
            <span v-if="line.person" class="oow-person">{{ line.person }}</span>
          </div>
          <p v-if="line.note" class="oow-note">{{ line.note }}</p>
        </li>
      </ol>
    </section>

    <section v-if="bulletinPage2" class="bulletin-content-card">
      <div class="section-heading">
        <div>
          <h2>{{ bulletinPage2.title }}</h2>
        </div>
      </div>

      <div v-if="bulletinPage2.upcoming.length" class="page2-block">
        <h3>Upcoming</h3>
        <ul class="page2-list">
          <li v-for="(line, index) in bulletinPage2.upcoming" :key="index">
            <strong v-if="line.dateLabel">{{ line.dateLabel }}: </strong>{{ line.text }}
          </li>
        </ul>
      </div>

      <div v-if="bulletinPage2.general.length" class="page2-block">
        <h3>Announcements</h3>
        <ul class="page2-list">
          <li v-for="(line, index) in bulletinPage2.general" :key="index">{{ line.text }}</li>
        </ul>
      </div>

      <div v-if="bulletinPage2.servingSchedule" class="page2-block">
        <h3>Serving Schedule</h3>
        <v-table density="compact" class="serving-table">
          <thead>
            <tr>
              <th v-for="header in bulletinPage2.servingSchedule.headers" :key="header">
                {{ header }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in bulletinPage2.servingSchedule.rows" :key="row.role">
              <td>{{ row.role }}</td>
              <td>{{ row.thisWeek.join(', ') }}</td>
              <td>{{ row.nextWeek.join(', ') }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </section>

    <BulletinSettingsDialog v-model="settingsDialogOpen" />
  </main>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Service not found.</p>
  </v-container>
</template>

<style scoped>
.bulletin-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.bulletin-hero,
.bulletin-footer-card,
.bulletin-content-card {
  max-width: 1080px;
  margin: 0 auto 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.bulletin-hero {
  overflow: hidden;
}
.bulletin-hero-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 3px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.bulletin-hero-content {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 16px 27px 28px;
}
.hero-side {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 12px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.bulletin-hero-content h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
}
.service-context {
  display: flex;
  gap: 8px;
  margin: 6px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.92rem;
  font-weight: 600;
}
.service-context span {
  color: rgba(var(--v-theme-on-surface), 0.32);
}
.page-description {
  max-width: 620px;
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
}
.bulletin-footer-card,
.bulletin-content-card {
  padding: 20px 24px;
}
.footer-card-heading {
  margin: 0 0 14px;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.05rem;
  font-weight: 700;
}
.bulletin-status-alert {
  max-width: 1080px;
  margin: 0 auto 18px;
}
.style-picker {
  flex: 0 1 170px;
  min-width: 150px;
  /* The outlined variant's notched label sits partly above its own field box, so a plain
     flex-start against the button column leaves the field itself a touch high — nudge it down
     to line up the two boxes' actual top edges. */
  margin-top: -2px;
}
.style-picker :deep(.v-field) {
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.38);
  font-size: 0.75rem;
}
.bulletin-buttons {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
/* visibility (not display/v-if) so a style toggle that shows/hides Open Word or Copy never
   changes the button column's height or width — Modern just can't offer a Word export or a
   plain-text copy (see exportBulletin/copyBulletin), so their slot stays reserved but blank. */
.bulletin-btn--inactive {
  visibility: hidden;
}
.bulletin-footers {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.bulletin-footers > * {
  flex: 1;
  min-width: 240px;
}
.section-heading {
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.section-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.55rem;
  font-weight: 760;
  letter-spacing: -0.02em;
}
.section-subtitle {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.85rem;
}
.oow-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.oow-line {
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.oow-line:last-child {
  border-bottom: none;
}
.oow-line-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.oow-role {
  font-weight: 680;
}
.oow-text {
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.oow-person {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-style: italic;
  font-size: 0.85rem;
}
.oow-note {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-style: italic;
  font-size: 0.85rem;
}
.page2-block + .page2-block {
  margin-top: 20px;
}
.page2-block h3 {
  margin: 0 0 8px;
  font-size: 0.85rem;
  font-weight: 680;
}
.page2-list {
  margin: 0;
  padding-left: 20px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.9rem;
}
.page2-list li + li {
  margin-top: 4px;
}
.serving-table {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
}
@media (max-width: 720px) {
  .bulletin-hero-content {
    align-items: flex-start;
    flex-direction: column;
  }
  .hero-side {
    width: 100%;
    justify-content: flex-end;
  }
}
@media (max-width: 560px) {
  .bulletin-page {
    padding: 16px 12px 36px;
  }
  .bulletin-hero-content,
  .bulletin-footer-card,
  .bulletin-content-card {
    padding: 20px;
  }
  .hero-side {
    align-items: stretch;
    flex-direction: column;
  }
  .style-picker {
    flex: none;
  }
}
</style>
