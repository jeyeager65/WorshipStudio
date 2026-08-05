<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { getAdapter } from '@/adapters'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import EditorNotFoundState from '@/components/EditorNotFoundState.vue'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import type { RemoteDevice } from '@/adapters/types'
import type { Person, UnavailableDateRange } from '@/models/library'

const titleSuggestions = ['Pastor', 'Elder', 'Mr.', 'Mrs.', 'Ms.', 'Dr.']

const route = useRoute()
const router = useRouter()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())

const person = ref<Person>()
const newRangeStart = ref('')
const newRangeEnd = ref('')
const validationMessage = ref('')
const editorLoading = ref(true)
const editorLoadError = ref('')
const notFound = ref(false)
const documentHistory = useDocumentHistory(person, 'person')
const remoteDevices = ref<RemoteDevice[]>([])
const pairDialogOpen = ref(false)
const pairing = ref(false)
const pairingDeviceId = ref<string>()
const newDeviceName = ref('')
const newDeviceAccessLevel = ref<RemoteDevice['accessLevel']>('view-only')
const pairingResult = ref<{ qrDataUrl: string; pairingUrl: string }>()
const categoryColors = [
  'primary',
  'teal',
  'violet',
  'terracotta',
  'rose',
  'slate',
  'secondary',
  'amber',
]

function blankPerson(): Person {
  return {
    id: `person-${crypto.randomUUID()}`,
    firstName: '',
    lastName: '',
    preferredRoles: [],
    unavailableDateRanges: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

const headingName = computed(() => {
  if (!person.value) return ''
  return (
    `${person.value.preferredName?.trim() || person.value.firstName} ${person.value.lastName}`.trim() ||
    'New Person'
  )
})

const initials = computed(() => {
  if (!person.value) return ''
  return `${person.value.firstName[0] ?? ''}${person.value.lastName[0] ?? ''}`.toUpperCase() || '?'
})
const personRemoteDevices = computed(() =>
  remoteDevices.value.filter((device) => device.personId === person.value?.id),
)
const accessLevelOptions: { title: string; value: RemoteDevice['accessLevel'] }[] = [
  { title: 'View Only', value: 'view-only' },
  { title: 'Full Control', value: 'full-control' },
]

function accessLevelLabel(level: RemoteDevice['accessLevel']): string {
  return accessLevelOptions.find((option) => option.value === level)?.title ?? level
}

async function loadRemoteDevices() {
  remoteDevices.value = (await getAdapter().remote?.listDevices()) ?? []
}

onMounted(loadEditor)

async function loadEditor() {
  documentHistory.stop()
  editorLoading.value = true
  editorLoadError.value = ''
  notFound.value = false
  try {
    const [peopleLoaded, settingsLoaded] = await Promise.all([
      peopleStore.load(),
      settingsStore.load(),
    ])
    if (!peopleLoaded || !settingsLoaded) {
      editorLoadError.value = peopleStore.loadError || settingsStore.loadError
      return
    }
    const isNew = route.params.id === 'new'
    const existing = peopleStore.people.find((candidate) => candidate.id === route.params.id)
    if (!isNew && !existing) {
      person.value = undefined
      notFound.value = true
      return
    }
    person.value = isNew ? blankPerson() : structuredClone(toRaw(existing!))
    if (!isNew) await loadRemoteDevices()
    isDirty.value = isNew
    documentHistory.start((dirty) => (isDirty.value = dirty), isNew)
    saveHandler.value = savePerson
  } catch (error) {
    person.value = undefined
    editorLoadError.value = errorMessage(error)
  } finally {
    editorLoading.value = false
  }
}

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
})

async function savePerson() {
  if (!person.value || saving.value) return
  if (!person.value.firstName.trim()) {
    validationMessage.value = 'Enter a first name before saving.'
    return
  }
  validationMessage.value = ''
  saving.value = true
  try {
    await peopleStore.save(person.value)
    isDirty.value = false
    if (route.params.id === 'new') await router.replace(`/people/${person.value.id}`)
  } finally {
    saving.value = false
  }
}

function openPairDialog() {
  newDeviceName.value = ''
  newDeviceAccessLevel.value = 'view-only'
  pairingResult.value = undefined
  pairDialogOpen.value = true
}

async function pairDevice() {
  if (!person.value || !newDeviceName.value.trim() || pairing.value) return
  pairing.value = true
  try {
    pairingResult.value = await getAdapter().remote?.provisionDevice(
      person.value.id,
      newDeviceName.value.trim(),
      newDeviceAccessLevel.value,
    )
    await loadRemoteDevices()
  } finally {
    pairing.value = false
  }
}

async function repairDevice(device: RemoteDevice) {
  pairingDeviceId.value = device.id
  try {
    pairingResult.value = await getAdapter().remote?.repairDevice(device.id)
    newDeviceName.value = device.name
    pairDialogOpen.value = true
  } finally {
    pairingDeviceId.value = undefined
  }
}

async function revokeDevice(device: RemoteDevice) {
  if (!(await confirmDialog.confirm(`Revoke ${device.name}'s Remote Control access?`, 'Revoke')))
    return
  await getAdapter().remote?.revokeDevice(device.id)
  await loadRemoteDevices()
}

function toggleRole(role: string) {
  if (!person.value) return
  const index = person.value.preferredRoles.indexOf(role)
  if (index === -1) person.value.preferredRoles.push(role)
  else person.value.preferredRoles.splice(index, 1)
}

function selectedRoleCount(roles: string[]): number {
  return roles.filter((role) => person.value?.preferredRoles.includes(role)).length
}

function addUnavailableRange() {
  if (!person.value || !newRangeStart.value || !newRangeEnd.value) return
  if (newRangeStart.value > newRangeEnd.value) {
    validationMessage.value = 'The unavailable end date must be on or after the start date.'
    return
  }
  validationMessage.value = ''
  person.value.unavailableDateRanges.push({ start: newRangeStart.value, end: newRangeEnd.value })
  newRangeStart.value = ''
  newRangeEnd.value = ''
}

async function removeUnavailableRange(range: UnavailableDateRange) {
  if (!person.value) return
  if (
    !(await confirmDialog.confirm(
      `Remove the unavailable range ${range.start} – ${range.end}?`,
      'Remove',
    ))
  )
    return
  person.value.unavailableDateRanges = person.value.unavailableDateRanges.filter(
    (candidate) => candidate !== range,
  )
}

function formatDateRange(range: UnavailableDateRange): string {
  const format = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return range.start === range.end
    ? format(range.start)
    : `${format(range.start)} – ${format(range.end)}`
}
</script>

<template>
  <AsyncLoadState
    v-if="editorLoading || editorLoadError"
    :loading="editorLoading"
    :error="editorLoadError"
    label="person"
    @retry="loadEditor"
  />
  <EditorNotFoundState
    v-else-if="notFound"
    icon="mdi-account-question-outline"
    title="Person Not Found"
    message="This person may have been deleted or moved."
    :back-to="{ path: '/people' }"
    back-label="Back to People"
  />
  <main v-else-if="person" class="person-editor-page">
    <header class="editor-header">
      <div class="header-content">
        <v-btn to="/people" variant="text" prepend-icon="mdi-arrow-left" class="back-button"
          >People</v-btn
        >
        <div class="identity-row">
          <div class="person-avatar">{{ initials }}</div>
          <div class="identity-copy">
            <div class="eyebrow">Person Editor</div>
            <h1>{{ headingName }}</h1>
            <p>{{ person.email || 'Add contact details and serving preferences below.' }}</p>
          </div>
        </div>
      </div>
    </header>

    <div class="editor-content">
      <v-alert
        v-if="peopleStore.mutationError"
        type="error"
        variant="tonal"
        closable
        @click:close="peopleStore.clearMutationError"
      >
        Person changes were not saved: {{ peopleStore.mutationError }}
      </v-alert>
      <v-alert
        v-if="validationMessage"
        type="warning"
        variant="tonal"
        closable
        @click:close="validationMessage = ''"
      >
        {{ validationMessage }}
      </v-alert>

      <section class="editor-section">
        <div class="section-heading">
          <span class="section-icon"><v-icon icon="mdi-account-outline" size="21" /></span>
          <div>
            <h2>Person Details</h2>
            <p>The name shown in the directory and optional contact information.</p>
          </div>
        </div>
        <div class="details-grid">
          <v-text-field
            v-model="person.firstName"
            label="First Name"
            variant="outlined"
            hide-details
          />
          <v-text-field
            v-model="person.lastName"
            label="Last Name"
            variant="outlined"
            hide-details
          />
          <v-text-field
            v-model="person.preferredName"
            label="Preferred Name"
            variant="outlined"
            hint="Optional first name used in the app, such as Dan for Daniel."
            persistent-hint
          />
          <v-combobox
            v-model="person.title"
            :items="titleSuggestions"
            label="Title"
            variant="outlined"
            hint="Optional formal title. Choose a suggestion or enter another title."
            persistent-hint
            clearable
          />
          <v-text-field
            v-model="person.email"
            label="Email Address"
            type="email"
            variant="outlined"
            hint="Used when sharing service assignments."
            persistent-hint
          />
        </div>
      </section>

      <section class="editor-section">
        <div class="section-heading">
          <span class="section-icon section-icon--roles"
            ><v-icon icon="mdi-shape-outline" size="21"
          /></span>
          <div>
            <h2>Preferred Roles</h2>
            <p>
              These roles appear first when assigning this person, but do not limit where they can
              serve.
            </p>
          </div>
        </div>
        <div v-if="settingsStore.librarySettings?.roleGroups.length" class="role-groups">
          <div
            v-for="(group, groupIndex) in settingsStore.librarySettings.roleGroups"
            :key="group.name"
            class="role-group"
            :style="{
              '--category-color': `rgb(var(--v-theme-${categoryColors[groupIndex % categoryColors.length]}))`,
            }"
          >
            <div class="role-group-heading">
              <span><v-icon icon="mdi-shape-outline" size="17" /></span>
              <div>
                <h3>{{ group.name }}</h3>
                <p>{{ selectedRoleCount(group.roles) }} selected</p>
              </div>
            </div>
            <div v-if="group.roles.length" class="role-options">
              <button
                v-for="role in group.roles"
                :key="role"
                type="button"
                class="role-option"
                :class="{ 'role-option--selected': person.preferredRoles.includes(role) }"
                @click="toggleRole(role)"
              >
                <v-icon
                  :icon="person.preferredRoles.includes(role) ? 'mdi-check' : 'mdi-plus'"
                  size="17"
                />
                {{ role }}
              </button>
            </div>
            <p v-else class="no-roles">No roles are configured in this category.</p>
          </div>
        </div>
        <div v-else class="empty-state">
          <v-icon icon="mdi-shape-outline" size="28" />
          <strong>No Role Categories</strong>
          <span>Add role categories in Settings before choosing preferred roles.</span>
        </div>
      </section>

      <section class="editor-section">
        <div class="section-heading">
          <span class="section-icon section-icon--availability"
            ><v-icon icon="mdi-calendar-outline" size="21"
          /></span>
          <div>
            <h2>Availability</h2>
            <p>Assignments that fall within these dates will be clearly flagged for planners.</p>
          </div>
        </div>
        <div class="availability-entry">
          <v-text-field
            v-model="newRangeStart"
            label="Start Date"
            type="date"
            variant="outlined"
            hide-details
          />
          <v-text-field
            v-model="newRangeEnd"
            label="End Date"
            type="date"
            variant="outlined"
            hide-details
          />
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-plus"
            @click="addUnavailableRange"
            >Add Dates</v-btn
          >
        </div>
        <div v-if="person.unavailableDateRanges.length" class="availability-list">
          <div
            v-for="range in person.unavailableDateRanges"
            :key="`${range.start}-${range.end}`"
            class="availability-item"
          >
            <span class="availability-item-icon"
              ><v-icon icon="mdi-calendar-remove-outline" size="20"
            /></span>
            <div>
              <strong>{{ formatDateRange(range) }}</strong>
              <span>Unavailable</span>
            </div>
            <v-btn
              icon="mdi-trash-can-outline"
              variant="text"
              color="error"
              aria-label="Remove unavailable dates"
              @click="removeUnavailableRange(range)"
            />
          </div>
        </div>
        <div v-else class="availability-empty">
          <v-icon icon="mdi-calendar-check-outline" size="25" />
          <div>
            <strong>No Unavailable Dates</strong
            ><span>This person is currently available for all dates.</span>
          </div>
        </div>
      </section>

      <section v-if="route.params.id !== 'new'" class="editor-section">
        <div class="section-heading section-heading--action">
          <span class="section-icon section-icon--devices">
            <v-icon icon="mdi-cellphone-link" size="21" />
          </span>
          <div>
            <h2>Remote Control Devices</h2>
            <p>Phones and tablets authorized to control presentations as this person.</p>
          </div>
          <v-btn variant="tonal" color="primary" prepend-icon="mdi-plus" @click="openPairDialog">
            Pair Device
          </v-btn>
        </div>

        <div v-if="personRemoteDevices.length" class="device-list">
          <div v-for="device in personRemoteDevices" :key="device.id" class="device-item">
            <span class="device-item-icon"><v-icon icon="mdi-cellphone" size="21" /></span>
            <div>
              <strong>{{ device.name }}</strong>
              <span>{{ accessLevelLabel(device.accessLevel) }}</span>
            </div>
            <div class="device-item-actions">
              <v-btn
                variant="text"
                size="small"
                prepend-icon="mdi-qrcode-scan"
                :loading="pairingDeviceId === device.id"
                @click="repairDevice(device)"
              >
                Re-pair
              </v-btn>
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                size="small"
                color="error"
                aria-label="Revoke device"
                @click="revokeDevice(device)"
              />
            </div>
          </div>
        </div>
        <div v-else class="devices-empty">
          <v-icon icon="mdi-cellphone-off" size="25" />
          <div>
            <strong>No Paired Devices</strong>
            <span>Pair a phone or tablet to give this person Remote Control access.</span>
          </div>
        </div>
      </section>
    </div>
  </main>
  <v-dialog v-model="pairDialogOpen" max-width="480">
    <v-card>
      <v-card-title>{{
        pairingResult ? 'Pair Device' : 'Pair a Device for ' + headingName
      }}</v-card-title>
      <v-card-text>
        <template v-if="!pairingResult">
          <v-text-field
            v-model="newDeviceName"
            label="Device Name"
            placeholder="e.g. iPhone or Tablet"
            variant="outlined"
            density="comfortable"
            autofocus
            class="mb-2"
          />
          <v-select
            v-model="newDeviceAccessLevel"
            :items="accessLevelOptions"
            label="Access Level"
            variant="outlined"
            density="comfortable"
          />
        </template>
        <template v-else>
          <div class="pairing-qr">
            <img :src="pairingResult.qrDataUrl" alt="Pairing QR code" />
          </div>
          <p class="text-body-2 text-center mb-2">
            Scan this code with {{ newDeviceName }}, or open the link directly on the device.
          </p>
          <p class="pairing-link">{{ pairingResult.pairingUrl }}</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="!pairingResult">
          <v-btn variant="text" @click="pairDialogOpen = false">Cancel</v-btn>
          <v-btn
            variant="flat"
            color="primary"
            :loading="pairing"
            :disabled="!newDeviceName.trim()"
            @click="pairDevice"
          >
            Generate QR Code
          </v-btn>
        </template>
        <v-btn v-else variant="flat" color="primary" @click="pairDialogOpen = false">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.person-editor-page {
  min-height: 100%;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}

.editor-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-surface), 0.76);
}

.header-content,
.editor-content {
  width: min(100%, 1120px);
  margin: 0 auto;
}

.header-content {
  padding: 18px 32px 24px;
}

.back-button {
  margin: 0 0 9px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  text-transform: none;
}

.identity-row {
  display: flex;
  align-items: center;
  gap: 17px;
}

.person-avatar {
  display: grid;
  width: 62px;
  height: 62px;
  flex: 0 0 62px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-size: 1.12rem;
  font-weight: 750;
}

.identity-copy {
  min-width: 0;
}

.eyebrow {
  margin-bottom: 2px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.identity-copy h1 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: clamp(1.55rem, 2.5vw, 2rem);
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-copy p {
  margin: 5px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.78rem;
}

.editor-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 32px 52px;
}

.editor-section {
  padding: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}

.section-heading {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin-bottom: 20px;
}

.section-heading--action {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
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

.section-icon--roles {
  background: rgba(var(--v-theme-violet), 0.12);
  color: rgb(var(--v-theme-violet));
}

.section-icon--availability {
  background: rgba(var(--v-theme-teal), 0.12);
  color: rgb(var(--v-theme-teal));
}

.section-icon--devices {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.section-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1rem;
  font-weight: 700;
}

.section-heading p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.76rem;
  line-height: 1.5;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 15px;
}

.editor-section :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
}

.editor-section :deep(.v-field__outline) {
  --v-field-border-opacity: 0.13;
}

.role-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}

.role-group {
  padding: 15px;
  border: 1px solid color-mix(in srgb, var(--category-color) 20%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--category-color) 6%, transparent);
  box-shadow: inset 3px 0 var(--category-color);
}

.role-group-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
}

.role-group-heading > span {
  color: var(--category-color);
}

.role-group-heading h3 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.82rem;
  font-weight: 700;
}

.role-group-heading p {
  margin: 1px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.68rem;
}

.role-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.role-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.36);
  color: rgba(var(--v-theme-on-surface), 0.68);
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
}

.role-option:hover {
  border-color: color-mix(in srgb, var(--category-color) 45%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.role-option--selected {
  border-color: color-mix(in srgb, var(--category-color) 42%, transparent);
  background: color-mix(in srgb, var(--category-color) 16%, transparent);
  color: var(--category-color);
}

.no-roles {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.74rem;
}

.availability-entry {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}

.availability-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
}

.availability-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 7px 8px 7px 11px;
  border: 1px solid rgba(var(--v-theme-warning), 0.2);
  border-radius: 8px;
  background: rgba(var(--v-theme-warning), 0.055);
}

.availability-item-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}

.availability-item > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.availability-item strong,
.availability-empty strong {
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.79rem;
}

.availability-item span,
.availability-empty span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
}

.availability-empty,
.empty-state {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 15px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 8px;
  color: rgb(var(--v-theme-teal));
  background: rgba(var(--v-theme-background), 0.28);
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-height: 62px;
  padding: 8px 9px 8px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.28);
}

.device-item-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.device-item > div:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.device-item strong,
.devices-empty strong {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.8rem;
}

.device-item span,
.devices-empty span {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.71rem;
}

.device-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.devices-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.28);
  color: rgb(var(--v-theme-primary));
}

.devices-empty > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pairing-qr {
  margin-bottom: 12px;
  text-align: center;
}

.pairing-qr img {
  width: 220px;
  height: 220px;
}

.pairing-link {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.7rem;
  text-align: center;
  word-break: break-all;
}

.availability-empty > div,
.empty-state {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.empty-state {
  align-items: center;
  text-align: center;
}

.empty-state strong {
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.82rem;
}

.empty-state span {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.74rem;
}

@media (max-width: 760px) {
  .role-groups {
    grid-template-columns: 1fr;
  }

  .availability-entry {
    grid-template-columns: 1fr 1fr;
  }

  .availability-entry > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 560px) {
  .header-content {
    padding: 14px 16px 20px;
  }

  .editor-content {
    gap: 16px;
    padding: 18px 12px 36px;
  }

  .editor-section {
    padding: 16px;
  }

  .details-grid,
  .availability-entry {
    grid-template-columns: 1fr;
  }

  .availability-entry > :last-child {
    grid-column: auto;
  }

  .section-heading--action {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .section-heading--action > .v-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .device-item {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .device-item-actions {
    grid-column: 1 / -1;
    justify-self: end;
  }
}
</style>
