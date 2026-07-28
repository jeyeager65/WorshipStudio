<script setup lang="ts">
import { ref } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ManagedStringList from './ManagedStringList.vue'
import type { RoleGroup } from '@/models/settings'

const props = defineProps<{ modelValue: RoleGroup[] }>()
const emit = defineEmits<{ 'update:modelValue': [RoleGroup[]] }>()
const confirmDialog = useConfirmDialogStore()

const newGroupName = ref('')

function addGroup() {
  const name = newGroupName.value.trim()
  if (!name || props.modelValue.some((g) => g.name === name)) return
  emit('update:modelValue', [...props.modelValue, { name, roles: [] }])
  newGroupName.value = ''
}

function renameGroup(index: number, name: string) {
  const group = props.modelValue[index]
  if (!group) return
  const groups = [...props.modelValue]
  groups[index] = { ...group, name }
  emit('update:modelValue', groups)
}

function setRoles(index: number, roles: string[]) {
  const group = props.modelValue[index]
  if (!group) return
  const groups = [...props.modelValue]
  groups[index] = { ...group, roles }
  emit('update:modelValue', groups)
}

async function removeGroup(index: number) {
  const group = props.modelValue[index]
  if (!group) return
  if (!(await confirmDialog.confirm(`Remove the "${group.name}" category and its roles?`, 'Remove'))) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}
</script>

<template>
  <div>
    <v-card v-for="(group, index) in modelValue" :key="index" variant="outlined" rounded="lg" class="pa-3 mb-3">
      <div class="d-flex align-center ga-2 mb-2">
        <v-text-field
          :model-value="group.name"
          label="Category name"
          variant="outlined"
          density="compact"
          hide-details
          @update:model-value="(value: string) => renameGroup(index, value)"
        />
        <v-btn icon="mdi-delete-outline" variant="text" size="small" @click="removeGroup(index)" />
      </div>
      <ManagedStringList
        :model-value="group.roles"
        add-label="Add a role…"
        @update:model-value="(roles) => setRoles(index, roles)"
      />
    </v-card>
    <p v-if="modelValue.length === 0" class="text-medium-emphasis text-body-2 mb-3">No categories yet.</p>

    <div class="d-flex ga-2" style="max-width: 400px">
      <v-text-field
        v-model="newGroupName"
        label="Add a category…"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter="addGroup"
      />
      <v-btn variant="flat" color="primary" icon="mdi-plus" @click="addGroup" />
    </div>
  </div>
</template>
