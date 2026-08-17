import { describe, expect, it } from 'vitest'
import { findRoleConflicts, isDateUnavailable } from '@/utils/rosterConflicts'
import type { RoleAssignment } from '@/models/service'

function assignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return { roleId: 'Vocals', personId: 'person-1', tentative: false, ...overrides }
}

describe('findRoleConflicts', () => {
  it('flags a person assigned to two distinct roles', () => {
    const assignments = [
      assignment({ roleId: 'Vocals', personId: 'ashley' }),
      assignment({ roleId: 'Nursery', personId: 'ashley' }),
    ]
    const conflicts = findRoleConflicts(assignments)
    expect(conflicts).toEqual([{ personId: 'ashley', roleIds: ['Vocals', 'Nursery'] }])
  })

  it('does not flag the same person twice in the same role', () => {
    const assignments = [
      assignment({ roleId: 'Greeters', personId: 'tom' }),
      assignment({ roleId: 'Greeters', personId: 'tom' }),
    ]
    expect(findRoleConflicts(assignments)).toEqual([])
  })

  it('does not flag different people in different roles', () => {
    const assignments = [
      assignment({ roleId: 'Piano', personId: 'marlene' }),
      assignment({ roleId: 'Drums', personId: 'mark' }),
    ]
    expect(findRoleConflicts(assignments)).toEqual([])
  })

  it('ignores unfilled roles', () => {
    expect(findRoleConflicts([assignment({ roleId: 'Piano', personId: undefined })])).toEqual([])
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
