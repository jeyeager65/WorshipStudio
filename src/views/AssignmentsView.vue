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
import RoleAssignmentBlock from '@/components/assignments/RoleAssignmentBlock.vue'
import { findRoleConflicts, isDateUnavailable } from '@/utils/rosterConflicts'
import { planAssignmentResetFromTemplate } from '@/utils/serviceTemplate'
import type { RoleAssignment, Service } from '@/models/service'
import type { Person } from '@/models/library'
import { personDisplayName } from '@/models/library'
import { roleDisplayLabel } from '@/models/settings'

const route = useRoute()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())
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
  pageTitleOverride.value = undefined
})

// Matches the "weekday, month day, year" format already used for the Order of Worship export,
// planning report headers, and the service workspace's own heading (see
// ServiceWorkspaceView.vue's identical serviceDateLabel) — one consistent date presentation
// across the app instead of the raw "YYYY-MM-DD" stored on disk.
const serviceDateLabel = computed(() =>
  service.value
    ? new Date(`${service.value.date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '',
)
// This page has no static router meta.title (see App.vue's pageTitle) since its content is
// per-service — kept in sync here instead of only set once at mount, so renaming things
// upstream (were that ever possible from this page) wouldn't leave a stale app-bar title.
watch(
  [() => service.value?.type, serviceDateLabel],
  ([type, dateLabel]) => {
    pageTitleOverride.value = service.value ? `Assignments — ${type} — ${dateLabel}` : undefined
  },
  { immediate: true },
)

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

// Roles tied to an actual item currently on this service (e.g. the sermon's Preacher) — shown
// in their own Order of Service section, in the order those items appear, kept separate from
// the general staffing/volunteer roles below (the same item-vs-role-only split
// planAssignmentResetFromTemplate uses to decide what it's allowed to touch). Listed from the
// items themselves rather than `usedRoles` so a role an item needs but nothing's assigned to
// yet still shows up with a prompt to add its first assignment, instead of not appearing at all.
const orderOfServiceRoles = computed<string[]>(() => {
  const seen = new Set<string>()
  const roles: string[] = []
  for (const item of service.value?.items ?? []) {
    if (item.role && !seen.has(item.role)) {
      seen.add(item.role)
      roles.push(item.role)
    }
  }
  return roles
})
const usedStaffingRoles = computed(() => usedRoles.value.filter((r) => !orderOfServiceRoles.value.includes(r)))

interface DisplayGroup {
  name: string
  roles: string[]
  color: string
}
// Stable per-category color (same category, same color, driven by the category's own position
// in Settings → Roles) — mirrors PeopleView's categoryColor, reused here so a category reads
// consistently across both pages rather than introducing an unrelated palette.
const CATEGORY_COLORS = ['primary', 'secondary', 'teal', 'violet', 'rose', 'amber', 'slate', 'terracotta']
function categoryColor(groupName: string): string {
  const groups = settingsStore.librarySettings?.roleGroups ?? []
  const index = groups.findIndex((g) => g.name === groupName)
  return index === -1 ? 'slate' : CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}
function buildGroups(roles: string[]): DisplayGroup[] {
  const groups: DisplayGroup[] = []
  const accountedFor = new Set<string>()
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    const groupRoles = group.roles.filter((r) => roles.includes(r))
    if (!groupRoles.length) continue
    groups.push({ name: group.name, roles: groupRoles, color: categoryColor(group.name) })
    groupRoles.forEach((r) => accountedFor.add(r))
  }
  const leftover = roles.filter((r) => !accountedFor.has(r))
  if (leftover.length) groups.push({ name: 'Other', roles: leftover, color: 'slate' })
  return groups
}
// Order of Service roles, grouped by category the same way the Roles section below is —
// otherwise a role's own category name would end up repeated on every single item instead of
// shown once per group (roleLabel's "Category - Role" prefix is for contexts with no grouping
// at all, e.g. the email summary below).
const orderOfServiceGroups = computed<DisplayGroup[]>(() => buildGroups(orderOfServiceRoles.value))
// Staffing/volunteer roles only, for this page's own display.
const groupedRoles = computed<DisplayGroup[]>(() => buildGroups(usedStaffingRoles.value))
// Every used role including Order of Service ones, for PersonEditorDialog's "preferred roles"
// picker — unlike the page's own display, a new person should still be able to pick a role like
// Preacher as a preferred role, so this deliberately isn't narrowed to staffing roles only.
const allGroupedRoles = computed<DisplayGroup[]>(() => buildGroups(usedRoles.value))

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
    // Order of Service roles are managed exclusively in that section above, whether or not
    // they're currently used — never offered here too.
    const options = group.roles.filter((r) => !usedRoles.value.includes(r) && !orderOfServiceRoles.value.includes(r))
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

// Lets an operator bring a service's staffing roles back in sync after editing the service
// template post-creation (see planAssignmentResetFromTemplate) — scoped to roles the template
// seeds directly ('role-only' items); roles tied to an actual item on this service (e.g. the
// sermon's Preacher) are never touched, template or no template.
const resetDialogOpen = ref(false)
const resetTemplate = computed(() =>
  settingsStore.librarySettings?.serviceTemplates?.find((t) => t.serviceType === service.value?.type),
)
const resetPlan = computed(() => {
  if (!service.value || !resetTemplate.value) return null
  return planAssignmentResetFromTemplate(service.value, resetTemplate.value)
})
interface ResetRemoval {
  role: string
  personName?: string
}
const resetAdditions = computed(() => {
  if (!resetPlan.value) return []
  const counts = new Map<string, number>()
  for (const a of resetPlan.value.toAdd) counts.set(a.role, (counts.get(a.role) ?? 0) + 1)
  return [...counts.entries()].map(([role, count]) => `${roleLabel(role)}${count > 1 ? ` ×${count}` : ''}`)
})
const resetRemovals = computed<ResetRemoval[]>(() => {
  if (!resetPlan.value) return []
  return resetPlan.value.toRemove.map((a) => ({ role: roleLabel(a.role), personName: personName(a.personId) || undefined }))
})
function openResetDialog() {
  resetDialogOpen.value = true
}
function applyReset() {
  if (!service.value || !resetPlan.value) return
  const plan = resetPlan.value
  service.value.assignments = (service.value.assignments ?? []).filter((a) => !plan.toRemove.includes(a)).concat(plan.toAdd)
  resetDialogOpen.value = false
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

// A warning, not an error — plenty of people can genuinely fill two roles in the same service
// with no problem (e.g. the same person on Piano and Vocals), and there's no reasonable way to
// define which role combinations are actually fine vs. not, so this is a heads-up to double
// check, not a claim that something's wrong. Marked-unavailable is kept as a harder error below
// since that's the person saying outright they can't do this date.
const conflictLines = computed(() =>
  conflicts.value.map(
    (conflict) => `${personName(conflict.personId)} is assigned to both ${conflict.roles.map(roleLabel).join(' and ')}`,
  ),
)
const unavailableLines = computed(() =>
  roster.value
    .filter((assignment) => isUnavailable(assignment))
    .map((assignment) => `${personName(assignment.personId)} marked unavailable this date (${roleLabel(assignment.role)})`),
)

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
        {{ service.type }} — {{ serviceDateLabel }}
      </v-btn>
      <v-spacer />
      <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="openResetDialog">Reset from Template</v-btn>
    </div>
    <h1 class="text-h5 font-weight-bold mb-1">Assignments</h1>
    <p class="text-subtitle-1 text-medium-emphasis mb-1">{{ service.type }} — {{ serviceDateLabel }}</p>
    <p class="text-medium-emphasis text-body-2 mb-4">
      Assign people to each role. Double-booked people are flagged as a heads-up (often fine); anyone marked
      unavailable this date is flagged as an error.
    </p>

    <v-alert v-if="conflictLines.length" type="warning" variant="tonal" class="mb-3">
      <div v-for="(line, index) in conflictLines" :key="index">⚠ {{ line }}</div>
    </v-alert>
    <v-alert v-if="unavailableLines.length" type="error" variant="tonal" class="mb-4">
      <div v-for="(line, index) in unavailableLines" :key="index">⚠ {{ line }}</div>
    </v-alert>

    <div v-if="orderOfServiceGroups.length" class="mb-6">
      <div class="section-heading section-heading--order-of-service mb-3">
        <v-icon icon="mdi-book-open-page-variant-outline" size="22" class="mr-2" />
        Order of Service
      </div>
      <div v-for="group in orderOfServiceGroups" :key="group.name" class="mb-4">
        <div class="category-heading mb-2" :style="{ color: `rgb(var(--v-theme-${group.color}))` }">{{ group.name }}</div>
        <RoleAssignmentBlock
          v-for="role in group.roles"
          :key="role"
          :label="role"
          :assignments="assignmentsForRole(role)"
          :person-options="personOptions"
          :is-conflicted="isConflicted"
          :is-unavailable="isUnavailable"
          :color="group.color"
          @add="addAssignment(role)"
          @remove="removeAssignment"
        />
      </div>
    </div>

    <div v-if="groupedRoles.length" class="mb-4">
      <div class="section-heading section-heading--roles mb-3">
        <v-icon icon="mdi-account-group-outline" size="22" class="mr-2" />
        Roles
      </div>
      <div v-for="group in groupedRoles" :key="group.name" class="mb-4">
        <div class="category-heading mb-2" :style="{ color: `rgb(var(--v-theme-${group.color}))` }">{{ group.name }}</div>
        <RoleAssignmentBlock
          v-for="role in group.roles"
          :key="role"
          :label="role"
          :assignments="assignmentsForRole(role)"
          :person-options="personOptions"
          :is-conflicted="isConflicted"
          :is-unavailable="isUnavailable"
          :color="group.color"
          @add="addAssignment(role)"
          @remove="removeAssignment"
        />
      </div>
    </div>
    <p v-if="orderOfServiceGroups.length === 0 && groupedRoles.length === 0" class="text-medium-emphasis text-body-2 mb-2">
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

    <p class="text-caption text-medium-emphasis mt-6 mb-3">Roles are managed in Settings → Roles</p>
    <div class="d-flex align-center justify-space-between flex-wrap ga-3">
      <v-btn variant="tonal" color="primary" prepend-icon="mdi-account-plus-outline" @click="openAddPerson">New Person</v-btn>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-email-outline" @click="openEmailDialog">
        Send Assignments by Email
      </v-btn>
    </div>

    <PersonEditorDialog v-model="personDialogOpen" :role-groups="allGroupedRoles" @save="savePerson" />

    <v-dialog v-model="resetDialogOpen" max-width="480">
      <v-card>
        <v-card-title>Reset Assignments from Template</v-card-title>
        <v-card-text>
          <template v-if="!resetTemplate">
            <p class="text-medium-emphasis">
              No service template found for "{{ service.type }}". Add one in Settings → Service Templates first.
            </p>
          </template>
          <template v-else-if="resetAdditions.length === 0 && resetRemovals.length === 0">
            <p class="text-medium-emphasis">Assignments already match the template — nothing to change.</p>
          </template>
          <template v-else>
            <p class="text-caption text-medium-emphasis mb-3">
              Only staffing roles from the template are affected — roles tied to an actual item on this service (e.g.
              the sermon's Preacher) are never changed here.
            </p>
            <div v-if="resetAdditions.length" class="mb-3">
              <div class="text-overline text-medium-emphasis">Will add</div>
              <div v-for="(line, index) in resetAdditions" :key="`add-${index}`">+ {{ line }}</div>
            </div>
            <div v-if="resetRemovals.length">
              <div class="text-overline text-medium-emphasis">Will remove</div>
              <div v-for="(removal, index) in resetRemovals" :key="`remove-${index}`">
                − {{ removal.role }}<span v-if="removal.personName"> ({{ removal.personName }})</span>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="resetDialogOpen = false">
            {{ resetTemplate && (resetAdditions.length || resetRemovals.length) ? 'Cancel' : 'Close' }}
          </v-btn>
          <v-btn
            v-if="resetTemplate && (resetAdditions.length || resetRemovals.length)"
            variant="flat"
            color="primary"
            @click="applyReset"
          >
            Apply
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
.section-heading {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.section-heading--order-of-service {
  color: rgb(var(--v-theme-teal));
}
.section-heading--roles {
  color: rgb(var(--v-theme-secondary));
}
.category-heading {
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
