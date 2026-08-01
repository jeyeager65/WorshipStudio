<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import ManagedStringList from './ManagedStringList.vue'
import type { RoleGroup } from '@/models/settings'

const props = defineProps<{ modelValue: RoleGroup[] }>()
const emit = defineEmits<{ 'update:modelValue': [RoleGroup[]] }>()
const confirmDialog = useConfirmDialogStore()

const selectedIndex = ref(0)
const newGroupName = ref('')
const selectedGroup = computed(() => props.modelValue[selectedIndex.value])
const totalRoles = computed(() =>
  props.modelValue.reduce((total, group) => total + group.roles.length, 0),
)

watch(
  () => props.modelValue.length,
  (length) => {
    if (length === 0) selectedIndex.value = 0
    else selectedIndex.value = Math.min(selectedIndex.value, length - 1)
  },
)

function addGroup() {
  const name = newGroupName.value.trim()
  if (!name || props.modelValue.some((group) => group.name.toLowerCase() === name.toLowerCase()))
    return
  emit('update:modelValue', [...props.modelValue, { name, roles: [] }])
  selectedIndex.value = props.modelValue.length
  newGroupName.value = ''
}

function renameGroup(name: string) {
  const group = selectedGroup.value
  if (!group) return
  const groups = [...props.modelValue]
  groups[selectedIndex.value] = { ...group, name }
  emit('update:modelValue', groups)
}

function setRoles(roles: string[]) {
  const group = selectedGroup.value
  if (!group) return
  const groups = [...props.modelValue]
  groups[selectedIndex.value] = { ...group, roles }
  emit('update:modelValue', groups)
}

async function removeSelectedGroup() {
  const group = selectedGroup.value
  if (!group) return
  if (
    !(await confirmDialog.confirm(`Remove the "${group.name}" category and its roles?`, 'Remove'))
  )
    return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, index) => index !== selectedIndex.value),
  )
}
</script>

<template>
  <div class="role-workspace">
    <aside class="role-directory">
      <header class="directory-summary">
        <div>
          <strong>{{ modelValue.length }}</strong>
          <span>Categories</span>
        </div>
        <div>
          <strong>{{ totalRoles }}</strong>
          <span>Roles</span>
        </div>
      </header>

      <div class="category-list">
        <button
          v-for="(group, index) in modelValue"
          :key="`${group.name}-${index}`"
          type="button"
          class="category-item"
          :class="{ 'category-item--active': selectedIndex === index }"
          @click="selectedIndex = index"
        >
          <span class="category-icon"
            ><v-icon icon="mdi-account-multiple-outline" size="19"
          /></span>
          <span class="category-copy">
            <strong>{{ group.name || 'Untitled category' }}</strong>
            <small>{{ group.roles.length }} role{{ group.roles.length === 1 ? '' : 's' }}</small>
          </span>
          <v-icon icon="mdi-chevron-right" size="17" />
        </button>
        <div v-if="modelValue.length === 0" class="directory-empty">No role categories yet.</div>
      </div>

      <div class="directory-add">
        <v-text-field
          v-model="newGroupName"
          label="New category"
          placeholder="e.g. Praise Team"
          variant="outlined"
          density="compact"
          hide-details
          @keydown.enter="addGroup"
        />
        <v-btn
          color="primary"
          variant="flat"
          icon="mdi-plus"
          aria-label="Add role category"
          :disabled="!newGroupName.trim()"
          @click="addGroup"
        />
      </div>
    </aside>

    <section v-if="selectedGroup" class="role-editor">
      <header class="editor-heading">
        <div>
          <span>Role Category</span>
          <h3>{{ selectedGroup.name || 'Untitled category' }}</h3>
        </div>
        <v-btn
          variant="text"
          color="error"
          prepend-icon="mdi-delete-outline"
          @click="removeSelectedGroup"
        >
          Remove
        </v-btn>
      </header>

      <div class="editor-section">
        <label>Category details</label>
        <v-text-field
          :model-value="selectedGroup.name"
          label="Category name"
          variant="outlined"
          density="comfortable"
          hide-details
          @update:model-value="renameGroup"
        />
        <p>Categories organize related assignments in schedules and planning reports.</p>
      </div>

      <div class="editor-section">
        <div class="section-label-row">
          <label>Roles</label>
          <span>{{ selectedGroup.roles.length }} configured</span>
        </div>
        <ManagedStringList
          :model-value="selectedGroup.roles"
          add-label="Add a role…"
          @update:model-value="setRoles"
        />
      </div>
    </section>

    <section v-else class="workspace-empty">
      <span><v-icon icon="mdi-account-plus-outline" size="28" /></span>
      <h3>Create your first role category</h3>
      <p>Group related responsibilities such as Praise Team, Building, or Service Leaders.</p>
    </section>
  </div>
</template>

<style scoped>
.role-workspace {
  display: grid;
  min-height: 480px;
  grid-template-columns: 290px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.65);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.08);
}
.role-directory {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.3);
}
.directory-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.directory-summary div {
  padding: 15px 17px;
}
.directory-summary div + div {
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.directory-summary strong,
.directory-summary span {
  display: block;
}
.directory-summary strong {
  font-size: 1.15rem;
}
.directory-summary span {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.65rem;
  text-transform: uppercase;
}
.category-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 9px;
}
.category-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.category-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.category-item--active {
  border-color: rgba(var(--v-theme-primary), 0.18);
  background: rgba(var(--v-theme-primary), 0.09);
}
.category-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.category-copy,
.category-copy strong,
.category-copy small {
  display: block;
  min-width: 0;
}
.category-copy strong {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.category-copy small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.64rem;
}
.directory-empty {
  padding: 24px 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.72rem;
  text-align: center;
}
.directory-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.role-editor {
  min-width: 0;
  padding: 24px;
}
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.editor-heading span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.editor-heading h3 {
  margin: 2px 0 0;
  font-size: 1.05rem;
}
.editor-section {
  max-width: 620px;
  padding-top: 22px;
}
.editor-section > label,
.section-label-row label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.73rem;
  font-weight: 700;
}
.editor-section p,
.section-label-row span {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.67rem;
}
.editor-section p {
  margin: 7px 0 0;
}
.section-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.workspace-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 48px;
  text-align: center;
}
.workspace-empty > span {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.workspace-empty h3 {
  margin: 14px 0 4px;
  font-size: 0.9rem;
}
.workspace-empty p {
  max-width: 360px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
}
@media (max-width: 820px) {
  .role-workspace {
    grid-template-columns: 1fr;
  }
  .role-directory {
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
}
</style>
