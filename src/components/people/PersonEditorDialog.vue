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
    <v-card height="640" style="display: flex; flex-direction: column">
      <v-card-title style="flex-shrink: 0">{{ person ? 'Edit Person' : 'Add Person' }}</v-card-title>
      <v-tabs v-model="tab" class="px-4" style="flex-shrink: 0">
        <v-tab value="general">General</v-tab>
        <v-tab value="roles">Roles</v-tab>
        <v-tab value="availability">Availability</v-tab>
      </v-tabs>
      <v-card-text style="flex: 1 1 auto; min-height: 0; overflow-y: auto">
        <!-- Plain v-show panes, not v-window — v-window animates its own height to match
             whichever tab is active, which is exactly what makes the dialog resize when
             switching tabs. A v-show'd div has no such behavior: the dialog's height is only
             ever driven by the v-card's own fixed height above. -->
        <div v-show="tab === 'general'" class="pt-1">
          <div class="d-flex ga-3 mb-2">
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

        <div v-show="tab === 'roles'" class="pt-1">
          <div v-for="group in roleGroups" :key="group.name">
            <template v-if="group.roles.length">
              <div class="text-overline text-medium-emphasis">{{ group.name }}</div>
              <div class="d-flex flex-wrap ga-2 mb-2">
                <v-chip
                  v-for="role in group.roles"
                  :key="role"
                  :color="draft.preferredRoles.includes(role) ? 'primary' : undefined"
                  :variant="draft.preferredRoles.includes(role) ? 'flat' : 'outlined'"
                  @click="toggleRole(role)"
                >
                  {{ role }}
                </v-chip>
              </div>
            </template>
          </div>
          <p class="text-caption text-medium-emphasis">
            Makes this person show up first when filling roles for these — they can still be assigned anywhere.
          </p>
        </div>

        <div v-show="tab === 'availability'" class="pt-1">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">Unavailable Dates (optional)</div>
          <div class="d-flex flex-wrap ga-2 mb-2">
            <v-chip
              v-for="range in draft.unavailableDateRanges"
              :key="`${range.start}-${range.end}`"
              closable
              @click:close="removeUnavailableRange(range)"
            >
              {{ range.start }} – {{ range.end }}
            </v-chip>
          </div>
          <div class="d-flex align-end ga-2">
            <v-text-field v-model="newRangeStart" label="Start" type="date" variant="outlined" density="compact" hide-details />
            <v-text-field v-model="newRangeEnd" label="End" type="date" variant="outlined" density="compact" hide-details />
            <v-btn variant="outlined" @click="addUnavailableRange">Add</v-btn>
          </div>
          <p class="text-caption text-medium-emphasis mt-2">
            Roster assignments during these dates are flagged the same way a double-booking is.
          </p>
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
