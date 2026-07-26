import type { RoleAssignment } from '@/models/service'
import type { UnavailableDateRange } from '@/models/library'

export interface RoleConflict {
  volunteerId: string
  roles: string[]
}

/**
 * Flags a volunteer assigned to more than one *distinct* role within the same roster (e.g.
 * Ashley on both Vocals and Nursery the same Sunday) — the same person filling one role with
 * several people (or one person split across an intro/outro of the same role) isn't a
 * conflict, only genuinely being needed in two places at once is.
 */
export function findRoleConflicts(assignments: RoleAssignment[]): RoleConflict[] {
  const rolesByVolunteer = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    if (!assignment.volunteerId) continue
    const roles = rolesByVolunteer.get(assignment.volunteerId) ?? new Set<string>()
    roles.add(assignment.role)
    rolesByVolunteer.set(assignment.volunteerId, roles)
  }
  return [...rolesByVolunteer.entries()]
    .filter(([, roles]) => roles.size > 1)
    .map(([volunteerId, roles]) => ({ volunteerId, roles: [...roles] }))
}

/** Whether `date` (ISO yyyy-mm-dd) falls within any of a volunteer's unavailable ranges. */
export function isDateUnavailable(date: string, ranges: UnavailableDateRange[]): boolean {
  return ranges.some((range) => date >= range.start && date <= range.end)
}
