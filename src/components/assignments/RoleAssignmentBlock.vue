<script setup lang="ts">
import type { RoleAssignment } from '@/models/service'

// One role's worth of assignment rows (e.g. "Vocals ×2") — the role name is shown once here
// rather than repeated per row, which is what made the previous layout feel bulky. `assignment`
// objects are the same reactive objects living in the parent's Service.assignments array, so
// v-model on personId/tentative mutates them in place with no emit needed; add/remove do need
// to touch the array itself, so those go back up to the parent.
defineProps<{
  label: string
  assignments: RoleAssignment[]
  personOptions: { title: string; value: string }[]
  color?: string
  isConflicted: (assignment: RoleAssignment) => boolean
  isUnavailable: (assignment: RoleAssignment) => boolean
}>()
defineEmits<{ add: []; remove: [RoleAssignment] }>()
</script>

<template>
  <div class="role-block mb-3" :style="{ borderLeftColor: color ? `rgb(var(--v-theme-${color}))` : 'transparent' }">
    <div class="d-flex align-center ga-3 mb-2">
      <span class="role-title">{{ label }}</span>
      <v-chip v-if="assignments.length > 1" size="small" variant="tonal" :color="color">{{ assignments.length }}</v-chip>
      <v-spacer />
      <v-btn size="small" variant="tonal" :color="color" prepend-icon="mdi-plus" class="add-btn" @click="$emit('add')">
        Add
      </v-btn>
    </div>
    <div
      v-for="(assignment, index) in assignments"
      :key="index"
      class="assignment-row"
      :class="{
        'assignment-row--conflict': isConflicted(assignment),
        'assignment-row--unavailable': isUnavailable(assignment),
        'assignment-row--tentative': assignment.tentative,
      }"
    >
      <v-select
        v-model="assignment.personId"
        :items="personOptions"
        label="Person"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 240px"
      />
      <v-checkbox v-model="assignment.tentative" label="Tentative" density="compact" hide-details class="flex-shrink-0" />
      <v-chip v-if="isConflicted(assignment)" color="warning" size="small" variant="flat">CONFLICT</v-chip>
      <v-chip v-if="isUnavailable(assignment)" color="error" size="small" variant="flat">UNAVAILABLE</v-chip>
      <v-spacer />
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        class="remove-btn"
        :aria-label="`Remove this ${label} assignment`"
        @click="$emit('remove', assignment)"
      />
    </div>
    <p v-if="assignments.length === 0" class="text-caption text-medium-emphasis mb-0">No one assigned yet.</p>
  </div>
</template>

<style scoped>
.role-block {
  border-left: 3px solid transparent;
  padding-left: 10px;
}
.role-title {
  font-weight: 700;
  font-size: 17px;
}
.assignment-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.assignment-row:last-of-type {
  border-bottom: none;
}
/* A soft heads-up, not an error — plenty of people can genuinely fill two roles in the same
   service with no problem, and there's no reasonable way to define which combinations are
   actually fine, so this just invites a second look rather than claiming something's wrong. */
.assignment-row--conflict {
  background: rgba(var(--v-theme-warning), 0.1);
  border-radius: 6px;
  padding-left: 6px;
}
/* Unavailable is kept as a harder error — the person said outright they can't do this date. */
.assignment-row--unavailable {
  background: rgba(var(--v-theme-error), 0.08);
  border-radius: 6px;
  padding-left: 6px;
}
.assignment-row--tentative {
  opacity: 0.85;
}
/* Dimmed until the row is actually being interacted with, so the destructive control doesn't
   read as an always-armed, easy-to-miss-click target sitting right next to the Tentative
   checkbox — the opposite problem from the Add button above, which is a deliberate, colored,
   labeled call-to-action rather than a bare icon, so the two don't look/feel interchangeable. */
.remove-btn {
  opacity: 0.4;
  transition: opacity 0.15s ease;
}
.assignment-row:hover .remove-btn,
.remove-btn:focus-visible {
  opacity: 1;
}
</style>
