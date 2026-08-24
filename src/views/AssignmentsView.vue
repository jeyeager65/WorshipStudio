<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useServiceTemplatesStore } from '@/stores/serviceTemplates'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import PersonEditorDialog from '@/components/people/PersonEditorDialog.vue'
import RoleAssignmentBlock from '@/components/assignments/RoleAssignmentBlock.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import EditorNotFoundState from '@/components/EditorNotFoundState.vue'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { findRoleConflicts, isDateUnavailable } from '@/utils/rosterConflicts'
import { personOptionsForRole as personOptionsForRoleShared } from '@/utils/personOptions'
import { roleOptionsFor } from '@/utils/roleOptions'
import { defaultServiceTemplate, planAssignmentResetFromTemplate } from '@/utils/serviceTemplate'
import type { RoleAssignment, Service } from '@/models/service'
import type { Person } from '@/models/library'
import { personDisplayName } from '@/models/library'
import { roleDisplayLabel } from '@/models/settings'
import { formatServiceTime } from '@/utils/serviceTime'
import { returnPath } from '@/utils/returnNavigation'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import {
  assignmentEmailRosterLines,
  emailDraftText,
  mailtoUrl,
  uniqueEmailAddresses,
} from '@/utils/emailDraft'

const route = useRoute()
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const serviceTemplatesStore = useServiceTemplatesStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()
const backTo = computed(() =>
  returnPath(route.query.returnTo, `/service/${route.params.id as string}`),
)
const backLabel = computed(() =>
  backTo.value.includes('/plan') ? 'Back to Planning' : 'Back to Service',
)

const service = ref<Service>()
const editorLoading = ref(true)
const editorLoadError = ref('')
const notFound = ref(false)
const documentHistory = useDocumentHistory(service, 'assignments')

onMounted(loadAssignments)

async function loadAssignments() {
  editorLoading.value = true
  editorLoadError.value = ''
  notFound.value = false
  try {
    const [loaded, peopleLoaded, settingsLoaded] = await Promise.all([
      getAdapter().services.get(route.params.id as string),
      peopleStore.load(),
      settingsStore.load(),
      serviceTypesStore.load(),
      serviceTemplatesStore.load(),
      roleGroupsStore.load(),
      rolesStore.load(),
    ])
    if (!peopleLoaded || !settingsLoaded) {
      editorLoadError.value = peopleStore.loadError || settingsStore.loadError
      return
    }
    if (!loaded) {
      notFound.value = true
      return
    }
    if (!loaded.assignments) loaded.assignments = []
    service.value = loaded
    documentHistory.start((dirty) => (isDirty.value = dirty))
    saveHandler.value = saveRoster
  } catch (error) {
    editorLoadError.value = errorMessage(error)
  } finally {
    isDirty.value = false
    editorLoading.value = false
  }
}
onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
  pageTitleOverride.value = undefined
})

// Matches the "weekday, month day, year" format already used for the Order of Worship export,
// planning report headers, and the service workspace's own heading (see
// ServiceWorkspaceView.vue's identical serviceDateLabel) — one consistent date presentation
// across the app instead of the raw "YYYY-MM-DD" stored on disk.
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
// per-service — kept in sync here instead of only set once at mount, so renaming things
// upstream (were that ever possible from this page) wouldn't leave a stale app-bar title.
watch(
  [serviceTypeName, serviceDateLabel],
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
const usedRoles = computed(() => [...new Set(roster.value.map((a) => a.roleId))])

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
    if (item.roleId && !seen.has(item.roleId)) {
      seen.add(item.roleId)
      roles.push(item.roleId)
    }
  }
  return roles
})
const usedStaffingRoles = computed(() =>
  usedRoles.value.filter((r) => !orderOfServiceRoles.value.includes(r)),
)

interface DisplayGroup {
  name: string
  /** RoleDefinition ids. */
  roles: string[]
  color: string
}
// Stable per-category color (same category, same color, driven by the category's own position
// in Settings → Roles) — mirrors PeopleView's categoryColor, reused here so a category reads
// consistently across both pages rather than introducing an unrelated palette.
// Keep category identity separate from operational warning/error colors. The most common
// groups receive blue, teal, violet, and terracotta first; amber and brass are deliberately
// last because they sit too close to the warning palette used for assignment conflicts.
const CATEGORY_COLORS = [
  'primary',
  'teal',
  'violet',
  'terracotta',
  'rose',
  'slate',
  'secondary',
  'amber',
]
function categoryColor(groupId: string): string {
  const index = roleGroupsStore.roleGroups.findIndex((g) => g.id === groupId)
  return index === -1 ? 'slate' : CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}
function buildGroups(roleIds: string[]): DisplayGroup[] {
  const groups: DisplayGroup[] = []
  const accountedFor = new Set<string>()
  for (const group of roleGroupsStore.roleGroups) {
    const roleIdsInGroup = rolesStore.roles
      .filter((role) => role.groupId === group.id)
      .map((role) => role.id)
    const groupRoles = roleIdsInGroup.filter((id) => roleIds.includes(id))
    if (!groupRoles.length) continue
    groups.push({ name: group.name, roles: groupRoles, color: categoryColor(group.id) })
    groupRoles.forEach((id) => accountedFor.add(id))
  }
  const leftover = roleIds.filter((id) => !accountedFor.has(id))
  if (leftover.length) groups.push({ name: 'Other', roles: leftover, color: 'slate' })
  return groups
}
// Order of Service roles, grouped by category the same way the Roles section below is —
// otherwise a role's own category name would end up repeated on every single item instead of
// shown once per group (roleLabel's "Category - Role" prefix is for contexts with no grouping
// at all).
const orderOfServiceGroups = computed<DisplayGroup[]>(() => buildGroups(orderOfServiceRoles.value))
// Staffing/volunteer roles only, for this page's own display.
const groupedRoles = computed<DisplayGroup[]>(() => buildGroups(usedStaffingRoles.value))
// Every used role including Order of Service ones, for PersonEditorDialog's "preferred roles"
// picker — unlike the page's own display, a new person should still be able to pick a role like
// Preacher as a preferred role, so this deliberately isn't narrowed to staffing roles only.
const allGroupedRoles = computed<DisplayGroup[]>(() => buildGroups(usedRoles.value))

function roleName(roleId: string): string {
  return rolesStore.roles.find((role) => role.id === roleId)?.name ?? roleId
}
function roleLabel(roleId: string): string {
  return roleDisplayLabel(roleId, rolesStore.roles, roleGroupsStore.roleGroups)
}

function assignmentsForRole(roleId: string): RoleAssignment[] {
  return roster.value.filter((a) => a.roleId === roleId)
}
function addAssignment(roleId: string) {
  service.value?.assignments?.push({ roleId, tentative: false })
}
async function removeAssignment(target: RoleAssignment) {
  if (!service.value?.assignments) return
  const name = personName(target.personId)
  const targetRoleName = roleName(target.roleId)
  const label = name ? `${name} (${targetRoleName})` : `this ${targetRoleName} assignment`
  if (!(await confirmDialog.confirm(`Remove ${label}?`, 'Remove'))) return
  if (!service.value?.assignments) return
  service.value.assignments = service.value.assignments.filter((a) => a !== target)
}

// Grouped like the role catalog itself, offering only roles not already in use on this
// service — picking one adds a single ad hoc row (via the existing "Add another {role}"
// button from there on), letting an operator go beyond whatever the template seeded.
const addRoleItems = computed(() => {
  const availableRoles = rolesStore.roles.filter(
    (role) => !usedRoles.value.includes(role.id) && !orderOfServiceRoles.value.includes(role.id),
  )
  return roleOptionsFor(availableRoles, roleGroupsStore.roleGroups)
})
const roleToAdd = ref<string | null>(null)
function onAddRole(roleId: string | null) {
  if (!roleId) return
  addAssignment(roleId)
  roleToAdd.value = null
}

// Lets an operator bring a service's staffing roles back in sync after editing the service
// template post-creation (see planAssignmentResetFromTemplate) — scoped to roles the template
// seeds directly ('role-only' items); roles tied to an actual item on this service (e.g. the
// sermon's Preacher) are never touched, template or no template.
const resetDialogOpen = ref(false)
const resetTemplate = computed(() =>
  defaultServiceTemplate(serviceTemplatesStore.serviceTemplates, service.value?.serviceTypeId ?? ''),
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
  for (const a of resetPlan.value.toAdd) counts.set(a.roleId, (counts.get(a.roleId) ?? 0) + 1)
  return [...counts.entries()].map(
    ([roleId, count]) => `${roleLabel(roleId)}${count > 1 ? ` ×${count}` : ''}`,
  )
})
const resetRemovals = computed<ResetRemoval[]>(() => {
  if (!resetPlan.value) return []
  return resetPlan.value.toRemove.map((a) => ({
    role: roleLabel(a.roleId),
    personName: personName(a.personId) || undefined,
  }))
})
function openResetDialog() {
  resetDialogOpen.value = true
}
function applyReset() {
  if (!service.value || !resetPlan.value) return
  const plan = resetPlan.value
  service.value.assignments = (service.value.assignments ?? [])
    .filter((a) => !plan.toRemove.includes(a))
    .concat(plan.toAdd)
  resetDialogOpen.value = false
}

function personOptionsForRole(roleId: string) {
  return personOptionsForRoleShared(peopleStore.people, roleId)
}
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
    (conflict) =>
      `${personName(conflict.personId)} is assigned to both ${conflict.roleIds.map(roleLabel).join(' and ')}`,
  ),
)
const unavailableLines = computed(() =>
  roster.value
    .filter((assignment) => isUnavailable(assignment))
    .map(
      (assignment) =>
        `${personName(assignment.personId)} marked unavailable this date (${roleLabel(assignment.roleId)})`,
    ),
)
const filledAssignmentCount = computed(
  () => roster.value.filter((assignment) => assignment.personId).length,
)
const openAssignmentCount = computed(
  () => roster.value.filter((assignment) => !assignment.personId).length,
)
const tentativeAssignmentCount = computed(
  () => roster.value.filter((assignment) => assignment.tentative).length,
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

const emailDialogOpen = ref(false)
const emailSubject = ref('')
const emailMessage = ref('')
const emailActionStatus = ref('')
const emailActionError = ref('')
const openingEmailApp = ref(false)
const showRecipientEmails = ref(false)
const assignedPeople = computed(() =>
  [...new Set(roster.value.map((assignment) => assignment.personId).filter(Boolean))]
    .map((id) => peopleStore.people.find((person) => person.id === id))
    .filter((person): person is Person => !!person),
)
const recipientEmails = computed(() =>
  uniqueEmailAddresses(assignedPeople.value.map((person) => person.email)),
)
const peopleMissingEmail = computed(() =>
  assignedPeople.value.filter((person) => !person.email?.trim()),
)
const emailDraft = computed(() => ({
  to: recipientEmails.value,
  subject: emailSubject.value.trim(),
  body: emailMessage.value.trim(),
}))
function assignmentEmailBody(): string {
  if (!service.value) return ''
  // assignmentEmailRosterLines matches group.roles entries against each assignment's role by
  // exact string equality, with no id-vs-name distinction of its own — resolved to display
  // names here, consistently on both sides, so the printed email is human-readable.
  const groups = buildGroups(usedRoles.value).map((group) => ({
    name: group.name,
    roles: group.roles.map((roleId) => roleName(roleId)),
  }))
  const lines = assignmentEmailRosterLines(
    groups,
    roster.value.map((assignment) => ({
      role: roleName(assignment.roleId),
      personName: personName(assignment.personId),
      tentative: assignment.tentative,
    })),
  )
  const churchName = settingsStore.librarySettings?.branding.churchName.trim()
  return [
    'Hello,',
    '',
    `Here are the assignments for ${serviceTypeName.value} on ${serviceDateLabel.value}.`,
    '',
    ...lines,
    '',
    'Please review the roster and reply if anything needs to change.',
    '',
    'Thank you,',
    churchName || 'Worship Studio',
  ].join('\n')
}
function openEmailDialog() {
  if (!service.value) return
  const churchName = settingsStore.librarySettings?.branding.churchName.trim()
  emailSubject.value = `${churchName ? `${churchName} — ` : ''}Assignments for ${serviceTypeName.value} — ${serviceDateLabel.value}`
  emailMessage.value = assignmentEmailBody()
  emailActionStatus.value = ''
  emailActionError.value = ''
  showRecipientEmails.value = false
  emailDialogOpen.value = true
}
async function openEmailDraft() {
  emailActionStatus.value = ''
  emailActionError.value = ''
  openingEmailApp.value = true
  try {
    const url = mailtoUrl(emailDraft.value)
    if (getAdapter().kind === 'tauri') await openUrl(url)
    else window.location.href = url
    emailActionStatus.value = 'Draft opened in your email app. Review it there before sending.'
  } catch (error) {
    emailActionError.value =
      error instanceof Error
        ? error.message
        : 'No email application could open this draft. Copy the email details instead.'
  } finally {
    openingEmailApp.value = false
  }
}
async function copyEmailDraft() {
  emailActionStatus.value = ''
  emailActionError.value = ''
  try {
    await navigator.clipboard.writeText(emailDraftText(emailDraft.value))
    emailActionStatus.value = 'Email details copied. Paste them into the email service you use.'
  } catch (error) {
    emailActionError.value =
      error instanceof Error ? error.message : 'The email details could not be copied.'
  }
}
</script>

<template>
  <AsyncLoadState
    v-if="editorLoading || editorLoadError"
    :loading="editorLoading"
    :error="editorLoadError"
    label="assignments"
    @retry="loadAssignments"
  />
  <EditorNotFoundState
    v-else-if="notFound"
    icon="mdi-calendar-remove-outline"
    title="Service Not Found"
    message="This service may have been deleted or moved."
    :back-to="{ path: '/' }"
    back-label="Back to Services"
  />
  <main v-else-if="service" class="assignments-page">
    <header class="assignments-hero">
      <div class="assignments-hero-toolbar">
        <v-btn variant="text" size="small" prepend-icon="mdi-chevron-left" :to="backTo">
          {{ backLabel }}
        </v-btn>
        <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="openResetDialog">
          Reset from Template
        </v-btn>
      </div>
      <div class="assignments-hero-content">
        <div>
          <div class="page-eyebrow">Service team</div>
          <h1>Assignments</h1>
          <p class="service-context">{{ serviceTypeName }} <span>·</span> {{ serviceDateLabel }}</p>
          <p class="page-description">
            Assign people to each role and resolve availability issues before the service.
          </p>
        </div>
        <div class="roster-summary" aria-label="Assignment summary">
          <div class="summary-stat summary-stat--assigned">
            <strong>{{ filledAssignmentCount }}</strong>
            <span>Assigned</span>
          </div>
          <div class="summary-stat" :class="{ 'summary-stat--attention': openAssignmentCount > 0 }">
            <strong>{{ openAssignmentCount }}</strong>
            <span>Open</span>
          </div>
          <div class="summary-stat">
            <strong>{{ tentativeAssignmentCount }}</strong>
            <span>Tentative</span>
          </div>
        </div>
      </div>
    </header>

    <div v-if="conflictLines.length || unavailableLines.length" class="assignment-alerts">
      <v-alert v-if="conflictLines.length" type="warning" variant="tonal" density="compact">
        <div class="alert-title">Double-booking to review</div>
        <div v-for="(line, index) in conflictLines" :key="index">{{ line }}</div>
      </v-alert>
      <v-alert v-if="unavailableLines.length" type="error" variant="tonal" density="compact">
        <div class="alert-title">Availability conflict</div>
        <div v-for="(line, index) in unavailableLines" :key="index">{{ line }}</div>
      </v-alert>
    </div>

    <div class="assignments-layout">
      <div class="assignments-main">
        <section v-if="orderOfServiceGroups.length" class="assignment-section">
          <div class="section-heading">
            <span class="section-icon section-icon--service">
              <v-icon icon="mdi-book-open-page-variant-outline" size="21" />
            </span>
            <div>
              <h2>Order of Service</h2>
              <p>Roles connected directly to items in the service plan.</p>
            </div>
          </div>
          <div
            v-for="group in orderOfServiceGroups"
            :key="group.name"
            class="role-category"
            :style="{ '--category-color': `rgb(var(--v-theme-${group.color}))` }"
          >
            <div class="category-heading">
              <span class="category-marker"><v-icon icon="mdi-shape-outline" size="16" /></span>
              <span>{{ group.name }}</span>
              <span class="category-count">{{ group.roles.length }}</span>
            </div>
            <RoleAssignmentBlock
              v-for="role in group.roles"
              :key="role"
              :label="roleName(role)"
              :assignments="assignmentsForRole(role)"
              :person-options="personOptionsForRole(role)"
              :is-conflicted="isConflicted"
              :is-unavailable="isUnavailable"
              :color="group.color"
              @add="addAssignment(role)"
              @remove="removeAssignment"
            />
          </div>
        </section>

        <section v-if="groupedRoles.length" class="assignment-section">
          <div class="section-heading">
            <span class="section-icon section-icon--staffing"
              ><v-icon icon="mdi-account-group-outline" size="21"
            /></span>
            <div>
              <h2>Service Team</h2>
              <p>Staffing and volunteer roles supporting this service.</p>
            </div>
          </div>
          <div
            v-for="group in groupedRoles"
            :key="group.name"
            class="role-category"
            :style="{ '--category-color': `rgb(var(--v-theme-${group.color}))` }"
          >
            <div class="category-heading">
              <span class="category-marker"><v-icon icon="mdi-shape-outline" size="16" /></span>
              <span>{{ group.name }}</span>
              <span class="category-count">{{ group.roles.length }}</span>
            </div>
            <RoleAssignmentBlock
              v-for="role in group.roles"
              :key="role"
              :label="roleName(role)"
              :assignments="assignmentsForRole(role)"
              :person-options="personOptionsForRole(role)"
              :is-conflicted="isConflicted"
              :is-unavailable="isUnavailable"
              :color="group.color"
              @add="addAssignment(role)"
              @remove="removeAssignment"
            />
          </div>
        </section>

        <div
          v-if="orderOfServiceGroups.length === 0 && groupedRoles.length === 0"
          class="assignments-empty-state"
        >
          <span><v-icon icon="mdi-account-group-outline" size="28" /></span>
          <h2>No roles yet</h2>
          <p>Add a role to begin building this service team.</p>
        </div>
      </div>

      <aside class="assignments-sidebar">
        <section class="sidebar-panel">
          <div class="sidebar-panel-title">Roster Tools</div>
          <p class="sidebar-panel-description">Add roles or people without leaving this service.</p>
          <label class="sidebar-field-label">Role</label>
          <v-select
            v-model="roleToAdd"
            :items="addRoleItems"
            label="+ Add Role"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="onAddRole"
          />
          <v-btn
            block
            variant="tonal"
            color="primary"
            prepend-icon="mdi-account-plus-outline"
            @click="openAddPerson"
          >
            New Person
          </v-btn>
          <v-btn
            block
            variant="flat"
            color="primary"
            prepend-icon="mdi-email-outline"
            @click="openEmailDialog"
          >
            Share Assignments
          </v-btn>
          <p class="settings-note">Roles are managed in Settings → Roles</p>
        </section>

        <section class="sidebar-panel">
          <div class="sidebar-panel-title">Status Guide</div>
          <div class="status-guide-row">
            <span class="status-icon status-icon--tentative"
              ><v-icon icon="mdi-clock-outline" size="17"
            /></span>
            <div><strong>Tentative</strong><small>Assignment is not confirmed</small></div>
          </div>
          <div class="status-guide-row">
            <span class="status-icon status-icon--warning"
              ><v-icon icon="mdi-alert-outline" size="17"
            /></span>
            <div><strong>Double-booked</strong><small>Review, but may be intentional</small></div>
          </div>
          <div class="status-guide-row">
            <span class="status-icon status-icon--error"
              ><v-icon icon="mdi-calendar-remove-outline" size="17"
            /></span>
            <div><strong>Unavailable</strong><small>Choose someone available</small></div>
          </div>
        </section>
      </aside>
    </div>

    <PersonEditorDialog
      v-model="personDialogOpen"
      :role-groups="allGroupedRoles"
      :roles="rolesStore.roles"
      @save="savePerson"
    />

    <v-dialog v-model="resetDialogOpen" max-width="480">
      <v-card>
        <v-card-title>Reset Assignments from Template</v-card-title>
        <v-card-text>
          <template v-if="!resetTemplate">
            <p class="text-medium-emphasis">
              No service template found for "{{ serviceTypeName }}". Add one in Settings → Service
              Templates first.
            </p>
          </template>
          <template v-else-if="resetAdditions.length === 0 && resetRemovals.length === 0">
            <p class="text-medium-emphasis">
              Assignments already match the template — nothing to change.
            </p>
          </template>
          <template v-else>
            <p class="text-caption text-medium-emphasis mb-3">
              Only staffing roles from the template are affected — roles tied to an actual item on
              this service (e.g. the sermon's Preacher) are never changed here.
            </p>
            <div v-if="resetAdditions.length" class="mb-3">
              <div class="text-overline text-medium-emphasis">Will add</div>
              <div v-for="(line, index) in resetAdditions" :key="`add-${index}`">+ {{ line }}</div>
            </div>
            <div v-if="resetRemovals.length">
              <div class="text-overline text-medium-emphasis">Will remove</div>
              <div v-for="(removal, index) in resetRemovals" :key="`remove-${index}`">
                − {{ removal.role
                }}<span v-if="removal.personName"> ({{ removal.personName }})</span>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="resetDialogOpen = false">
            {{
              resetTemplate && (resetAdditions.length || resetRemovals.length) ? 'Cancel' : 'Close'
            }}
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

    <v-dialog v-model="emailDialogOpen" max-width="720" scrollable>
      <v-card class="share-dialog">
        <v-card-title class="share-dialog-title">
          <span><v-icon icon="mdi-email-edit-outline" size="22" /></span>
          <div>
            <strong>Share Assignments</strong>
            <small>Prepare one roster email for everyone serving.</small>
          </div>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="Close"
            @click="emailDialogOpen = false"
          />
        </v-card-title>
        <v-card-text class="share-dialog-content">
          <section class="recipient-summary">
            <span><v-icon icon="mdi-account-multiple-outline" size="20" /></span>
            <div>
              <strong
                >{{ recipientEmails.length }} email recipient{{
                  recipientEmails.length === 1 ? '' : 's'
                }}</strong
              >
              <p v-if="recipientEmails.length">
                Addresses will be placed together in the email’s To field.
              </p>
              <p v-else>
                Add email addresses to the assigned people, or enter recipients manually after
                opening the draft.
              </p>
              <template v-if="recipientEmails.length">
                <v-btn
                  variant="text"
                  density="compact"
                  size="small"
                  class="recipient-address-toggle"
                  :append-icon="showRecipientEmails ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  @click="showRecipientEmails = !showRecipientEmails"
                >
                  {{ showRecipientEmails ? 'Hide addresses' : 'View addresses' }}
                </v-btn>
                <v-expand-transition>
                  <p v-if="showRecipientEmails" class="recipient-addresses">
                    {{ recipientEmails.join(', ') }}
                  </p>
                </v-expand-transition>
              </template>
            </div>
            <span class="to-badge">TO</span>
          </section>

          <v-alert
            v-if="peopleMissingEmail.length"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <strong
              >{{ peopleMissingEmail.length }} assigned
              {{ peopleMissingEmail.length === 1 ? 'person has' : 'people have' }} no email
              address:</strong
            >
            {{ peopleMissingEmail.map(personDisplayName).join(', ') }}
          </v-alert>

          <v-text-field
            v-model="emailSubject"
            label="Subject"
            variant="outlined"
            density="compact"
            class="mb-2"
          />
          <v-textarea
            v-model="emailMessage"
            label="Message"
            variant="outlined"
            rows="9"
            auto-grow
          />

          <v-alert
            v-if="emailActionStatus"
            type="success"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ emailActionStatus }}
          </v-alert>
          <v-alert
            v-if="emailActionError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            Could not prepare the email: {{ emailActionError }}
          </v-alert>
          <p class="share-delivery-note">
            Worship Studio prepares the draft but does not send it. Your email application handles
            the account and delivery.
          </p>
        </v-card-text>
        <v-card-actions class="share-dialog-actions">
          <v-btn variant="text" @click="emailDialogOpen = false">Close</v-btn>
          <v-spacer />
          <v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copyEmailDraft"
            >Copy Message</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-open-in-new"
            :loading="openingEmailApp"
            @click="openEmailDraft"
          >
            Open in Email App
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.assignments-page {
  min-height: 100%;
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.assignments-hero,
.assignment-section,
.sidebar-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.assignments-hero {
  max-width: 1240px;
  margin: 0 auto 18px;
  overflow: hidden;
}
.assignments-hero-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 3px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.assignments-hero-content {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  padding: 24px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.assignments-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.service-context {
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.95rem;
  font-weight: 600;
}
.service-context span {
  padding: 0 4px;
  color: rgba(var(--v-theme-on-surface), 0.32);
}
.page-description {
  max-width: 590px;
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.84rem;
  line-height: 1.5;
}
.roster-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 92px;
  flex-direction: column;
  align-items: center;
  padding: 11px 16px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.76rem;
  font-weight: 650;
  letter-spacing: 0.045em;
  text-transform: uppercase;
}
.summary-stat--assigned strong {
  color: rgb(var(--v-theme-success));
}
.summary-stat--attention strong {
  color: rgb(var(--v-theme-warning));
}
.assignment-alerts {
  display: grid;
  max-width: 1240px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0 auto 18px;
  font-size: 0.82rem;
}
.alert-title {
  margin-bottom: 3px;
  font-weight: 700;
}
.assignments-layout {
  display: grid;
  max-width: 1240px;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: start;
  gap: 18px;
  margin: 0 auto;
}
.assignments-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
}
.assignment-section {
  overflow: hidden;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.section-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1rem;
  font-weight: 680;
  letter-spacing: -0.01em;
}
.section-heading p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.78rem;
}
.section-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border-radius: 8px;
}
.section-icon--service {
  background: rgba(var(--v-theme-teal), 0.13);
  color: rgb(var(--v-theme-teal));
}
.section-icon--staffing {
  background: rgba(var(--v-theme-secondary), 0.13);
  color: rgb(var(--v-theme-secondary));
}
.role-category {
  padding: 13px 18px 5px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.055);
  box-shadow: inset 4px 0 var(--category-color);
}
.role-category:last-child {
  border-bottom: 0;
}
.category-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin: 0 0 11px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--category-color) 22%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--category-color) 10%, transparent);
  color: var(--category-color);
  font-size: 0.75rem;
  font-weight: 680;
  text-transform: uppercase;
  letter-spacing: 0.075em;
}
.category-marker {
  display: grid;
  width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--category-color) 16%, transparent);
}
.category-count {
  display: grid;
  min-width: 19px;
  height: 19px;
  place-items: center;
  border-radius: 10px;
  margin-left: 2px;
  background: color-mix(in srgb, var(--category-color) 15%, transparent);
  color: var(--category-color);
  font-size: 0.7rem;
}
.assignments-sidebar {
  position: sticky;
  top: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sidebar-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 17px;
}
.sidebar-panel-title {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.sidebar-panel-description,
.settings-note {
  margin: -5px 0 1px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
  line-height: 1.45;
}
.sidebar-field-label {
  margin-bottom: -7px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  font-weight: 600;
}
.settings-note {
  margin: 0;
  text-align: center;
}
.sidebar-panel :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-background), 0.48);
}
.status-guide-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}
.status-guide-row div {
  display: flex;
  flex-direction: column;
}
.status-guide-row strong {
  font-size: 0.8rem;
  font-weight: 650;
}
.status-guide-row small {
  margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
  line-height: 1.35;
}
.status-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 7px;
}
.status-icon--tentative {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.status-icon--warning {
  border-color: rgba(var(--v-theme-warning), 0.3);
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}
.status-icon--error {
  border-color: rgba(var(--v-theme-error), 0.3);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.assignments-empty-state {
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 11px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  text-align: center;
}
.assignments-empty-state > span {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.assignments-empty-state h2 {
  margin: 13px 0 2px;
  color: rgba(var(--v-theme-on-surface), 0.84);
  font-size: 1rem;
}
.assignments-empty-state p {
  margin: 0;
  font-size: 0.82rem;
}
.share-dialog {
  display: flex;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}
.share-dialog-title,
.share-dialog-actions {
  flex: 0 0 auto;
}
.share-dialog-title {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 15px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.share-dialog-title > span {
  display: grid;
  width: 39px;
  height: 39px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.share-dialog-title > div {
  display: flex;
  flex-direction: column;
}
.share-dialog-title strong {
  font-size: 0.9rem;
}
.share-dialog-title small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
}
.share-dialog-content {
  min-height: 0;
  padding: 17px !important;
  overflow-y: auto;
}
.recipient-summary {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin-bottom: 13px;
  padding: 11px 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.055);
}
.recipient-summary > span:first-child {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.recipient-summary > div {
  min-width: 0;
}
.recipient-summary strong {
  font-size: 0.75rem;
}
.recipient-summary p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.53);
  font-size: 0.66rem;
  line-height: 1.4;
}
.recipient-address-toggle {
  min-width: 0;
  margin: 4px 0 -2px -8px;
  padding-inline: 8px !important;
  color: rgb(var(--v-theme-primary));
  font-size: 0.67rem;
}
.recipient-addresses {
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.72) !important;
  font-family: monospace;
  font-size: 0.65rem !important;
}
.to-badge {
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.58rem;
  font-weight: 760;
  letter-spacing: 0.05em;
}
.share-delivery-note {
  margin: 12px 2px 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.65rem;
  line-height: 1.45;
}
.share-dialog-actions {
  padding: 11px 15px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
@media (max-width: 1050px) {
  .assignments-layout {
    grid-template-columns: 1fr;
  }
  .assignments-sidebar {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .assignments-page {
    padding: 14px 12px 40px;
  }
  .assignments-hero-content {
    align-items: stretch;
    flex-direction: column;
    padding: 20px;
  }
  .roster-summary {
    width: 100%;
  }
  .summary-stat {
    min-width: 0;
    flex: 1;
  }
  .assignment-alerts,
  .assignments-sidebar {
    grid-template-columns: 1fr;
  }
  .share-dialog-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }
  .share-dialog-actions .v-spacer {
    display: none;
  }
  .share-dialog-actions .v-btn {
    width: 100%;
  }
}
</style>
