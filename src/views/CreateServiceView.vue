<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useServicesStore } from '@/stores/services'
import { useSettingsStore } from '@/stores/settings'
import { usePeopleStore } from '@/stores/people'
import type { Service } from '@/models/service'
import { personDisplayName, sortByPreferredRole } from '@/models/library'
import { applyServiceTemplate, defaultServiceTemplate } from '@/utils/serviceTemplate'
import { applySermonEdit } from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'

const router = useRouter()
const store = useServicesStore()
const settingsStore = useSettingsStore()
const peopleStore = usePeopleStore()

const date = ref(new Date().toISOString().slice(0, 10))
const time = ref('')
const type = ref('')
const sermonTitle = ref('')
const keyPassage = ref('')
const preacherId = ref<string>()
const templateName = ref<string | null>(null)

function selectDefaultTemplate(serviceType: string) {
  templateName.value = defaultServiceTemplate(settingsStore.librarySettings?.serviceTemplates, serviceType)?.serviceType ?? null
}

watch(type, selectDefaultTemplate)

onMounted(async () => {
  await Promise.all([settingsStore.load(), peopleStore.load()])
  const serviceTypes = settingsStore.librarySettings?.serviceTypes ?? []
  if (serviceTypes.length > 0) type.value = serviceTypes[0]
  else selectDefaultTemplate('')
})

const preacherOptions = computed(() =>
  sortByPreferredRole(peopleStore.people, 'Preacher').map((p) => ({ title: personDisplayName(p), value: p.id })),
)

const templateOptions = computed(() =>
  (settingsStore.librarySettings?.serviceTemplates ?? []).map((template) => {
    const defaultTemplate = defaultServiceTemplate(settingsStore.librarySettings?.serviceTemplates, type.value)
    return {
      title: template.serviceType === defaultTemplate?.serviceType ? `${template.serviceType} (Default)` : template.serviceType,
      value: template.serviceType,
    }
  }),
)
const selectedTemplate = computed(() =>
  settingsStore.librarySettings?.serviceTemplates.find((template) => template.serviceType === templateName.value),
)
const templateContentCount = computed(() => selectedTemplate.value?.items.filter((item) => item.kind !== 'role-only').length ?? 0)
const templateAssignmentCount = computed(
  () =>
    selectedTemplate.value?.items.reduce((count, item) => {
      if (item.kind === 'role-only') return count + (item.role ? (item.count ?? 1) : 0)
      return count + (item.role ? 1 : 0)
    }, 0) ?? 0,
)
const formattedDate = computed(() => {
  if (!date.value) return 'Choose a date'
  return new Date(`${date.value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})
const formattedTime = computed(() => formatServiceTime(time.value) ?? 'Time Not Set')
const selectedPreacherName = computed(() => preacherOptions.value.find((option) => option.value === preacherId.value)?.title)
const canCreate = computed(() => !!date.value && !!type.value)

// Seeds this service's items/assignments once from the template selected on this screen (see
// Settings > Service Templates) — after creation the two are independent; editing the template
// later never touches an already-created service.
function seedFromTemplate(): { items: Service['items']; assignments: Service['assignments'] } {
  const template = selectedTemplate.value
  if (!template) return { items: [], assignments: [] }
  return applyServiceTemplate(template)
}

// Handed to the workspace via the store rather than saved here — nothing is written to
// disk until its Save button is used, so backing out of a just-created service without
// saving leaves no trace (see ServiceWorkspaceView, which consumes and clears this).
function createService() {
  const { items, assignments } = seedFromTemplate()
  const service: Service = {
    id: `service-${crypto.randomUUID()}`,
    date: date.value,
    time: time.value || undefined,
    type: type.value,
    items,
    assignments,
    updatedAt: '',
    updatedByDevice: '',
  }
  // Only touch the sermon item at all if the operator actually entered something — many service
  // types (a members' meeting, e.g.) have no sermon, and shouldn't get one just because these
  // fields are always shown on this quick-create screen.
  if (sermonTitle.value || keyPassage.value || preacherId.value) {
    applySermonEdit(
      service,
      { title: sermonTitle.value, passageReference: keyPassage.value, preacherId: preacherId.value },
      selectedTemplate.value?.items.find((item) => item.kind === 'sermon')?.role,
      settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
    )
  }
  store.draftService = service
  router.push(`/service/${service.id}`)
}
</script>

<template>
  <main class="create-service-page">
    <header class="create-header">
      <div class="header-content">
        <v-btn to="/" variant="text" prepend-icon="mdi-arrow-left" class="back-button">Services</v-btn>
        <div class="page-eyebrow">Service Planning</div>
        <h1>Create Service</h1>
        <p>Choose the service details and optionally add the first sermon information before opening the workspace.</p>
      </div>
    </header>

    <div class="create-layout">
      <div class="form-sections">
        <section class="form-section">
          <div class="section-heading">
            <span class="section-icon"><v-icon icon="mdi-calendar-outline" size="21" /></span>
            <div>
              <h2>Service Details</h2>
              <p>These details identify the service throughout the schedule and reports.</p>
            </div>
          </div>
          <div class="details-grid">
            <v-text-field v-model="date" type="date" label="Service Date" variant="outlined" hide-details />
            <v-text-field v-model="time" type="time" step="300" label="Start Time" variant="outlined" hide-details clearable />
            <v-select
              v-model="type"
              :items="settingsStore.librarySettings?.serviceTypes ?? []"
              label="Service Type"
              variant="outlined"
              hide-details
              no-data-text="No service types configured"
              class="service-type-field"
            />
            <v-select
              v-model="templateName"
              :items="templateOptions"
              label="Service Template"
              placeholder="Blank Service"
              variant="outlined"
              hide-details
              clearable
              no-data-text="No templates configured"
              class="template-field"
            />
          </div>
          <v-alert
            v-if="settingsStore.loaded && !settingsStore.librarySettings?.serviceTypes.length"
            type="warning"
            variant="tonal"
            class="mt-4"
          >
            Add at least one service type in Settings before creating a service.
          </v-alert>
        </section>

        <section class="form-section">
          <div class="section-heading">
            <span class="section-icon section-icon--sermon"><v-icon icon="mdi-book-open-page-variant-outline" size="21" /></span>
            <div>
              <h2>Sermon Details</h2>
              <p>Optional starting information. Everything here can be added or changed later.</p>
            </div>
          </div>
          <div class="sermon-fields">
            <v-text-field
              v-model="sermonTitle"
              label="Sermon Title"
              placeholder="Our Lord's Prayer"
              variant="outlined"
              hide-details
            />
            <div class="details-grid">
              <v-text-field
                v-model="keyPassage"
                label="Key Passage"
                placeholder="Matthew 6:9–13"
                variant="outlined"
                hide-details
              />
              <v-select
                v-model="preacherId"
                :items="preacherOptions"
                label="Preacher"
                variant="outlined"
                clearable
                hide-details
                no-data-text="No people available"
              />
            </div>
          </div>
          <p class="section-note"><v-icon icon="mdi-information-outline" size="17" />Preachers are managed from the People directory.</p>
        </section>
      </div>

      <aside class="service-summary">
        <div class="summary-heading">
          <span><v-icon icon="mdi-church-outline" size="23" /></span>
          <div><div class="summary-kicker">New Service</div><h2>{{ type || 'Select a Service Type' }}</h2></div>
        </div>
        <div class="summary-date">
          <v-icon icon="mdi-calendar-outline" size="19" />
          <div><span>{{ formattedDate }}</span><small>{{ formattedTime }}</small></div>
        </div>

        <div class="summary-section">
          <div class="summary-label">Starting Template</div>
          <template v-if="selectedTemplate">
            <div class="template-name"><v-icon icon="mdi-file-tree-outline" size="19" /><span>{{ selectedTemplate.serviceType }}</span></div>
            <div class="template-stats">
              <div><strong>{{ templateContentCount }}</strong><span>Order Items</span></div>
              <div><strong>{{ templateAssignmentCount }}</strong><span>Assignments</span></div>
            </div>
            <p>The template creates placeholders and assignment rows that you can complete in the service workspace.</p>
          </template>
          <div v-else class="no-template">
            <v-icon icon="mdi-file-outline" size="22" />
            <div><strong>Blank Service</strong><span>No template is configured for this service type.</span></div>
          </div>
        </div>

        <div v-if="sermonTitle || keyPassage || selectedPreacherName" class="summary-section sermon-preview">
          <div class="summary-label">Sermon</div>
          <strong>{{ sermonTitle || 'Title Not Decided' }}</strong>
          <span v-if="keyPassage"><v-icon icon="mdi-book-open-variant" size="16" />{{ keyPassage }}</span>
          <span v-if="selectedPreacherName"><v-icon icon="mdi-account-voice" size="16" />{{ selectedPreacherName }}</span>
        </div>

        <div class="save-note">
          <v-icon icon="mdi-content-save-outline" size="18" />
          <p>This creates an unsaved draft. Use Save in the workspace when you are ready to keep it.</p>
        </div>
        <div class="summary-actions">
          <v-btn variant="outlined" to="/">Cancel</v-btn>
          <v-btn
            variant="flat"
            color="primary"
            :disabled="!canCreate"
            append-icon="mdi-arrow-right"
            @click="createService"
          >
            Create and Open Service
          </v-btn>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.create-service-page {
  min-height: calc(100vh - 49px);
  background:
    radial-gradient(circle at 76% 0, rgba(var(--v-theme-primary), 0.05), transparent 430px),
    rgb(var(--v-theme-background));
}
.create-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-surface), 0.76);
}
.header-content,
.create-layout {
  width: min(100%, 1120px);
  margin: 0 auto;
}
.header-content {
  padding: 18px 32px 24px;
}
.back-button {
  margin: 0 0 8px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  text-transform: none;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.create-header h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: clamp(1.55rem, 2.5vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.create-header p {
  max-width: 680px;
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.8rem;
  line-height: 1.5;
}
.create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 22px;
  align-items: start;
  padding: 28px 32px 52px;
}
.form-sections {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
}
.form-section,
.service-summary {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.form-section {
  padding: 22px;
}
.section-heading {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin-bottom: 20px;
}
.section-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.section-icon--sermon {
  background: rgba(var(--v-theme-violet), 0.12);
  color: rgb(var(--v-theme-violet));
}
.section-heading h2,
.summary-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1rem;
  font-weight: 700;
}
.section-heading p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.75rem;
  line-height: 1.5;
}
.details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.service-type-field,
.template-field {
  grid-column: 1 / -1;
}
.sermon-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-section :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
}
.form-section :deep(.v-field__outline) {
  --v-field-border-opacity: 0.13;
}
.section-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 2px 0;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.7rem;
}
.service-summary {
  position: sticky;
  top: 72px;
  overflow: hidden;
  padding: 20px;
}
.summary-heading {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.summary-heading > span {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.summary-heading h2 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-kicker,
.summary-label {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.summary-date {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 15px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.74rem;
}
.summary-date .v-icon {
  color: rgb(var(--v-theme-primary));
}
.summary-date > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.summary-date small {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.67rem;
}
.summary-section {
  margin-top: 18px;
  padding-top: 17px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-label {
  margin-bottom: 9px;
}
.template-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.76rem;
  font-weight: 650;
}
.template-name .v-icon {
  color: rgb(var(--v-theme-teal));
}
.template-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 11px;
}
.template-stats > div {
  display: flex;
  flex-direction: column;
  padding: 9px 10px;
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.34);
}
.template-stats strong {
  color: rgb(var(--v-theme-teal));
  font-size: 0.95rem;
}
.template-stats span,
.summary-section > p {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.66rem;
}
.summary-section > p {
  margin: 10px 0 0;
  line-height: 1.5;
}
.no-template {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.no-template > div,
.sermon-preview {
  display: flex;
  flex-direction: column;
}
.no-template strong,
.sermon-preview > strong {
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.75rem;
}
.no-template span,
.sermon-preview > span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
}
.sermon-preview {
  gap: 6px;
}
.sermon-preview .summary-label {
  margin-bottom: 2px;
}
.sermon-preview > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.save-note {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  margin-top: 18px;
  padding: 11px;
  border-radius: 7px;
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
}
.save-note p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.68rem;
  line-height: 1.45;
}
.summary-actions {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  margin-top: 18px;
}
@media (max-width: 850px) {
  .create-layout {
    grid-template-columns: 1fr;
  }
  .service-summary {
    position: static;
    grid-row: 1;
  }
}
@media (max-width: 560px) {
  .header-content {
    padding: 14px 16px 20px;
  }
  .create-layout {
    gap: 16px;
    padding: 18px 12px 36px;
  }
  .form-section,
  .service-summary {
    padding: 16px;
  }
  .details-grid {
    grid-template-columns: 1fr;
  }
  .summary-actions {
    grid-template-columns: 1fr;
  }
}
</style>
