<script setup lang="ts">
import { ref, toRaw, watch } from 'vue'
import type { UnavailableDateRange, Volunteer } from '@/models/library'

const props = defineProps<{ modelValue: boolean; volunteer?: Volunteer; roleOptions: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; save: [Volunteer] }>()

function blank(): Volunteer {
  return {
    id: `volunteer-${crypto.randomUUID()}`,
    firstName: '',
    lastName: '',
    preferredRoles: [],
    unavailableDateRanges: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

const draft = ref<Volunteer>(blank())
const newRangeStart = ref('')
const newRangeEnd = ref('')

// Resets to either a fresh blank record or a copy of the volunteer being edited each time the
// dialog opens, so repeated opens never leak a previous edit into a new one.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = props.volunteer ? structuredClone(toRaw(props.volunteer)) : blank()
    newRangeStart.value = ''
    newRangeEnd.value = ''
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
function removeUnavailableRange(range: UnavailableDateRange) {
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
    <v-card>
      <v-card-title>{{ volunteer ? 'Edit Volunteer' : 'Add Volunteer' }}</v-card-title>
      <v-card-text>
        <div class="d-flex ga-3 mb-2">
          <v-text-field v-model="draft.firstName" label="First Name" variant="outlined" density="compact" />
          <v-text-field v-model="draft.lastName" label="Last Name" variant="outlined" density="compact" />
        </div>

        <v-text-field
          v-model="draft.email"
          label="Email (optional)"
          type="email"
          variant="outlined"
          density="compact"
          hint='Used for "Send Assignments by Email" — leave blank if not needed'
          persistent-hint
          class="mb-4"
        />

        <div class="text-caption font-weight-bold text-medium-emphasis mb-2">
          Roles (optional — just for filtering, not a restriction)
        </div>
        <div class="d-flex flex-wrap ga-2 mb-1">
          <v-chip
            v-for="role in roleOptions"
            :key="role"
            :color="draft.preferredRoles.includes(role) ? 'primary' : undefined"
            :variant="draft.preferredRoles.includes(role) ? 'flat' : 'outlined'"
            @click="toggleRole(role)"
          >
            {{ role }}
          </v-chip>
        </div>
        <p class="text-caption text-medium-emphasis mb-4">
          Makes this volunteer show up first when filling roster fields for these roles — they can still be
          assigned anywhere.
        </p>

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
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="outlined" class="mr-2" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn variant="flat" color="primary" @click="save">Save Volunteer</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
