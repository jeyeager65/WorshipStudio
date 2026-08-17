import { describe, expect, it } from 'vitest'
import {
  applyServiceTemplate,
  defaultServiceTemplate,
  planAssignmentResetFromTemplate,
} from '@/utils/serviceTemplate'
import type { Service, ServiceTemplate } from '@/models/service'

describe('defaultServiceTemplate', () => {
  it('returns the template whose defaultForServiceTypeIds includes the given service type id', () => {
    const templates: ServiceTemplate[] = [
      { id: 'template-sunday', name: 'Sunday Worship', items: [] },
      {
        id: 'template-communion',
        name: 'Communion',
        defaultForServiceTypeIds: ['type-sunday'],
        items: [],
      },
    ]
    expect(defaultServiceTemplate(templates, 'type-sunday')?.name).toBe('Communion')
  })

  it('returns undefined when no template defaults to this service type id', () => {
    const templates: ServiceTemplate[] = [
      { id: 'template-sunday', name: 'Sunday Worship', items: [] },
    ]
    expect(defaultServiceTemplate(templates, 'type-sunday')).toBeUndefined()
  })

  it('honors an explicit empty association', () => {
    const templates: ServiceTemplate[] = [
      { id: 'template-sunday', name: 'Sunday Worship', defaultForServiceTypeIds: [], items: [] },
    ]
    expect(defaultServiceTemplate(templates, 'type-sunday')).toBeUndefined()
  })
})

describe('applyServiceTemplate', () => {
  it("seeds only assignments for a 'role-only' entry, no order-of-service item", () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Greeter', roleId: 'Greeter', count: 2 }],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toEqual([])
    expect(assignments).toEqual([
      { roleId: 'Greeter', tentative: false },
      { roleId: 'Greeter', tentative: false },
    ])
  })

  it("defaults a 'role-only' entry's count to 1 when unset", () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Announcer', roleId: 'Announcer' }],
    }
    const { assignments } = applyServiceTemplate(template)
    expect(assignments).toEqual([{ roleId: 'Announcer', tentative: false }])
  })

  it("inserts a real bulletin-note item (and its role's assignment) for a 'bulletin-note' entry", () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [
        {
          id: 't1',
          kind: 'bulletin-note',
          label: 'Silent Preparation',
          note: '(please silence your phone)',
          roleId: 'Prayer',
        },
      ],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toMatchObject([
      {
        type: 'bulletin-note',
        roleId: 'Prayer',
        bulletinLabel: 'Silent Preparation',
        bulletinNote: '(please silence your phone)',
      },
    ])
    expect(assignments).toEqual([{ roleId: 'Prayer', tentative: false }])
  })

  it('inserts a placeholder item with its suggested tab, role, and bulletin note for every other kind', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'song', label: 'Opening Song', note: '(please stand)' },
        { id: 't2', kind: 'scripture', label: 'Scripture Reading', roleId: 'Scripture Reader' },
        { id: 't3', kind: 'sermon', label: 'Sermon' },
        { id: 't4', kind: 'other', label: 'Special Music' },
      ],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toMatchObject([
      {
        type: 'placeholder',
        label: 'Opening Song',
        suggestedTab: 'songs',
        bulletinNote: '(please stand)',
      },
      {
        type: 'placeholder',
        label: 'Scripture Reading',
        suggestedTab: 'scripture',
        roleId: 'Scripture Reader',
      },
      { type: 'placeholder', label: 'Sermon', suggestedTab: 'sermon' },
      { type: 'placeholder', label: 'Special Music', suggestedTab: undefined },
    ])
    expect(assignments).toEqual([{ roleId: 'Scripture Reader', tentative: false }])
  })

  it('preserves the template item order in the seeded items', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'bulletin-note', label: 'Welcome and Announcements' },
        { id: 't2', kind: 'song', label: 'Opening Song' },
        { id: 't3', kind: 'bulletin-note', label: 'Silent Reflection' },
      ],
    }
    const { items } = applyServiceTemplate(template)
    expect(
      items.map((item) => item.bulletinLabel ?? ('label' in item ? item.label : undefined)),
    ).toEqual(['Welcome and Announcements', 'Opening Song', 'Silent Reflection'])
  })

  it('gives every seeded item a unique id', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'song', label: 'Opening Song' },
        { id: 't2', kind: 'bulletin-note', label: 'Closing Prayer' },
      ],
    }
    const { items } = applyServiceTemplate(template)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })
})

describe('planAssignmentResetFromTemplate', () => {
  function service(
    overrides: Partial<Pick<Service, 'items' | 'assignments'>> = {},
  ): Pick<Service, 'items' | 'assignments'> {
    return { items: [], assignments: [], ...overrides }
  }

  it('adds a missing role-only assignment introduced by the template', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Greeter', roleId: 'Greeter', count: 2 }],
    }
    const plan = planAssignmentResetFromTemplate(service(), template)
    expect(plan.toAdd).toEqual([
      { roleId: 'Greeter', tentative: false },
      { roleId: 'Greeter', tentative: false },
    ])
    expect(plan.toRemove).toEqual([])
  })

  it('removes a role-only assignment no longer in the template', () => {
    const template: ServiceTemplate = { id: 'template-1', name: 'Sunday Morning Worship', items: [] }
    const existing = { roleId: 'Greeter', personId: 'person-1', tentative: false }
    const plan = planAssignmentResetFromTemplate(service({ assignments: [existing] }), template)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([existing])
  })

  it('trims unassigned rows before assigned ones when a count shrinks', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Greeter', roleId: 'Greeter', count: 1 }],
    }
    const assigned = { roleId: 'Greeter', personId: 'person-1', tentative: false }
    const unassigned = { roleId: 'Greeter', tentative: false }
    const plan = planAssignmentResetFromTemplate(
      service({ assignments: [assigned, unassigned] }),
      template,
    )
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([unassigned])
  })

  it('leaves an existing role-only assignment alone when the template count already matches', () => {
    const template: ServiceTemplate = {
      id: 'template-1',
      name: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Greeter', roleId: 'Greeter', count: 1 }],
    }
    const existing = { roleId: 'Greeter', personId: 'person-1', tentative: false }
    const plan = planAssignmentResetFromTemplate(service({ assignments: [existing] }), template)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  it("never touches a role tied to an actual service item, even if the template's role-only items disagree", () => {
    const template: ServiceTemplate = { id: 'template-1', name: 'Sunday Morning Worship', items: [] }
    const preacherAssignment = { roleId: 'Preacher', personId: 'person-1', tentative: false }
    const plan = planAssignmentResetFromTemplate(
      service({
        items: [{ id: 'item-1', type: 'placeholder', label: 'Sermon', roleId: 'Preacher' }],
        assignments: [preacherAssignment],
      }),
      template,
    )
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([])
  })
})
