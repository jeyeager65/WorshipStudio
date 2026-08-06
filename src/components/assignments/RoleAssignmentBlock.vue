<script setup lang="ts">
import type { RoleAssignment } from '@/models/service'
import type { PersonOption } from '@/utils/personOptions'

// One role's worth of assignment rows (e.g. "Vocals ×2") — the role name is shown once here
// rather than repeated per row, which is what made the previous layout feel bulky. `assignment`
// objects are the same reactive objects living in the parent's Service.assignments array, so
// v-model on personId/tentative mutates them in place with no emit needed; add/remove do need
// to touch the array itself, so those go back up to the parent.
defineProps<{
  label: string
  assignments: RoleAssignment[]
  personOptions: PersonOption[]
  color?: string
  isConflicted: (assignment: RoleAssignment) => boolean
  isUnavailable: (assignment: RoleAssignment) => boolean
}>()
defineEmits<{ add: []; remove: [RoleAssignment] }>()
</script>

<template>
  <article class="role-block" :style="{ '--role-color': color ? `rgb(var(--v-theme-${color}))` : 'rgb(var(--v-theme-primary))' }">
    <header class="role-header">
      <div>
        <div class="role-title">{{ label }}</div>
        <div class="role-count">
          {{ assignments.length === 0 ? 'No assignments' : `${assignments.length} assignment${assignments.length === 1 ? '' : 's'}` }}
        </div>
      </div>
      <v-spacer />
      <button type="button" class="role-add-button" @click="$emit('add')">
        <v-icon icon="mdi-plus" size="18" />
        <span>Add Person</span>
      </button>
    </header>
    <div v-if="assignments.length" class="assignment-list">
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
        <label class="person-field">
          <span>Person</span>
          <v-select
            v-model="assignment.personId"
            :items="personOptions"
            placeholder="Choose a person"
            variant="outlined"
            density="compact"
            hide-details
            clearable
          />
        </label>
        <v-checkbox v-model="assignment.tentative" label="Tentative" density="compact" hide-details class="tentative-check" />
        <div class="assignment-statuses">
          <v-chip v-if="isConflicted(assignment)" color="warning" size="small" variant="tonal" prepend-icon="mdi-alert-outline">
            CONFLICT
          </v-chip>
          <v-chip v-if="isUnavailable(assignment)" color="error" size="small" variant="tonal" prepend-icon="mdi-calendar-remove-outline">
            Unavailable
          </v-chip>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          class="remove-btn"
          :aria-label="`Remove this ${label} assignment`"
          @click="$emit('remove', assignment)"
        />
      </div>
    </div>
    <button v-else type="button" class="unassigned-prompt" @click="$emit('add')">
      <v-icon icon="mdi-account-plus-outline" size="18" />
      <span>No one assigned yet</span>
      <strong>Add someone</strong>
    </button>
  </article>
</template>

<style scoped>
.role-block {
  margin-bottom: 11px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--role-color) 15%, rgba(var(--v-theme-on-surface), 0.075));
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.34);
}
.role-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 7px 10px 7px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: color-mix(in srgb, var(--role-color) 5%, transparent);
}
.role-title {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 0.9rem;
  font-weight: 670;
  line-height: 1.25;
}
.role-count {
  margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.74rem;
}
.role-add-button {
  display: inline-flex;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 11px 0 9px;
  border: 1px solid color-mix(in srgb, var(--role-color) 30%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--role-color) 9%, transparent);
  color: var(--role-color);
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 650;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.role-add-button:hover {
  border-color: color-mix(in srgb, var(--role-color) 55%, transparent);
  background: color-mix(in srgb, var(--role-color) 15%, transparent);
}
.role-add-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--role-color) 70%, transparent);
  outline-offset: 2px;
}
.assignment-list {
  padding: 4px 10px;
}
.assignment-row {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) auto minmax(0, auto) 34px;
  align-items: center;
  gap: 14px;
  min-height: 60px;
  padding: 7px 4px 8px 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.055);
}
.assignment-row:last-of-type {
  border-bottom: none;
}
.person-field {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
}
.person-field > span {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
}
.person-field :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.62);
  font-size: 0.84rem;
}
.tentative-check :deep(.v-label) {
  font-size: 0.78rem;
}
.assignment-statuses {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
/* A soft heads-up, not an error — plenty of people can genuinely fill two roles in the same
   service with no problem, and there's no reasonable way to define which combinations are
   actually fine, so this just invites a second look rather than claiming something's wrong. */
.assignment-row--conflict {
  background: rgba(var(--v-theme-warning), 0.1);
  border-radius: 6px;
  box-shadow: inset 3px 0 rgb(var(--v-theme-warning));
}
/* Unavailable is kept as a harder error — the person said outright they can't do this date. */
.assignment-row--unavailable {
  background: rgba(var(--v-theme-error), 0.08);
  border-radius: 6px;
  box-shadow: inset 3px 0 rgb(var(--v-theme-error));
}
.assignment-row--tentative {
  background: rgba(var(--v-theme-slate), 0.055);
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
.unassigned-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 20px);
  margin: 8px 10px 10px;
  padding: 9px 11px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.48);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.unassigned-prompt strong {
  margin-left: auto;
  color: rgb(var(--v-theme-primary));
  font-weight: 650;
}
.unassigned-prompt:hover,
.unassigned-prompt:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.38);
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.7);
  outline: none;
}
@media (max-width: 820px) {
  .assignment-row {
    grid-template-columns: minmax(0, 1fr) auto 34px;
  }
  .assignment-statuses {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
    padding-left: 63px;
  }
}
</style>
