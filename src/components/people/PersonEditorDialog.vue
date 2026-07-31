<script setup lang="ts">
import { ref, toRaw, watch } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { UnavailableDateRange, Person } from '@/models/library'
import type { RoleGroup } from '@/models/settings'

const props = defineProps<{ modelValue: boolean; person?: Person; roleGroups: RoleGroup[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; save: [Person] }>()
const confirmDialog = useConfirmDialogStore()

function blank(): Person {
  return {
    id: `person-${crypto.randomUUID()}`,
    firstName: '',
    lastName: '',
    preferredRoles: [],
    unavailableDateRanges: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

const draft = ref<Person>(blank())
const newRangeStart = ref('')
const newRangeEnd = ref('')
const tab = ref('general')
const categoryColors = ['primary', 'teal', 'violet', 'terracotta', 'rose', 'slate', 'secondary', 'amber']

// Resets to either a fresh blank record or a copy of the person being edited each time the
// dialog opens, so repeated opens never leak a previous edit into a new one.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = props.person ? structuredClone(toRaw(props.person)) : blank()
    newRangeStart.value = ''
    newRangeEnd.value = ''
    tab.value = 'general'
  },
)

function toggleRole(role: string) {
  const index = draft.value.preferredRoles.indexOf(role)
  if (index === -1) draft.value.preferredRoles.push(role)
  else draft.value.preferredRoles.splice(index, 1)
}

function addUnavailableRange() {
  if (!newRangeStart.value || !newRangeEnd.value || newRangeStart.value > newRangeEnd.value) return
  draft.value.unavailableDateRanges.push({ start: newRangeStart.value, end: newRangeEnd.value })
  newRangeStart.value = ''
  newRangeEnd.value = ''
}
async function removeUnavailableRange(range: UnavailableDateRange) {
  if (!(await confirmDialog.confirm(`Remove the unavailable range ${range.start} – ${range.end}?`, 'Remove'))) return
  draft.value.unavailableDateRanges = draft.value.unavailableDateRanges.filter((r) => r !== range)
}

function save() {
  if (!draft.value.firstName.trim()) return
  emit('save', draft.value)
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="(v) => emit('update:modelValue', v)">
    <!-- height must be the v-card PROP, not a height CSS/style — Vuetify's own dialog
         stylesheet applies `flex: 1 1 var(--v-card-height, 100%)` to any .v-card inside a
         .v-dialog, and flex-basis overrides a plain `height` for sizing purposes regardless of
         specificity. Only the height PROP populates that --v-card-height variable. -->
    <v-card height="640" class="person-dialog-card">
      <v-card-title class="person-dialog-title">
        <span class="person-dialog-icon"><v-icon icon="mdi-account-outline" size="23" /></span>
        <span>
          <strong>{{ person ? 'Edit Person' : 'Add Person' }}</strong>
          <small>{{ person ? 'Update directory details and serving preferences' : 'Create a new directory profile' }}</small>
        </span>
      </v-card-title>
      <v-tabs v-model="tab" class="person-dialog-tabs" grow>
        <v-tab value="general">General</v-tab>
        <v-tab value="roles">Roles</v-tab>
        <v-tab value="availability">Availability</v-tab>
      </v-tabs>
      <v-card-text style="flex: 1 1 auto; min-height: 0; overflow-y: auto">
        <!-- Plain v-show panes, not v-window — v-window animates its own height to match
             whichever tab is active, which is exactly what makes the dialog resize when
             switching tabs. A v-show'd div has no such behavior: the dialog's height is only
             ever driven by the v-card's own fixed height above. -->
        <div v-show="tab === 'general'" class="person-form-pane">
          <div class="person-name-fields">
            <v-text-field v-model="draft.firstName" label="First Name" variant="outlined" density="compact" />
            <v-text-field v-model="draft.lastName" label="Last Name" variant="outlined" density="compact" />
          </div>

          <v-text-field
            v-model="draft.displayName"
            label="Display Name (optional)"
            variant="outlined"
            density="compact"
            hint='How this person&apos;s name should appear elsewhere in the app — e.g. "Mike Smith" for Michael Smith, or "Pastor Dan" for Daniel Renno.'
            persistent-hint
            class="mb-4"
          />

          <v-text-field
            v-model="draft.email"
            label="Email (optional)"
            type="email"
            variant="outlined"
            density="compact"
            hint='Used for "Send Assignments by Email" — leave blank if not needed'
            persistent-hint
          />
        </div>

        <div v-show="tab === 'roles'" class="person-form-pane">
          <p class="pane-description">Choose the roles this person usually fills. They can still be assigned to any role.</p>
          <div
            v-for="(group, groupIndex) in roleGroups"
            :key="group.name"
            class="role-choice-group"
            :style="{ '--category-color': `rgb(var(--v-theme-${categoryColors[groupIndex % categoryColors.length]}))` }"
          >
            <template v-if="group.roles.length">
              <div class="role-choice-heading"><v-icon icon="mdi-shape-outline" size="16" />{{ group.name }}</div>
              <div class="d-flex flex-wrap ga-2">
                <v-chip
                  v-for="role in group.roles"
                  :key="role"
                  :color="categoryColors[groupIndex % categoryColors.length]"
                  :variant="draft.preferredRoles.includes(role) ? 'flat' : 'outlined'"
                  :prepend-icon="draft.preferredRoles.includes(role) ? 'mdi-check' : undefined"
                  @click="toggleRole(role)"
                >
                  {{ role }}
                </v-chip>
              </div>
            </template>
          </div>
        </div>

        <div v-show="tab === 'availability'" class="person-form-pane">
          <p class="pane-description">Assignments during these dates will be clearly flagged for the service planner.</p>
          <div class="availability-heading">Unavailable Dates</div>
          <div v-if="draft.unavailableDateRanges.length" class="d-flex flex-wrap ga-2 mb-3">
            <v-chip
              v-for="range in draft.unavailableDateRanges"
              :key="`${range.start}-${range.end}`"
              closable
              @click:close="removeUnavailableRange(range)"
            >
              {{ range.start }} – {{ range.end }}
            </v-chip>
          </div>
          <div v-else class="availability-empty"><v-icon icon="mdi-calendar-check-outline" size="20" />No unavailable dates recorded.</div>
          <div class="availability-fields">
            <v-text-field v-model="newRangeStart" label="Start" type="date" variant="outlined" density="compact" hide-details />
            <v-text-field v-model="newRangeEnd" label="End" type="date" variant="outlined" density="compact" hide-details />
            <v-btn variant="outlined" @click="addUnavailableRange">Add</v-btn>
          </div>
        </div>
      </v-card-text>
      <v-card-actions style="flex-shrink: 0">
        <v-spacer />
        <v-btn variant="outlined" class="mr-2" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn variant="flat" color="primary" @click="save">Save Person</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.person-dialog-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.person-dialog-title {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.person-dialog-title > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.person-dialog-title strong {
  font-size: 1rem;
  font-weight: 680;
}
.person-dialog-title small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 400;
  line-height: 1.35;
}
.person-dialog-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.person-dialog-tabs {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.person-form-pane {
  padding-top: 4px;
}
.person-name-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}
.person-form-pane :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.45);
  font-size: 0.82rem;
}
.pane-description {
  margin: 0 0 15px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
  line-height: 1.5;
}
.role-choice-group {
  margin-bottom: 12px;
  padding: 11px 12px 12px;
  border: 1px solid color-mix(in srgb, var(--category-color) 22%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--category-color) 7%, transparent);
  box-shadow: inset 3px 0 var(--category-color);
}
.role-choice-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
  color: var(--category-color);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.availability-heading {
  margin-bottom: 9px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.8rem;
  font-weight: 650;
}
.availability-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.availability-fields {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: end;
  gap: 9px;
}
@media (max-width: 560px) {
  .person-name-fields,
  .availability-fields {
    grid-template-columns: 1fr;
  }
}
</style>
