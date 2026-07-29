<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import PersonEditorDialog from '@/components/people/PersonEditorDialog.vue'
import type { Person } from '@/models/library'

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

const searchQuery = ref('')
const filteredPeople = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (searchQuery.value ?? '').trim().toLowerCase()
  const matches = peopleStore.people.filter((person) => {
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

// The same 8 theme colors already used to color-code song blocks and service item types (see
// utils/contentColors.ts) — reused here so a role's category and a person's avatar read as
// consistent color-coding with the rest of the app, not an unrelated new palette.
const THEME_COLORS = ['primary', 'secondary', 'teal', 'violet', 'rose', 'amber', 'slate', 'terracotta']

// Stable per-category color: same category always gets the same color on this screen, driven
// by the category's own position in Settings > Roles rather than a hash, so reordering
// categories there is the only thing that would ever change a color.
function categoryColor(role: string): string {
  const groups = settingsStore.librarySettings?.roleGroups ?? []
  const index = groups.findIndex((g) => g.roles.includes(role))
  return index === -1 ? 'slate' : THEME_COLORS[index % THEME_COLORS.length]
}

function initials(person: Person): string {
  return `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()
}

// Deterministic per-person color (not category-based — someone with no roles yet still gets a
// distinct avatar) so the list reads as a set of individuals at a glance, not a wall of text.
function avatarColor(person: Person): string {
  const key = `${person.firstName}${person.lastName}`
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return THEME_COLORS[hash % THEME_COLORS.length]
}

const dialogOpen = ref(false)
const editing = ref<Person>()
function openAdd() {
  editing.value = undefined
  dialogOpen.value = true
}
function openEdit(person: Person) {
  editing.value = person
  dialogOpen.value = true
}
async function save(person: Person) {
  await peopleStore.save(person)
}
async function remove(person: Person) {
  if (!(await confirmDialog.confirm(`Delete ${personLabel(person)}?`, 'Delete'))) return
  await peopleStore.remove(person.id)
}
</script>

<template>
  <v-container class="py-8" style="max-width: 780px">
    <div class="d-flex align-center justify-space-between mb-1">
      <h1 class="text-h5 font-weight-bold">People</h1>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-account-plus-outline" @click="openAdd">Add Person</v-btn>
    </div>
    <p class="text-medium-emphasis text-body-2 mb-6">
      Add anyone who takes on a role in a service — musicians, sound/tech, greeters, or the preacher.
    </p>

    <v-text-field
      v-if="peopleStore.people.length > 0"
      v-model="searchQuery"
      prepend-inner-icon="mdi-magnify"
      label="Search by name, category, or role…"
      variant="outlined"
      density="comfortable"
      clearable
      class="mb-4"
    />

    <v-card v-if="peopleStore.people.length === 0" variant="outlined" rounded="lg" class="pa-6 text-center">
      <p class="text-medium-emphasis mb-0">No one added yet.</p>
    </v-card>
    <v-card v-else-if="filteredPeople.length === 0" variant="outlined" rounded="lg" class="pa-6 text-center">
      <p class="text-medium-emphasis mb-0">No matches found.</p>
    </v-card>

    <v-list v-else rounded="lg" border>
      <v-list-item v-for="person in filteredPeople" :key="person.id" @click="openEdit(person)">
        <template #prepend>
          <v-avatar :color="avatarColor(person)" class="mr-3">
            <span class="text-body-2 font-weight-bold text-white">{{ initials(person) }}</span>
          </v-avatar>
        </template>
        <v-list-item-title>{{ personLabel(person) }}</v-list-item-title>
        <v-list-item-subtitle v-if="person.preferredRoles.length" class="mt-1">
          <div v-for="group in roleGroupsFor(person)" :key="group.name" class="d-flex align-center flex-wrap ga-1 mb-1">
            <span class="text-medium-emphasis mr-1" style="font-size: 14px">{{ group.name }}:</span>
            <v-chip
              v-for="role in group.roles"
              :key="role"
              size="x-small"
              :color="categoryColor(role)"
              variant="flat"
              class="text-white"
            >
              {{ role }}
            </v-chip>
          </div>
        </v-list-item-subtitle>
        <template #append>
          <v-btn icon="mdi-delete-outline" variant="text" size="small" @click.stop="remove(person)" />
        </template>
      </v-list-item>
    </v-list>

    <PersonEditorDialog v-model="dialogOpen" :person="editing" :role-groups="settingsStore.librarySettings?.roleGroups ?? []" @save="save" />
  </v-container>
</template>
