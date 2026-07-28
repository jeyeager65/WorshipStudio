<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import PersonEditorDialog from '@/components/people/PersonEditorDialog.vue'
import type { Person } from '@/models/library'
import { personDisplayName } from '@/models/library'
import { roleDisplayLabel } from '@/models/settings'

const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()

onMounted(async () => {
  await Promise.all([peopleStore.load(), settingsStore.load()])
})

function roleLabels(person: Person): string {
  return person.preferredRoles.map((r) => roleDisplayLabel(r, settingsStore.librarySettings?.roleGroups ?? [])).join(', ')
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
  if (!(await confirmDialog.confirm(`Delete ${personDisplayName(person)}?`, 'Delete'))) return
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

    <v-card v-if="peopleStore.people.length === 0" variant="outlined" rounded="lg" class="pa-6 text-center">
      <p class="text-medium-emphasis mb-0">No one added yet.</p>
    </v-card>

    <v-list v-else rounded="lg" border>
      <v-list-item v-for="person in peopleStore.people" :key="person.id" @click="openEdit(person)">
        <v-list-item-title>{{ personDisplayName(person) }}</v-list-item-title>
        <v-list-item-subtitle v-if="person.preferredRoles.length">
          {{ roleLabels(person) }}
        </v-list-item-subtitle>
        <template #append>
          <v-btn icon="mdi-delete-outline" variant="text" size="small" @click.stop="remove(person)" />
        </template>
      </v-list-item>
    </v-list>

    <PersonEditorDialog v-model="dialogOpen" :person="editing" :role-groups="settingsStore.librarySettings?.roleGroups ?? []" @save="save" />
  </v-container>
</template>
