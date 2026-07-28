<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import PersonEditorDialog from '@/components/people/PersonEditorDialog.vue'
import { findRoleConflicts, isDateUnavailable } from '@/utils/rosterConflicts'
import type { RoleAssignment, Service } from '@/models/service'
import type { Person } from '@/models/library'
import { personDisplayName } from '@/models/library'
import { roleDisplayLabel } from '@/models/settings'

const route = useRoute()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()

const service = ref<Service>()

// `watch` called after an `await` (inside onMounted's async callback) runs outside Vue's
// synchronous component-setup tracking, so it isn't auto-stopped on unmount — stopping it
// explicitly is what actually scopes it to this view's lifetime rather than leaking forever.
let stopServiceWatch: (() => void) | undefined

onMounted(async () => {
  const [loaded] = await Promise.all([
    getAdapter().services.get(route.params.id as string),
    peopleStore.load(),
    settingsStore.load(),
  ])
  if (loaded) {
    if (!loaded.assignments) loaded.assignments = []
    service.value = loaded
  }
  isDirty.value = false
  stopServiceWatch = watch(service, () => (isDirty.value = true), { deep: true })
  saveHandler.value = saveRoster
})
onUnmounted(() => {
  stopServiceWatch?.()
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveRoster() {
  if (!service.value || saving.value) return
  saving.value = true
  try {
    await servicesStore.save(service.value)
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

const roster = computed(() => service.value?.assignments ?? [])

// Only roles actually present on this service's own assignments are shown — a template seeds
// sensible defaults once at creation (see CreateServiceView), but from then on this service's
// roster is its own thing, independent of both the template and the global role catalog.
const usedRoles = computed(() => [...new Set(roster.value.map((a) => a.role))])

interface DisplayGroup {
  name: string
  roles: string[]
}
const groupedRoles = computed<DisplayGroup[]>(() => {
  const groups: DisplayGroup[] = []
  const accountedFor = new Set<string>()
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    const roles = group.roles.filter((r) => usedRoles.value.includes(r))
    if (!roles.length) continue
    groups.push({ name: group.name, roles })
    roles.forEach((r) => accountedFor.add(r))
  }
  const leftover = usedRoles.value.filter((r) => !accountedFor.has(r))
  if (leftover.length) groups.push({ name: 'Other', roles: leftover })
  return groups
})

function roleLabel(role: string): string {
  return roleDisplayLabel(role, settingsStore.librarySettings?.roleGroups ?? [])
}

function assignmentsForRole(role: string): RoleAssignment[] {
  return roster.value.filter((a) => a.role === role)
}
function addAssignment(role: string) {
  service.value?.assignments?.push({ role, tentative: false })
}
async function removeAssignment(target: RoleAssignment) {
  if (!service.value?.assignments) return
  const name = personName(target.personId)
  const label = name ? `${name} (${target.role})` : `this ${target.role} assignment`
  if (!(await confirmDialog.confirm(`Remove ${label}?`, 'Remove'))) return
  if (!service.value?.assignments) return
  service.value.assignments = service.value.assignments.filter((a) => a !== target)
}

// Grouped like the role catalog itself, offering only roles not already in use on this
// service — picking one adds a single ad hoc row (via the existing "Add another {role}"
// button from there on), letting an operator go beyond whatever the template seeded.
interface RoleOption {
  type?: 'subheader'
  title: string
  value?: string
}
const addRoleItems = computed<RoleOption[]>(() => {
  const items: RoleOption[] = []
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    const options = group.roles.filter((r) => !usedRoles.value.includes(r))
    if (!options.length) continue
    items.push({ type: 'subheader', title: group.name })
    for (const role of options) items.push({ title: role, value: role })
  }
  return items
})
const roleToAdd = ref<string | null>(null)
function onAddRole(role: string | null) {
  if (!role) return
  addAssignment(role)
  roleToAdd.value = null
}

const personOptions = computed(() => peopleStore.people.map((p) => ({ title: personDisplayName(p), value: p.id })))
function personName(id: string | undefined): string {
  const person = peopleStore.people.find((p) => p.id === id)
  return person ? personDisplayName(person) : ''
}

const conflicts = computed(() => findRoleConflicts(roster.value))
function isConflicted(assignment: RoleAssignment): boolean {
  return !!assignment.personId && conflicts.value.some((c) => c.personId === assignment.personId)
}
function isUnavailable(assignment: RoleAssignment): boolean {
  if (!assignment.personId || !service.value) return false
  const person = peopleStore.people.find((p) => p.id === assignment.personId)
  return !!person && isDateUnavailable(service.value.date, person.unavailableDateRanges)
}

const conflictSummary = computed(() => {
  const parts: string[] = []
  for (const conflict of conflicts.value) {
    parts.push(`${personName(conflict.personId)} is assigned to both ${conflict.roles.map(roleLabel).join(' and ')}`)
  }
  for (const assignment of roster.value) {
    if (isUnavailable(assignment)) {
      parts.push(`${personName(assignment.personId)} marked unavailable this date (${roleLabel(assignment.role)})`)
    }
  }
  return parts
})

// People directory management — a lightweight "+ New Person" reachable right from the
// assignments page, rather than only through the People page, since that's the moment it's
// needed. The People page remains the full directory for everything else (edit/delete).
const personDialogOpen = ref(false)
function openAddPerson() {
  personDialogOpen.value = true
}
async function savePerson(person: Person) {
  await peopleStore.save(person)
}

// Composing/previewing is real; actually sending is deliberately not wired up to any mail
// transport (see adapters/types.ts's EmailPort.sendAssignments) — nothing here can dispatch a
// real email regardless of which adapter is running.
const emailDialogOpen = ref(false)
const emailSent = ref(false)
const recipientEmails = computed(() =>
  [...new Set(roster.value.map((a) => a.personId))]
    .map((id) => peopleStore.people.find((p) => p.id === id)?.email)
    .filter((email): email is string => !!email),
)
const emailBody = computed(() => {
  if (!service.value) return ''
  const lines = usedRoles.value.flatMap((role) =>
    assignmentsForRole(role).map(
      (a) => `${roleLabel(role)}: ${personName(a.personId) || '(unassigned)'}${a.tentative ? ' (tentative)' : ''}`,
    ),
  )
  return `Assignments for ${service.value.type} — ${service.value.date}\n\n${lines.join('\n')}`
})
function openEmailDialog() {
  emailSent.value = false
  emailDialogOpen.value = true
}
async function sendAssignmentsEmail() {
  if (!service.value) return
  await getAdapter().email.sendAssignments(service.value.id, recipientEmails.value, emailBody.value)
  emailSent.value = true
}
</script>

<template>
  <v-container v-if="service" class="py-8" style="max-width: 780px">
    <div class="d-flex align-center mb-1 ga-2">
      <v-btn variant="text" size="small" prepend-icon="mdi-chevron-left" :to="`/service/${service.id}`">
        {{ service.type }} — {{ service.date }}
      </v-btn>
    </div>
    <h1 class="text-h5 font-weight-bold mb-1">Assignments — {{ service.type }}, {{ service.date }}</h1>
    <p class="text-medium-emphasis text-body-2 mb-4">
      Assign people to each role. Conflicts (same person double-booked, or marked unavailable) are flagged
      automatically.
    </p>

    <v-alert v-if="conflictSummary.length" type="error" variant="tonal" class="mb-4">
      <div v-for="(line, index) in conflictSummary" :key="index">⚠ {{ line }}</div>
    </v-alert>

    <div v-for="group in groupedRoles" :key="group.name" class="mb-4">
      <div class="text-overline text-medium-emphasis mb-2">{{ group.name }}</div>
      <div v-for="role in group.roles" :key="role" class="mb-3">
        <div
          v-for="assignment in assignmentsForRole(role)"
          :key="`${role}-${assignmentsForRole(role).indexOf(assignment)}`"
          class="d-flex align-center ga-3 mb-2 pa-3 role-row"
          :class="{ 'role-row--conflict': isConflicted(assignment) || isUnavailable(assignment), 'role-row--tentative': assignment.tentative }"
        >
          <span class="role-name">{{ role }}</span>
          <v-select
            v-model="assignment.personId"
            :items="personOptions"
            label="Person"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            style="max-width: 240px"
          />
          <v-checkbox v-model="assignment.tentative" label="Tentative" density="compact" hide-details class="flex-shrink-0" />
          <v-chip v-if="isConflicted(assignment)" color="error" size="small" variant="flat">CONFLICT</v-chip>
          <v-chip v-if="isUnavailable(assignment)" color="error" size="small" variant="flat">UNAVAILABLE</v-chip>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="removeAssignment(assignment)" />
        </div>
        <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="addAssignment(role)">Add another {{ role }}</v-btn>
      </div>
    </div>
    <p v-if="groupedRoles.length === 0" class="text-medium-emphasis text-body-2 mb-2">
      No roles assigned yet for this service.
    </p>

    <v-select
      v-model="roleToAdd"
      :items="addRoleItems"
      label="+ Add Role"
      variant="outlined"
      density="compact"
      style="max-width: 280px"
      @update:model-value="onAddRole"
    />

    <div class="d-flex align-center justify-space-between mt-6">
      <div class="d-flex ga-3">
        <span class="text-caption text-medium-emphasis">Roles are managed in Settings → Roles</span>
        <v-btn variant="text" size="small" prepend-icon="mdi-account-plus-outline" @click="openAddPerson">
          + New Person
        </v-btn>
      </div>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-email-outline" @click="openEmailDialog">
        Send Assignments by Email
      </v-btn>
    </div>

    <PersonEditorDialog v-model="personDialogOpen" :role-groups="groupedRoles" @save="savePerson" />

    <v-dialog v-model="emailDialogOpen" max-width="520">
      <v-card>
        <v-card-title>Send Assignments by Email</v-card-title>
        <v-card-text>
          <p class="text-caption text-medium-emphasis mb-2">
            {{ recipientEmails.length }} recipient(s) with an email on file: {{ recipientEmails.join(', ') || 'none' }}
          </p>
          <v-textarea :model-value="emailBody" label="Message" variant="outlined" rows="8" readonly />
          <v-alert v-if="emailSent" type="info" variant="tonal" density="compact" class="mt-2">
            Not sent — email delivery isn't connected to a mail server in this build yet. Copy the message above to
            send it yourself for now.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" class="mr-2" @click="emailDialogOpen = false">Close</v-btn>
          <v-btn variant="flat" color="primary" @click="sendAssignmentsEmail">Send</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Service not found.</p>
  </v-container>
</template>

<style scoped>
.role-name {
  width: 130px;
  flex-shrink: 0;
  font-weight: 600;
  font-size: 13.5px;
}
.role-row {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
.role-row--conflict {
  border-color: rgb(var(--v-theme-error));
}
.role-row--tentative {
  border-style: dashed;
}
</style>
