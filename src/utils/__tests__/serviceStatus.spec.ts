import { describe, expect, it } from 'vitest'
import { isServiceIncomplete } from '@/utils/serviceStatus'
import type { Service } from '@/models/service'

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-08-02',
    serviceTypeId: 'type-sunday-worship',
    items: [],
    assignments: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('isServiceIncomplete', () => {
  it('is false for a service with no items or assignments', () => {
    expect(isServiceIncomplete(service())).toBe(false)
  })

  it('is false when all assignments have a person', () => {
    const result = isServiceIncomplete(
      service({
        items: [{ id: 'item-1', type: 'bulletin-note' }],
        assignments: [{ roleId: 'Worship Leader', personId: 'person-1', tentative: false }],
      }),
    )
    expect(result).toBe(false)
  })

  it('is true when an item is an unfilled placeholder', () => {
    const result = isServiceIncomplete(
      service({ items: [{ id: 'item-1', type: 'placeholder', label: 'Sermon' }] }),
    )
    expect(result).toBe(true)
  })

  it('is true when a role has no person assigned', () => {
    const result = isServiceIncomplete(
      service({ assignments: [{ roleId: 'Worship Leader', personId: undefined, tentative: false }] }),
    )
    expect(result).toBe(true)
  })

  it('handles a missing assignments array', () => {
    const withoutAssignments = service()
    delete (withoutAssignments as Partial<Service>).assignments
    expect(isServiceIncomplete(withoutAssignments)).toBe(false)
  })
})
