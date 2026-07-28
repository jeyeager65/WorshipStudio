import type { RoleAssignment } from '@/models/service'
import type { UnavailableDateRange } from '@/models/library'

export interface RoleConflict {
  personId: string
  roles: string[]
}

/**
 * Flags a person assigned to more than one *distinct* role within the same roster (e.g.
 * Ashley on both Vocals and Nursery the same Sunday) — the same person filling one role with
 * several people (or one person split across an intro/outro of the same role) isn't a
 * conflict, only genuinely being needed in two places at once is.
 */
export function findRoleConflicts(assignments: RoleAssignment[]): RoleConflict[] {
  const rolesByPerson = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    if (!assignment.personId) continue
    const roles = rolesByPerson.get(assignment.personId) ?? new Set<string>()
    roles.add(assignment.role)
    rolesByPerson.set(assignment.personId, roles)
  }
  return [...rolesByPerson.entries()]
    .filter(([, roles]) => roles.size > 1)
    .map(([personId, roles]) => ({ personId, roles: [...roles] }))
}

/** Whether `date` (ISO yyyy-mm-dd) falls within any of a person's unavailable ranges. */
export function isDateUnavailable(date: string, ranges: UnavailableDateRange[]): boolean {
  return ranges.some((range) => date >= range.start && date <= range.end)
}
