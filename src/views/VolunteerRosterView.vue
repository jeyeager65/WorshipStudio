<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useVolunteersStore } from '@/stores/volunteers'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import VolunteerEditorDialog from '@/components/volunteers/VolunteerEditorDialog.vue'
import { findRoleConflicts, isDateUnavailable } from '@/utils/volunteerConflicts'
import type { RoleAssignment, Service } from '@/models/service'
import type { Volunteer } from '@/models/library'

const route = useRoute()
const servicesStore = useServicesStore()
const volunteersStore = useVolunteersStore()
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
    volunteersStore.load(),
    settingsStore.load(),
  ])
  if (loaded) {
    if (!loaded.volunteerRoster) loaded.volunteerRoster = []
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

const roleCatalog = computed(() => settingsStore.librarySettings?.volunteerRoles ?? [])
const roster = computed(() => service.value?.volunteerRoster ?? [])

function assignmentsForRole(role: string): RoleAssignment[] {
  return roster.value.filter((a) => a.role === role)
}
function addAssignment(role: string) {
  service.value?.volunteerRoster?.push({ role, tentative: false })
}
async function removeAssignment(target: RoleAssignment) {
  if (!service.value?.volunteerRoster) return
  const name = volunteerName(target.volunteerId)
  const label = name ? `${name} (${target.role})` : `this ${target.role} assignment`
  if (!(await confirmDialog.confirm(`Remove ${label}?`, 'Remove'))) return
  if (!service.value?.volunteerRoster) return
  service.value.volunteerRoster = service.value.volunteerRoster.filter((a) => a !== target)
}

const volunteerOptions = computed(() =>
  volunteersStore.volunteers.map((v) => ({ title: `${v.firstName} ${v.lastName}`, value: v.id })),
)
function volunteerName(id: string | undefined): string {
  const volunteer = volunteersStore.volunteers.find((v) => v.id === id)
  return volunteer ? `${volunteer.firstName} ${volunteer.lastName}` : ''
}

const conflicts = computed(() => findRoleConflicts(roster.value))
function isConflicted(assignment: RoleAssignment): boolean {
  return !!assignment.volunteerId && conflicts.value.some((c) => c.volunteerId === assignment.volunteerId)
}
function isUnavailable(assignment: RoleAssignment): boolean {
  if (!assignment.volunteerId || !service.value) return false
  const volunteer = volunteersStore.volunteers.find((v) => v.id === assignment.volunteerId)
  return !!volunteer && isDateUnavailable(service.value.date, volunteer.unavailableDateRanges)
}

const conflictSummary = computed(() => {
  const parts: string[] = []
  for (const conflict of conflicts.value) {
    parts.push(`${volunteerName(conflict.volunteerId)} is assigned to both ${conflict.roles.join(' and ')}`)
  }
  for (const assignment of roster.value) {
    if (isUnavailable(assignment)) {
      parts.push(`${volunteerName(assignment.volunteerId)} marked unavailable this date (${assignment.role})`)
    }
  }
  return parts
})

// Volunteer directory management — a lightweight "Add Volunteer" reachable right from the
// roster, rather than a separate directory screen, since that's the moment it's needed.
const volunteerDialogOpen = ref(false)
function openAddVolunteer() {
  volunteerDialogOpen.value = true
}
async function saveVolunteer(volunteer: Volunteer) {
  await volunteersStore.save(volunteer)
}

// Composing/previewing is real; actually sending is deliberately not wired up to any mail
// transport (see adapters/types.ts's EmailPort.sendVolunteerAssignments) — nothing here can
// dispatch a real email regardless of which adapter is running.
const emailDialogOpen = ref(false)
const emailSent = ref(false)
const recipientEmails = computed(() =>
  [...new Set(roster.value.map((a) => a.volunteerId))]
    .map((id) => volunteersStore.volunteers.find((v) => v.id === id)?.email)
    .filter((email): email is string => !!email),
)
const emailBody = computed(() => {
  if (!service.value) return ''
  const lines = roleCatalog.value.flatMap((role) =>
    assignmentsForRole(role).map(
      (a) => `${role}: ${volunteerName(a.volunteerId) || '(unassigned)'}${a.tentative ? ' (tentative)' : ''}`,
    ),
  )
  return `Volunteer assignments for ${service.value.type} — ${service.value.date}\n\n${lines.join('\n')}`
})
function openEmailDialog() {
  emailSent.value = false
  emailDialogOpen.value = true
}
async function sendAssignments() {
  if (!service.value) return
  await getAdapter().email.sendVolunteerAssignments(service.value.id, recipientEmails.value, emailBody.value)
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
    <h1 class="text-h5 font-weight-bold mb-1">Volunteer Roster — {{ service.type }}, {{ service.date }}</h1>
    <p class="text-medium-emphasis text-body-2 mb-4">
      Assign volunteers to each role. Conflicts (same person double-booked, or marked unavailable) are flagged
      automatically.
    </p>

    <v-alert v-if="conflictSummary.length" type="error" variant="tonal" class="mb-4">
      <div v-for="(line, index) in conflictSummary" :key="index">⚠ {{ line }}</div>
    </v-alert>

    <div v-for="role in roleCatalog" :key="role" class="mb-3">
      <div
        v-for="assignment in assignmentsForRole(role)"
        :key="`${role}-${assignmentsForRole(role).indexOf(assignment)}`"
        class="d-flex align-center ga-3 mb-2 pa-3 role-row"
        :class="{ 'role-row--conflict': isConflicted(assignment) || isUnavailable(assignment), 'role-row--tentative': assignment.tentative }"
      >
        <span class="role-name">{{ role }}</span>
        <v-select
          v-model="assignment.volunteerId"
          :items="volunteerOptions"
          label="Volunteer"
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
      <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="addAssignment(role)">Add to {{ role }}</v-btn>
    </div>
    <p v-if="roleCatalog.length === 0" class="text-medium-emphasis text-body-2">
      No volunteer roles configured yet — add some in Settings → Volunteer Roles.
    </p>

    <div class="d-flex align-center justify-space-between mt-6">
      <div class="d-flex ga-3">
        <span class="text-caption text-medium-emphasis">Roles are managed in Settings → Volunteer Roles</span>
        <v-btn variant="text" size="small" prepend-icon="mdi-account-plus-outline" @click="openAddVolunteer">
          Add Volunteer
        </v-btn>
      </div>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-email-outline" @click="openEmailDialog">
        Send Assignments by Email
      </v-btn>
    </div>

    <VolunteerEditorDialog
      v-model="volunteerDialogOpen"
      :role-options="roleCatalog"
      @save="saveVolunteer"
    />

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
          <v-btn variant="flat" color="primary" @click="sendAssignments">Send</v-btn>
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
