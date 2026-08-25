<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useFiltersPanel } from '@/composables/useFiltersPanel'
import { useRouter } from 'vue-router'
import { usePeopleStore } from '@/stores/people'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import AlphabetIndexRail from '@/components/AlphabetIndexRail.vue'
import type { Person } from '@/models/library'
import { isElder, personDisplayName } from '@/models/library'
import {
  ALPHABET_INDEX_LETTERS,
  groupByIndexLetter,
  scrollToIndexHeading,
} from '@/utils/alphabetIndex'

const router = useRouter()
const peopleStore = usePeopleStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()
const confirmDialog = useConfirmDialogStore()

onMounted(async () => {
  await Promise.all([peopleStore.load(), roleGroupsStore.load(), rolesStore.load()])
})

function personLabel(person: Person): string {
  const legalName = `${person.firstName} ${person.lastName}`.trim()
  const preferred = personDisplayName(person)
  return preferred === legalName ? legalName : `${preferred} (${legalName})`
}

function roleName(roleId: string): string {
  return rolesStore.roles.find((role) => role.id === roleId)?.name ?? roleId
}

// A role's own category (e.g. "Praise Team" for "Guitar") — searched alongside the role's own
// name, so typing a category finds everyone with any role in it, not just an exact role match.
function categoryFor(roleId: string): string | undefined {
  const role = rolesStore.roles.find((r) => r.id === roleId)
  if (!role) return undefined
  return roleGroupsStore.roleGroups.find((g) => g.id === role.groupId)?.name
}

// Defaults to first name (how the directory has always sorted); "Last name" swaps the key so
// both the list order and the A-Z rail jump by surname instead, like a phone book.
const sortBy = ref<'first' | 'last'>('first')
function sortKey(person: Person): string {
  return sortBy.value === 'last'
    ? `${person.lastName} ${person.firstName}`.toLowerCase()
    : `${person.firstName} ${person.lastName}`.toLowerCase()
}

// Match Assignments: category identity stays separate from warning/error colors. The common
// groups receive blue, teal, violet, and terracotta before any warning-adjacent hues.
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

const searchQuery = ref('')
const activeFilter = ref('all')
const { filtersOpen, toggleFilters, closeFilters } = useFiltersPanel()
const availabilityDate = ref('')
function isUnavailableOnDate(person: Person, date: string): boolean {
  return (
    !!date && person.unavailableDateRanges.some((range) => range.start <= date && date <= range.end)
  )
}
const unavailableOnSelectedDateCount = computed(() =>
  availabilityDate.value
    ? peopleStore.people.filter((person) => isUnavailableOnDate(person, availabilityDate.value))
        .length
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
  roleGroupsStore.roleGroups.map((group, index) => {
    const roleIdsInGroup = new Set(
      rolesStore.roles.filter((role) => role.groupId === group.id).map((role) => role.id),
    )
    return {
      value: `category:${group.id}`,
      label: group.name,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      count: peopleStore.people.filter((person) =>
        person.preferredRoleIds.some((roleId) => roleIdsInGroup.has(roleId)),
      ).length,
    }
  }),
)
const activeFilterLabel = computed(() => {
  if (activeFilter.value === 'all') return 'All People'
  if (activeFilter.value === 'elder') return 'Elder'
  if (activeFilter.value === 'unassigned') return 'Unassigned'
  if (activeFilter.value === 'unavailable') return `Unavailable on ${availabilityDateLabel.value}`
  return (
    categoryFilters.value.find((filter) => filter.value === activeFilter.value)?.label ?? 'People'
  )
})
const filteredPeople = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (searchQuery.value ?? '').trim().toLowerCase()
  const matches = peopleStore.people.filter((person) => {
    if (activeFilter.value === 'elder' && !isElder(person)) return false
    if (activeFilter.value === 'unassigned' && person.preferredRoleIds.length > 0) return false
    if (
      activeFilter.value === 'unavailable' &&
      !isUnavailableOnDate(person, availabilityDate.value)
    )
      return false
    if (activeFilter.value.startsWith('category:')) {
      const groupId = activeFilter.value.slice('category:'.length)
      const roleIdsInGroup = new Set(
        rolesStore.roles.filter((role) => role.groupId === groupId).map((role) => role.id),
      )
      if (!person.preferredRoleIds.some((roleId) => roleIdsInGroup.has(roleId))) return false
    }
    if (!q) return true
    if (person.firstName.toLowerCase().includes(q)) return true
    if (person.lastName.toLowerCase().includes(q)) return true
    if (person.preferredName?.toLowerCase().includes(q)) return true
    if (person.title?.toLowerCase().includes(q)) return true
    return person.preferredRoleIds.some(
      (roleId) =>
        roleName(roleId).toLowerCase().includes(q) ||
        categoryFor(roleId)?.toLowerCase().includes(q),
    )
  })
  return [...matches].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
})

// filteredPeople is already sorted by sortKey, so groups come out in order for free.
const groupedPeople = computed(() => groupByIndexLetter(filteredPeople.value, sortKey))
const availablePeopleLetters = computed(
  () => new Set(groupedPeople.value.map((group) => group.letter)),
)
// Only alongside an actual list — the empty/error states have nothing to index into.
const showIndexRail = computed(() => peopleStore.loaded && filteredPeople.value.length > 0)
const peopleGridEl = ref<HTMLElement>()
function scrollToPersonLetter(letter: string) {
  const heading = document.getElementById(`person-letter-${letter}`)
  if (peopleGridEl.value && heading) scrollToIndexHeading(peopleGridEl.value, heading)
}

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
  groupId: string
  name: string
  roles: string[]
}
function roleGroupsFor(person: Person): PersonRoleGroup[] {
  const groups: PersonRoleGroup[] = []
  const accountedFor = new Set<string>()
  for (const group of roleGroupsStore.roleGroups) {
    const roles = rolesStore.roles.filter(
      (role) => role.groupId === group.id && person.preferredRoleIds.includes(role.id),
    )
    if (!roles.length) continue
    groups.push({ groupId: group.id, name: group.name, roles: roles.map((role) => role.name) })
    roles.forEach((role) => accountedFor.add(role.id))
  }
  const leftover = person.preferredRoleIds
    .filter((roleId) => !accountedFor.has(roleId))
    .map((roleId) => roleName(roleId))
  if (leftover.length) groups.push({ groupId: 'other', name: 'Other', roles: leftover })
  return groups
}

// Stable per-category color: same category always gets the same color on this screen, driven
// by the category's own position in Settings > Roles rather than a hash, so reordering
// categories there is the only thing that would ever change a color.
function categoryColor(groupId: string): string {
  const index = roleGroupsStore.roleGroups.findIndex((g) => g.id === groupId)
  return index === -1 ? 'slate' : CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}

function initials(person: Person): string {
  return `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()
}

const peopleWithRolesCount = computed(
  () => peopleStore.people.filter((person) => person.preferredRoleIds.length > 0).length,
)
const peopleWithAvailabilityCount = computed(
  () => peopleStore.people.filter((person) => person.unavailableDateRanges.length > 0).length,
)
const elderCount = computed(() => peopleStore.people.filter(isElder).length)

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
    <div class="people-page-content">
      <header class="people-hero app-page-hero">
        <div>
          <div class="page-eyebrow">Team Directory</div>
          <h1>People</h1>
          <p>
            Add and organize everyone who serves in worship, ministry, hospitality, or production.
          </p>
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
          <div class="directory-toolbar-heading">
            <h2>Directory</h2>
            <p>
              {{ filteredPeople.length }} {{ filteredPeople.length === 1 ? 'person' : 'people' }}
              <template v-if="activeFilter !== 'all'"> in {{ activeFilterLabel }}</template>
              <template v-if="searchQuery"> matching your search</template>
            </p>
          </div>
          <div class="directory-actions">
            <!-- Only rendered once the filters collapse out of the sidebar (the shared 900px "compact" breakpoint
               block) — below that they live in a slide-over panel this opens. -->
            <v-btn
              v-if="peopleStore.people.length"
              class="app-filters-toggle"
              variant="tonal"
              density="comfortable"
              icon="mdi-filter-variant"
              :aria-label="filtersOpen ? 'Hide filters' : 'Show filters'"
              :aria-expanded="filtersOpen"
              @click="toggleFilters"
            />
            <v-btn-toggle
              v-if="peopleStore.people.length > 0"
              v-model="sortBy"
              mandatory
              density="compact"
              divided
              class="people-sort-toggle"
            >
              <v-btn value="first" size="small" aria-label="Sort by first name">First</v-btn>
              <v-btn value="last" size="small" aria-label="Sort by last name">Last</v-btn>
            </v-btn-toggle>
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
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-account-plus-outline"
              class="add-person-btn app-icon-btn"
              @click="openAdd"
              ><span class="app-btn-label">Add Person</span></v-btn
            >
          </div>
        </div>

        <div
          class="directory-body"
          :class="{ 'directory-body--empty': peopleStore.people.length === 0 }"
        >
          <!-- One <aside>, two presentations — permanent sidebar on wide screens, slide-over panel
             below the shared 900px "compact" breakpoint (CSS only). Same reasoning as the Songs page. -->
          <div
            v-if="peopleStore.people.length"
            class="app-filters-scrim"
            :class="{ 'app-filters-scrim--open': filtersOpen }"
            @click="closeFilters"
          />
          <aside
            v-if="peopleStore.people.length"
            class="people-filters app-filters"
            :class="{ 'app-filters--open': filtersOpen }"
            aria-label="Filter people by category"
          >
            <div class="filter-heading">Categories</div>
            <button
              type="button"
              class="filter-option filter-option--all"
              :class="{ 'filter-option--active': activeFilter === 'all' }"
              @click="activeFilter = 'all'"
            >
              <span class="filter-icon"
                ><v-icon icon="mdi-account-multiple-outline" size="18"
              /></span>
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
            <button
              type="button"
              class="filter-option"
              :class="{ 'filter-option--active': activeFilter === 'elder' }"
              @click="activeFilter = 'elder'"
            >
              <span class="filter-icon"><v-icon icon="mdi-account-tie-outline" size="18" /></span>
              <span>Elder</span>
              <strong>{{ elderCount }}</strong>
            </button>
            <div class="filter-divider" />
            <button
              type="button"
              class="filter-option filter-option--unassigned"
              :class="{ 'filter-option--active': activeFilter === 'unassigned' }"
              @click="activeFilter = 'unassigned'"
            >
              <span class="filter-icon"
                ><v-icon icon="mdi-account-question-outline" size="18"
              /></span>
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
                <span class="filter-icon"
                  ><v-icon icon="mdi-calendar-remove-outline" size="18"
                /></span>
                <span>Unavailable</span>
                <strong>{{ unavailableOnSelectedDateCount }}</strong>
              </button>
            </div>
          </aside>

          <div class="directory-results">
            <AsyncLoadState
              v-if="!peopleStore.loaded"
              :loading="peopleStore.loading"
              :error="peopleStore.loadError"
              label="people"
              @retry="peopleStore.load"
            />
            <AsyncLoadState
              v-if="peopleStore.loaded && peopleStore.loadError"
              :loading="false"
              :error="peopleStore.loadError"
              label="updated people"
              compact
              class="mb-3"
              @retry="peopleStore.load"
            />
            <LibraryEmptyState
              v-if="peopleStore.loaded && peopleStore.people.length === 0"
              icon="mdi-account-multiple-plus-outline"
              title="No People Yet"
              message="Add the first person to begin building your service team."
            >
              <v-btn
                variant="flat"
                color="primary"
                prepend-icon="mdi-account-plus-outline"
                @click="openAdd"
                >Add Person</v-btn
              >
            </LibraryEmptyState>
            <LibraryEmptyState
              v-else-if="peopleStore.loaded && filteredPeople.length === 0"
              icon="mdi-account-search-outline"
              title="No Matches Found"
              message="No people match the current category and search."
            >
              <v-btn variant="text" color="primary" @click="clearDirectoryFilters"
                >Clear Filters</v-btn
              >
            </LibraryEmptyState>

            <div
              v-else-if="peopleStore.loaded"
              ref="peopleGridEl"
              class="people-grid app-page-scroll"
            >
              <template v-for="letterGroup in groupedPeople" :key="letterGroup.letter">
                <div :id="`person-letter-${letterGroup.letter}`" class="people-grid-heading">
                  {{ letterGroup.letter }}
                </div>
                <article
                  v-for="person in letterGroup.items"
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
                      <h3>{{ personDisplayName(person) }}</h3>
                      <p>
                        {{
                          [person.title, person.email || 'No email on file']
                            .filter(Boolean)
                            .join(' · ')
                        }}
                      </p>
                    </div>
                    <span
                      v-if="availabilityDate && isUnavailableOnDate(person, availabilityDate)"
                      class="availability-state availability-state--unavailable"
                    >
                      <v-icon icon="mdi-calendar-remove-outline" size="17" />
                      Unavailable {{ availabilityDateLabel }}
                    </span>
                    <span
                      v-else-if="availabilityDate"
                      class="availability-state availability-state--available"
                    >
                      <v-icon icon="mdi-calendar-check-outline" size="17" />
                      Available {{ availabilityDateLabel }}
                    </span>
                    <span
                      v-else-if="person.unavailableDateRanges.length"
                      class="availability-state"
                    >
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
                        <v-list-item
                          prepend-icon="mdi-pencil-outline"
                          title="Edit Person"
                          @click="openEdit(person)"
                        />
                        <v-list-item
                          prepend-icon="mdi-delete-outline"
                          title="Delete Person"
                          class="text-error"
                          @click="remove(person)"
                        />
                      </v-list>
                    </v-menu>
                  </header>

                  <div v-if="person.preferredRoleIds.length" class="person-roles">
                    <div
                      v-for="group in roleGroupsFor(person)"
                      :key="group.name"
                      class="person-role-group"
                      :style="{
                        '--category-color': `rgb(var(--v-theme-${categoryColor(group.groupId)}))`,
                      }"
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
              </template>
            </div>
          </div>
        </div>
      </section>
    </div>
    <!-- Page-level, not inside the list card — see SongLibraryView.vue's matching comment. -->
    <AlphabetIndexRail
      v-if="showIndexRail"
      :letters="ALPHABET_INDEX_LETTERS"
      :available-letters="availablePeopleLetters"
      class="page-rail"
      @select="scrollToPersonLetter"
    />
  </main>
</template>

<style scoped>
/* The directory list owns the scrolling, not the page — see SongLibraryView.vue's identical
   rule for why (it's what lets the A-Z rail hold full height and stay put). */
.people-page {
  display: flex;
  height: 100%;
  justify-content: center;
  gap: 14px;
  padding: 24px clamp(20px, 3vw, 48px);
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.people-page-content {
  display: flex;
  min-width: 0;
  max-width: 1240px;
  flex: 1;
  flex-direction: column;
}
/* Stretches to the page's full height (the flex default) — the reason it hangs here rather than
   inside the list card. */
.page-rail {
  flex-shrink: 0;
}
/* width: 100% because these sit in a flex column now — see SongLibraryView.vue's matching rule
   for why auto side margins would otherwise shrink them to their content width. The 1240px cap
   lives on .people-page-content. */
.people-hero,
.directory-panel {
  width: 100%;
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
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
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
/* min-width: 0 so the actions can actually give ground. A flex item defaults to min-width: auto,
   which refuses to shrink below its contents — so between roughly 975px and 1125px (the band
   where the nav rail is still permanent but the window is narrow) this whole cluster overflowed
   the toolbar's padding and Add Person was clipped off the card edge. Measured before the fix:
   99px past the toolbar at 975px wide. The search below is what absorbs the shrinking. */
/* flex: 1 at every width, not just when compact: .directory-actions is otherwise sized by its
   content, and a flex:1/min-width:0 search contributes almost nothing to that — so the whole
   cluster collapses to its minimum, the search becomes a stub, and the free space sits unused
   beside the heading. min-width: 0 is what lets it give ground in the other direction (between
   ~975px and ~1125px, where the nav rail is still permanent, Add Person was pushed 99px past the
   card edge without it). */
.directory-actions {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
/* Flexible at every width, not just under the compact breakpoint — a fixed width here is what
   left the cluster unable to shrink in that band. */
/* Truncates as it shrinks — min-width: 0 alone narrows the box while the text keeps its own width
   and spills out under the controls (see MediaLibraryView.vue's matching rule). */
.directory-toolbar > .directory-toolbar-heading {
  min-width: 0;
  overflow: hidden;
}
.directory-toolbar-heading h2,
.directory-toolbar-heading p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.people-sort-toggle {
  flex-shrink: 0;
}
/* min-width keeps it usable: it is the element that absorbs the shrinking, so without a floor it
   collapses to a stub before anything else gives. */
.people-search {
  width: auto;
  min-width: 150px;
  max-width: 360px;
  flex: 1;
}
.people-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.directory-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 220px minmax(0, 1fr);
}
.directory-body--empty {
  grid-template-columns: minmax(0, 1fr);
}
.people-filters {
  padding: 15px 11px;
  overflow-y: auto;
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
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
/* flex/min-height/overflow come from .app-page-scroll (assets/base.css) — this only adds what is
   specific to the directory list. */
.people-grid {
  /* One source of truth for the list inset -- see SongLibraryView.vue's matching comment for why
     the sticky heading's negative margin has to track it rather than repeat the number. */
  --list-pad: 16px;

  container: people-grid / inline-size;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  padding: var(--list-pad);
}
.people-grid-heading {
  position: sticky;
  top: calc(var(--list-pad) * -1);
  z-index: 1;
  flex-shrink: 0;
  margin: 0 calc(var(--list-pad) * -1);
  padding: 8px calc(var(--list-pad) + 4px) 6px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
/* flex-shrink: 0 because .people-grid is now a height-constrained scrolling flex column — its
   items would otherwise shrink below their own content to fit, collapsing every card into a
   sliver instead of overflowing into a scroll. */
.person-card {
  display: flex;
  min-width: 0;
  flex-shrink: 0;
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
/* 900px = the shared "compact" breakpoint (see assets/base.css); the slide-over panel and the
   icon-only button are defined there. This page owns collapsing the grid to one column, the
   positioning context the panel is absolute against, and letting the search take the free space. */
@media (max-width: 900px) {
  .people-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .people-summary {
    align-self: flex-start;
  }
  .directory-body {
    position: relative;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }
  .people-search {
    width: auto;
    min-width: 0;
    max-width: 360px;
    flex: 1;
  }
}
@media (max-width: 700px) {
  .people-page {
    padding: 10px;
  }
  /* Buys list height back on a phone, where the chrome above the list was eating more than half
     the viewport — the toolbar's title/count block duplicates the app-bar title. Add Person is
     already down to its icon by here (see the 900px "compact" breakpoint). */
  .directory-toolbar {
    padding: 8px 10px;
  }
  .directory-toolbar-heading {
    display: none;
  }
  .directory-toolbar,
  .directory-actions {
    align-items: center;
    flex-direction: row;
  }
  .directory-actions {
    width: 100%;
    gap: 6px;
  }
  .people-grid {
    --list-pad: 10px;
  }
}
/* Tied to .people-grid's own rendered width (a container query), not the window's — the
   filters sidebar (permanent ≥900px) and the nav eat fixed space out of the window before the
   card list ever sees it, so a window-width breakpoint can't reliably predict when a card
   actually has room for its own content (same class of issue fixed on the Songs page). Hide,
   not wrap: a wrapped availability badge floating under the name read as more confusing than
   useful once it stopped being scannable at a glance. */
/* The rail survives every width breakpoint below — a narrow screen is exactly where scrubbing a
   long directory by hand is worst, and it sizes its own width/glyphs to fit (see
   AlphabetIndexRail.vue). Same reasoning as the Songs page. */
@container people-grid (max-width: 520px) {
  .availability-state {
    display: none;
  }
}
@container people-grid (max-width: 380px) {
  .person-roles,
  .person-no-roles {
    display: none;
  }
}
/* A window-height @media query, not a container query: .people-grid is a `container-type:
   inline-size` container, so it can only be asked about width — and switching it to
   `container-type: size` would require containing its block size too, which fights the flex
   sizing that gives the list its height in the first place. Window height is the honest input
   here anyway.
   The roles block roughly doubles a card's height, so on a short window it's the difference
   between about five people on screen and about ten. Identity (name, email, availability) is what
   the directory is scanned for; roles are detail the person's own page still carries. 700px keeps
   them on a normal laptop (768px tall and up) and drops them for short windows and phone
   landscape — phone *portrait* is already covered by the width rule above. */
@media (max-height: 700px) {
  .person-roles,
  .person-no-roles {
    display: none;
  }
}
</style>
