<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'

const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()
const confirmDialog = useConfirmDialogStore()

onMounted(() => {
  roleGroupsStore.load()
  rolesStore.load()
})

const selectedGroupId = ref<string>()
const newGroupName = ref('')
const newRoleName = ref('')
const selectedGroup = computed(() =>
  roleGroupsStore.roleGroups.find((group) => group.id === selectedGroupId.value),
)
const rolesInSelectedGroup = computed(() =>
  rolesStore.roles.filter((role) => role.groupId === selectedGroupId.value),
)

watch(
  () => roleGroupsStore.roleGroups,
  (groups) => {
    if (groups.some((group) => group.id === selectedGroupId.value)) return
    selectedGroupId.value = groups[0]?.id
  },
  { immediate: true },
)

function addGroup() {
  const name = newGroupName.value.trim()
  if (
    !name ||
    roleGroupsStore.roleGroups.some((group) => group.name.toLowerCase() === name.toLowerCase())
  )
    return
  roleGroupsStore.save({ id: `group-${crypto.randomUUID()}`, name })
  newGroupName.value = ''
}

function renameGroup(name: string) {
  const group = selectedGroup.value
  if (!group) return
  roleGroupsStore.save({ ...group, name })
}

function addRole() {
  const name = newRoleName.value.trim()
  const group = selectedGroup.value
  if (
    !group ||
    !name ||
    rolesInSelectedGroup.value.some((role) => role.name.toLowerCase() === name.toLowerCase())
  )
    return
  rolesStore.save({ id: `role-${crypto.randomUUID()}`, name, groupId: group.id })
  newRoleName.value = ''
}

async function removeRole(id: string) {
  const role = rolesInSelectedGroup.value.find((candidate) => candidate.id === id)
  if (!role) return
  if (!(await confirmDialog.confirm(`Remove the "${role.name}" role?`, 'Remove'))) return
  await rolesStore.remove(id)
}

async function removeSelectedGroup() {
  const group = selectedGroup.value
  if (!group) return
  if (
    !(await confirmDialog.confirm(`Remove the "${group.name}" category and its roles?`, 'Remove'))
  )
    return
  for (const role of rolesInSelectedGroup.value) {
    await rolesStore.remove(role.id)
  }
  await roleGroupsStore.remove(group.id)
}
</script>

<template>
  <div class="role-workspace">
    <aside class="role-directory">
      <div class="directory-heading">Role Categories</div>
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

      <div class="category-list">
        <button
          v-for="group in roleGroupsStore.roleGroups"
          :key="group.id"
          type="button"
          class="category-item"
          :class="{ 'category-item--active': selectedGroupId === group.id }"
          @click="selectedGroupId = group.id"
        >
          <span class="category-icon"
            ><v-icon icon="mdi-account-multiple-outline" size="19"
          /></span>
          <span class="category-copy">
            <strong>{{ group.name || 'Untitled category' }}</strong>
            <small
              >{{ rolesStore.roles.filter((r) => r.groupId === group.id).length }} role{{
                rolesStore.roles.filter((r) => r.groupId === group.id).length === 1 ? '' : 's'
              }}</small
            >
          </span>
          <v-icon icon="mdi-chevron-right" size="17" />
        </button>
        <div v-if="roleGroupsStore.roleGroups.length === 0" class="directory-empty">
          No role categories yet.
        </div>
      </div>
    </aside>

    <section v-if="selectedGroup" class="role-editor">
      <header class="editor-heading">
        <div class="editor-heading-copy">
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
          density="compact"
          hide-details
          @update:model-value="renameGroup"
        />
        <p>Categories organize related assignments in schedules and planning reports.</p>
      </div>

      <div class="editor-section">
        <div class="section-label-row">
          <label>Roles</label>
          <span>{{ rolesInSelectedGroup.length }} configured</span>
        </div>
        <div class="role-add-row">
          <v-text-field
            v-model="newRoleName"
            label="New role"
            placeholder="e.g. Worship Leader"
            variant="outlined"
            density="compact"
            hide-details
            @keydown.enter="addRole"
          />
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            :disabled="!newRoleName.trim()"
            @click="addRole"
          >
            Add Role
          </v-btn>
        </div>
        <div v-if="rolesInSelectedGroup.length" class="role-list">
          <div v-for="role in rolesInSelectedGroup" :key="role.id" class="role-row">
            <span class="role-row-icon"><v-icon icon="mdi-account-outline" size="18" /></span>
            <strong>{{ role.name }}</strong>
            <div class="role-row-actions">
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                size="small"
                color="error"
                :aria-label="`Remove ${role.name}`"
                @click="removeRole(role.id)"
              />
            </div>
          </div>
        </div>
        <div v-else class="roles-empty">
          <v-icon icon="mdi-account-plus-outline" size="24" />
          <span>No roles in this category yet.</span>
        </div>
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
/* Same eyebrow treatment as .editor-heading span on the detail panel below — labels this as
   its own distinct section rather than leaving "Role Category" (that other eyebrow) as the
   first bold text on the page, which read like it was introducing the whole page instead of
   just the currently-selected category once the page's own title hides at narrow widths. */
.directory-heading {
  /* Top padding matches .role-editor's own 24px (not the 12px .directory-add/.category-list
     below use) so this eyebrow lines up vertically with .editor-heading span's "Role Category"
     eyebrow next to it — misaligned before at widths where the two panels sit side by side.
     Left padding matches .directory-add's own 12px instead, not .role-editor's — this heading
     needs to align with the input directly below it in the *same* column, not the other
     column's unrelated inset. */
  padding: 24px 12px 0;
  color: rgb(var(--v-theme-primary));
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.directory-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  /* Without this, grid's default stretch forces the compact-density field to match the "+"
     icon button's own (taller) natural height instead of its own — same fix as .role-add-row
     below, and why "New category" looked taller than "New role" despite both being compact. */
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
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
/* Without this, .editor-heading's align-items:center vertically centers this against the taller
   Remove button next to it, pushing "Role Category" down a few px from the row's actual top —
   which no longer matched .directory-heading's own clean, un-centered top edge once that was
   added. Pinned to the top instead, deterministically, rather than compensating with a guessed
   padding value on the other side that would only be right by coincidence. The Remove button
   itself is untouched — still centered against the row via .editor-heading's own align-items. */
.editor-heading-copy {
  align-self: flex-start;
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
.role-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  /* Without this, grid's default stretch forces the "Add Role" button taller than its own
     natural height to match the row — its icon/label aren't centered within that extra height,
     reading as "the button sits slightly high". Centering both children at their own natural
     size fixes that and keeps the compact-density field from being stretched too. */
  align-items: center;
  gap: 8px;
  margin-bottom: 11px;
}
.role-list {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 9px;
}
.role-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 5px 7px 5px 11px;
  background: rgba(var(--v-theme-background), 0.16);
}
.role-row + .role-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.075);
}
.role-row-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 7px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.role-row strong {
  font-size: 0.72rem;
}
.role-row-actions {
  display: flex;
  align-items: center;
}
.roles-empty {
  display: flex;
  min-height: 110px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 9px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.69rem;
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
