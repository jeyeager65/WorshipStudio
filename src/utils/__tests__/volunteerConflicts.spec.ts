import { describe, expect, it } from 'vitest'
import { findRoleConflicts, isDateUnavailable } from '@/utils/volunteerConflicts'
import type { RoleAssignment } from '@/models/service'

function assignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return { role: 'Vocals', volunteerId: 'volunteer-1', tentative: false, ...overrides }
}

describe('findRoleConflicts', () => {
  it('flags a volunteer assigned to two distinct roles', () => {
    const assignments = [
      assignment({ role: 'Vocals', volunteerId: 'ashley' }),
      assignment({ role: 'Nursery', volunteerId: 'ashley' }),
    ]
    const conflicts = findRoleConflicts(assignments)
    expect(conflicts).toEqual([{ volunteerId: 'ashley', roles: ['Vocals', 'Nursery'] }])
  })

  it('does not flag the same volunteer twice in the same role', () => {
    const assignments = [
      assignment({ role: 'Greeters', volunteerId: 'tom' }),
      assignment({ role: 'Greeters', volunteerId: 'tom' }),
    ]
    expect(findRoleConflicts(assignments)).toEqual([])
  })

  it('does not flag different volunteers in different roles', () => {
    const assignments = [
      assignment({ role: 'Piano', volunteerId: 'marlene' }),
      assignment({ role: 'Drums', volunteerId: 'mark' }),
    ]
    expect(findRoleConflicts(assignments)).toEqual([])
  })

  it('ignores unfilled roles', () => {
    expect(findRoleConflicts([assignment({ role: 'Piano', volunteerId: undefined })])).toEqual([])
  })
})

describe('isDateUnavailable', () => {
  it('is true when the date falls within a range (inclusive)', () => {
    const ranges = [{ start: '2026-08-09', end: '2026-08-23' }]
    expect(isDateUnavailable('2026-08-09', ranges)).toBe(true)
    expect(isDateUnavailable('2026-08-16', ranges)).toBe(true)
    expect(isDateUnavailable('2026-08-23', ranges)).toBe(true)
  })

  it('is false outside every range', () => {
    const ranges = [{ start: '2026-08-09', end: '2026-08-23' }]
    expect(isDateUnavailable('2026-08-24', ranges)).toBe(false)
  })

  it('is false with no ranges', () => {
    expect(isDateUnavailable('2026-08-09', [])).toBe(false)
  })
})
