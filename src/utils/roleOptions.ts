import type { RoleDefinition, RoleGroupDefinition } from '@/models/settings'

/** Present only for a non-selectable section header (Vuetify's v-select/v-autocomplete
 *  subheader convention — see PersonOption elsewhere for the same shape). */
export interface RoleOption {
  type?: 'subheader'
  title: string
  value?: string
}

/** Flattens roles into a subheadered options list, one subheader per group (groupless roles —
 *  shouldn't normally happen, but defensively handled — are listed last under no header).
 *  Shared by every role picker in the app (Assignments, the service workspace's item
 *  role field, Service Template editing, the bulletin's serving-schedule role picker) instead of
 *  each reimplementing this same "group roles by their group, in group order" loop. */
export function roleOptionsFor(
  roles: RoleDefinition[],
  roleGroups: RoleGroupDefinition[],
): RoleOption[] {
  const options: RoleOption[] = []
  for (const group of roleGroups) {
    const groupRoles = roles.filter((role) => role.groupId === group.id)
    if (groupRoles.length === 0) continue
    options.push({ type: 'subheader', title: group.name })
    for (const role of groupRoles) {
      options.push({ title: role.name, value: role.id })
    }
  }
  const groupIds = new Set(roleGroups.map((group) => group.id))
  const ungrouped = roles.filter((role) => !groupIds.has(role.groupId))
  if (ungrouped.length > 0) {
    options.push({ type: 'subheader', title: 'Other' })
    for (const role of ungrouped) {
      options.push({ title: role.name, value: role.id })
    }
  }
  return options
}
