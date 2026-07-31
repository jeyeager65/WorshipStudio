<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { Person } from '@/models/library'

const router = useRouter()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()

onMounted(async () => {
  await Promise.all([peopleStore.load(), settingsStore.load()])
})

// "First Last (Display Name)" — unlike personDisplayName (used everywhere else for a short,
// unambiguous label), this list is exactly where seeing both at once matters: it's the one
// place someone looks up who "Pastor Dan" actually is.
function personLabel(person: Person): string {
  const fullName = `${person.firstName} ${person.lastName}`.trim()
  return person.displayName ? `${fullName} (${person.displayName})` : fullName
}

// A role's own category (e.g. "Praise Team" for "Guitar") — searched alongside the role's own
// name, so typing a category finds everyone with any role in it, not just an exact role match.
function categoryFor(role: string): string | undefined {
  return (settingsStore.librarySettings?.roleGroups ?? []).find((g) => g.roles.includes(role))?.name
}

function sortKey(person: Person): string {
  return `${person.firstName} ${person.lastName}`.toLowerCase()
}

// Match Assignments: category identity stays separate from warning/error colors. The common
// groups receive blue, teal, violet, and terracotta before any warning-adjacent hues.
const CATEGORY_COLORS = ['primary', 'teal', 'violet', 'terracotta', 'rose', 'slate', 'secondary', 'amber']

const searchQuery = ref('')
const activeFilter = ref('all')
const availabilityDate = ref('')
function isUnavailableOnDate(person: Person, date: string): boolean {
  return !!date && person.unavailableDateRanges.some((range) => range.start <= date && date <= range.end)
}
const unavailableOnSelectedDateCount = computed(() =>
  availabilityDate.value
    ? peopleStore.people.filter((person) => isUnavailableOnDate(person, availabilityDate.value)).length
    : 0,
)
const availabilityDateLabel = computed(() =>
  availabilityDate.value
    ? new Date(`${availabilityDate.value}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '',
)
const categoryFilters = computed(() =>
  (settingsStore.librarySettings?.roleGroups ?? []).map((group, index) => ({
    value: `category:${group.name}`,
    label: group.name,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    count: peopleStore.people.filter((person) => person.preferredRoles.some((role) => group.roles.includes(role))).length,
  })),
)
const activeFilterLabel = computed(() => {
  if (activeFilter.value === 'all') return 'All People'
  if (activeFilter.value === 'unassigned') return 'Unassigned'
  if (activeFilter.value === 'unavailable') return `Unavailable on ${availabilityDateLabel.value}`
  return categoryFilters.value.find((filter) => filter.value === activeFilter.value)?.label ?? 'People'
})
const filteredPeople = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (searchQuery.value ?? '').trim().toLowerCase()
  const matches = peopleStore.people.filter((person) => {
    if (activeFilter.value === 'unassigned' && person.preferredRoles.length > 0) return false
    if (activeFilter.value === 'unavailable' && !isUnavailableOnDate(person, availabilityDate.value)) return false
    if (activeFilter.value.startsWith('category:')) {
      const groupName = activeFilter.value.slice('category:'.length)
      const group = settingsStore.librarySettings?.roleGroups.find((candidate) => candidate.name === groupName)
      if (!group || !person.preferredRoles.some((role) => group.roles.includes(role))) return false
    }
    if (!q) return true
    if (person.firstName.toLowerCase().includes(q)) return true
    if (person.lastName.toLowerCase().includes(q)) return true
    if (person.displayName?.toLowerCase().includes(q)) return true
    return person.preferredRoles.some(
      (role) => role.toLowerCase().includes(q) || categoryFor(role)?.toLowerCase().includes(q),
    )
  })
  return [...matches].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
})

function clearDirectoryFilters() {
  searchQuery.value = ''
  activeFilter.value = 'all'
  availabilityDate.value = ''
}

function clearAvailabilityDate() {
  availabilityDate.value = ''
  if (activeFilter.value === 'unavailable') activeFilter.value = 'all'
}

// Grouped under each role's own category (e.g. "Praise Team: Guitar, Vocals"), one line per
// category — same "leftover -> Other" pattern as the Assignments/Service Template editors, for
// a preferred role that no longer belongs to any current category.
interface PersonRoleGroup {
  name: string
  roles: string[]
}
function roleGroupsFor(person: Person): PersonRoleGroup[] {
  const groups: PersonRoleGroup[] = []
  const accountedFor = new Set<string>()
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    const roles = group.roles.filter((r) => person.preferredRoles.includes(r))
    if (!roles.length) continue
    groups.push({ name: group.name, roles })
    roles.forEach((r) => accountedFor.add(r))
  }
  const leftover = person.preferredRoles.filter((r) => !accountedFor.has(r))
  if (leftover.length) groups.push({ name: 'Other', roles: leftover })
  return groups
}

// Stable per-category color: same category always gets the same color on this screen, driven
// by the category's own position in Settings > Roles rather than a hash, so reordering
// categories there is the only thing that would ever change a color.
function categoryColor(role: string): string {
  const groups = settingsStore.librarySettings?.roleGroups ?? []
  const index = groups.findIndex((g) => g.roles.includes(role))
  return index === -1 ? 'slate' : CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}

function initials(person: Person): string {
  return `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()
}

const peopleWithRolesCount = computed(() => peopleStore.people.filter((person) => person.preferredRoles.length > 0).length)
const peopleWithAvailabilityCount = computed(() => peopleStore.people.filter((person) => person.unavailableDateRanges.length > 0).length)

function openAdd() {
  router.push('/people/new')
}
function openEdit(person: Person) {
  router.push(`/people/${person.id}`)
}
async function remove(person: Person) {
  if (!(await confirmDialog.confirm(`Delete ${personLabel(person)}?`, 'Delete'))) return
  await peopleStore.remove(person.id)
}
</script>

<template>
  <main class="people-page">
    <header class="people-hero">
      <div>
        <div class="page-eyebrow">Team Directory</div>
        <h1>People</h1>
        <p>Add and organize everyone who serves in worship, ministry, hospitality, or production.</p>
      </div>
      <div class="people-summary" aria-label="People directory summary">
        <div class="summary-stat">
          <strong>{{ peopleStore.people.length }}</strong>
          <span>People</span>
        </div>
        <div class="summary-stat">
          <strong>{{ peopleWithRolesCount }}</strong>
          <span>With Roles</span>
        </div>
        <div class="summary-stat">
          <strong>{{ peopleWithAvailabilityCount }}</strong>
          <span>Availability Notes</span>
        </div>
      </div>
    </header>

    <section class="directory-panel">
      <div class="directory-toolbar">
        <div>
          <h2>Directory</h2>
          <p>
            {{ filteredPeople.length }} {{ filteredPeople.length === 1 ? 'person' : 'people' }}
            <template v-if="activeFilter !== 'all'"> in {{ activeFilterLabel }}</template>
            <template v-if="searchQuery"> matching your search</template>
          </p>
        </div>
        <div class="directory-actions">
          <v-text-field
            v-if="peopleStore.people.length > 0"
            v-model="searchQuery"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search name, category, or role"
            aria-label="Search by name, category, or role"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="people-search"
          />
          <v-btn variant="flat" color="primary" prepend-icon="mdi-account-plus-outline" @click="openAdd">Add Person</v-btn>
        </div>
      </div>

      <div class="directory-body">
        <aside v-if="peopleStore.people.length" class="people-filters" aria-label="Filter people by category">
          <div class="filter-heading">Categories</div>
          <button
            type="button"
            class="filter-option filter-option--all"
            :class="{ 'filter-option--active': activeFilter === 'all' }"
            @click="activeFilter = 'all'"
          >
            <span class="filter-icon"><v-icon icon="mdi-account-multiple-outline" size="18" /></span>
            <span>All People</span>
            <strong>{{ peopleStore.people.length }}</strong>
          </button>
          <button
            v-for="filter in categoryFilters"
            :key="filter.value"
            type="button"
            class="filter-option"
            :class="{ 'filter-option--active': activeFilter === filter.value }"
            :style="{ '--filter-color': `rgb(var(--v-theme-${filter.color}))` }"
            @click="activeFilter = filter.value"
          >
            <span class="filter-icon"><v-icon icon="mdi-shape-outline" size="17" /></span>
            <span>{{ filter.label }}</span>
            <strong>{{ filter.count }}</strong>
          </button>
          <div class="filter-divider" />
          <button
            type="button"
            class="filter-option filter-option--unassigned"
            :class="{ 'filter-option--active': activeFilter === 'unassigned' }"
            @click="activeFilter = 'unassigned'"
          >
            <span class="filter-icon"><v-icon icon="mdi-account-question-outline" size="18" /></span>
            <span>Unassigned</span>
            <strong>{{ peopleStore.people.length - peopleWithRolesCount }}</strong>
          </button>
          <div class="availability-filter">
            <label for="people-availability-date">Availability Date</label>
            <v-text-field
              id="people-availability-date"
              v-model="availabilityDate"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              aria-label="Check availability on date"
              @click:clear="clearAvailabilityDate"
            />
            <button
              v-if="availabilityDate"
              type="button"
              class="filter-option filter-option--unavailable"
              :class="{ 'filter-option--active': activeFilter === 'unavailable' }"
              @click="activeFilter = 'unavailable'"
            >
              <span class="filter-icon"><v-icon icon="mdi-calendar-remove-outline" size="18" /></span>
              <span>Unavailable</span>
              <strong>{{ unavailableOnSelectedDateCount }}</strong>
            </button>
          </div>
        </aside>

        <div class="directory-results">
          <div v-if="peopleStore.people.length === 0" class="people-empty-state">
            <span><v-icon icon="mdi-account-multiple-plus-outline" size="30" /></span>
            <h2>No People Yet</h2>
            <p>Add the first person to begin building your service team.</p>
            <v-btn variant="flat" color="primary" prepend-icon="mdi-account-plus-outline" @click="openAdd">Add Person</v-btn>
          </div>
          <div v-else-if="filteredPeople.length === 0" class="people-empty-state">
            <span><v-icon icon="mdi-account-search-outline" size="30" /></span>
            <h2>No Matches Found</h2>
            <p>No people match the current category and search.</p>
            <v-btn variant="text" color="primary" @click="clearDirectoryFilters">Clear Filters</v-btn>
          </div>

          <div v-else class="people-grid">
            <article
              v-for="person in filteredPeople"
              :key="person.id"
              class="person-card"
              tabindex="0"
              @click="openEdit(person)"
              @keydown.enter="openEdit(person)"
              @keydown.space.prevent="openEdit(person)"
            >
          <header class="person-card-header">
            <span class="person-avatar">{{ initials(person) }}</span>
            <div class="person-identity">
              <h3>{{ personLabel(person) }}</h3>
              <p>{{ person.email || 'No email on file' }}</p>
            </div>
            <span v-if="availabilityDate && isUnavailableOnDate(person, availabilityDate)" class="availability-state availability-state--unavailable">
              <v-icon icon="mdi-calendar-remove-outline" size="17" />
              Unavailable {{ availabilityDateLabel }}
            </span>
            <span v-else-if="availabilityDate" class="availability-state availability-state--available">
              <v-icon icon="mdi-calendar-check-outline" size="17" />
              Available {{ availabilityDateLabel }}
            </span>
            <span v-else-if="person.unavailableDateRanges.length" class="availability-state">
              <v-icon icon="mdi-calendar-alert-outline" size="17" />
              {{ person.unavailableDateRanges.length }} availability
              {{ person.unavailableDateRanges.length === 1 ? 'note' : 'notes' }}
            </span>
            <span v-else class="availability-state availability-state--clear">
              <v-icon icon="mdi-calendar-check-outline" size="17" />
              Available
            </span>
            <v-menu>
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-dots-horizontal"
                  variant="text"
                  size="small"
                  aria-label="Person actions"
                  @click.stop
                />
              </template>
              <v-list density="compact">
                <v-list-item prepend-icon="mdi-pencil-outline" title="Edit Person" @click="openEdit(person)" />
                <v-list-item prepend-icon="mdi-delete-outline" title="Delete Person" class="text-error" @click="remove(person)" />
              </v-list>
            </v-menu>
          </header>

          <div v-if="person.preferredRoles.length" class="person-roles">
            <div
              v-for="group in roleGroupsFor(person)"
              :key="group.name"
              class="person-role-group"
              :style="{ '--category-color': `rgb(var(--v-theme-${categoryColor(group.roles[0] ?? '')}))` }"
            >
              <div class="person-role-category">
                <span><v-icon icon="mdi-shape-outline" size="14" /></span>
                {{ group.name }}
              </div>
              <div class="person-role-chips">
                <span v-for="role in group.roles" :key="role">{{ role }}</span>
              </div>
            </div>
          </div>
          <div v-else class="person-no-roles">
            <v-icon icon="mdi-account-question-outline" size="18" />
            No preferred roles configured
          </div>

            </article>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.people-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.people-hero,
.directory-panel {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.people-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.people-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.people-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.people-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.directory-panel {
  overflow: hidden;
}
.directory-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 78px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.directory-toolbar h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.directory-toolbar p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.directory-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.people-search {
  width: min(360px, 32vw);
}
.people-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.directory-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 420px;
}
.people-filters {
  padding: 15px 11px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.filter-heading {
  padding: 2px 10px 9px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.filter-option {
  --filter-color: rgb(var(--v-theme-slate));
  position: relative;
  display: grid;
  width: 100%;
  min-height: 42px;
  grid-template-columns: 29px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 4px 9px 4px 7px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 590;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.filter-option::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--filter-color);
  content: '';
  opacity: 0;
}
.filter-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.filter-option--active {
  border-color: color-mix(in srgb, var(--filter-color) 22%, transparent);
  background: color-mix(in srgb, var(--filter-color) 10%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.filter-option--active::before {
  opacity: 1;
}
.filter-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--filter-color) 65%, transparent);
  outline-offset: 1px;
}
.filter-option--all {
  --filter-color: rgb(var(--v-theme-primary));
}
.filter-option--unassigned {
  --filter-color: rgb(var(--v-theme-slate));
}
.filter-option--unavailable {
  --filter-color: rgb(var(--v-theme-error));
  margin-top: 5px;
}
.filter-icon {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--filter-color) 11%, transparent);
  color: var(--filter-color);
}
.filter-option strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.filter-divider {
  height: 1px;
  margin: 9px 7px;
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.availability-filter {
  margin-top: 14px;
  padding: 13px 7px 3px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.availability-filter > label {
  display: block;
  margin: 0 2px 7px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.74rem;
  font-weight: 650;
}
.availability-filter :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.55);
  font-size: 0.76rem;
}
.directory-results {
  min-width: 0;
}
.people-grid {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 16px;
}
.person-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.34);
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
.person-card:hover,
.person-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.32);
  background: rgba(var(--v-theme-primary), 0.045);
  box-shadow: 0 9px 24px rgba(0, 0, 0, 0.1);
  outline: none;
  transform: translateY(-1px);
}
.person-card:focus-visible {
  box-shadow:
    0 9px 24px rgba(0, 0, 0, 0.1),
    inset 0 0 0 2px rgba(var(--v-theme-primary), 0.5);
}
.person-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 78px;
  padding: 13px 13px 13px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.person-avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-size: 0.88rem;
  font-weight: 720;
  letter-spacing: 0.025em;
}
.person-identity {
  min-width: 0;
  flex: 1;
}
.person-identity h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.08rem;
  font-weight: 720;
  letter-spacing: -0.015em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-identity p {
  overflow: hidden;
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-roles {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 10px 16px 12px 76px;
}
.person-role-group {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.person-role-category {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--category-color);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.045em;
  text-transform: uppercase;
  white-space: nowrap;
}
.person-role-category span {
  display: grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--category-color) 12%, transparent);
}
.person-role-chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  padding-left: 0;
  overflow-x: auto;
}
.person-role-chips span {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--category-color) 9%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 590;
  white-space: nowrap;
}
.person-no-roles {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 7px;
  padding: 11px 16px 13px 76px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.76rem;
}
.availability-state {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid rgba(var(--v-theme-warning), 0.22);
  border-radius: 6px;
  background: rgba(var(--v-theme-warning), 0.07);
  color: rgb(var(--v-theme-warning));
  font-size: 0.72rem;
  font-weight: 600;
}
.availability-state--clear {
  border-color: rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-on-surface), 0.035);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.availability-state--unavailable {
  border-color: rgba(var(--v-theme-error), 0.28);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.availability-state--available {
  border-color: rgba(var(--v-theme-success), 0.25);
  background: rgba(var(--v-theme-success), 0.08);
  color: rgb(var(--v-theme-success));
}
.people-empty-state {
  display: flex;
  min-height: 340px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.54);
  text-align: center;
}
.people-empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.people-empty-state h2 {
  margin: 14px 0 3px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 1rem;
}
.people-empty-state p {
  margin: 0 0 15px;
  font-size: 0.82rem;
}
@media (max-width: 980px) {
  .people-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .people-summary {
    align-self: flex-start;
  }
  .directory-body {
    grid-template-columns: 1fr;
  }
  .people-filters {
    display: flex;
    gap: 5px;
    padding: 9px 11px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .filter-heading {
    display: none;
  }
  .filter-option {
    width: auto;
    min-width: max-content;
    grid-template-columns: 27px auto auto;
    margin-bottom: 0;
  }
  .filter-divider {
    width: 1px;
    height: 34px;
    flex: 0 0 1px;
    margin: 4px 2px;
  }
  .availability-filter {
    display: flex;
    min-width: 340px;
    align-items: center;
    gap: 7px;
    margin: 0 0 0 4px;
    padding: 0 0 0 10px;
    border-top: 0;
    border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .availability-filter > label {
    min-width: max-content;
    margin: 0;
  }
  .availability-filter :deep(.v-input) {
    min-width: 170px;
  }
  .availability-filter .filter-option {
    margin-top: 0;
  }
}
@media (max-width: 700px) {
  .people-page {
    padding: 14px 12px 40px;
  }
  .directory-toolbar,
  .directory-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .people-search {
    width: 100%;
  }
  .people-summary {
    width: 100%;
  }
  .summary-stat {
    min-width: 0;
    flex: 1;
  }
  .person-card-header {
    flex-wrap: wrap;
  }
  .availability-state {
    order: 2;
    margin-left: 60px;
  }
  .person-roles {
    padding-left: 16px;
  }
  .person-no-roles {
    padding-left: 16px;
  }
}
</style>
