import { describe, expect, it } from 'vitest'
import { applyServiceTemplate } from '@/utils/serviceTemplate'
import type { ServiceTemplate } from '@/models/service'

describe('applyServiceTemplate', () => {
  it("seeds only assignments for a 'role-only' entry, no order-of-service item", () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Greeter', role: 'Greeter', count: 2 }],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toEqual([])
    expect(assignments).toEqual([
      { role: 'Greeter', tentative: false },
      { role: 'Greeter', tentative: false },
    ])
  })

  it("defaults a 'role-only' entry's count to 1 when unset", () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [{ id: 't1', kind: 'role-only', label: 'Announcer', role: 'Announcer' }],
    }
    const { assignments } = applyServiceTemplate(template)
    expect(assignments).toEqual([{ role: 'Announcer', tentative: false }])
  })

  it("inserts a real bulletin-note item (and its role's assignment) for a 'bulletin-note' entry", () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [
        {
          id: 't1',
          kind: 'bulletin-note',
          label: 'Silent Preparation',
          note: '(please silence your phone)',
          role: 'Prayer',
        },
      ],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toMatchObject([
      { type: 'bulletin-note', role: 'Prayer', bulletinLabel: 'Silent Preparation', bulletinNote: '(please silence your phone)' },
    ])
    expect(assignments).toEqual([{ role: 'Prayer', tentative: false }])
  })

  it('inserts a placeholder item (with a suggested tab and role) for every other kind', () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'song', label: 'Opening Song' },
        { id: 't2', kind: 'scripture', label: 'Scripture Reading', role: 'Scripture Reader' },
        { id: 't3', kind: 'sermon', label: 'Sermon' },
        { id: 't4', kind: 'other', label: 'Special Music' },
      ],
    }
    const { items, assignments } = applyServiceTemplate(template)
    expect(items).toMatchObject([
      { type: 'placeholder', label: 'Opening Song', suggestedTab: 'songs' },
      { type: 'placeholder', label: 'Scripture Reading', suggestedTab: 'scripture', role: 'Scripture Reader' },
      { type: 'placeholder', label: 'Sermon', suggestedTab: 'sermon' },
      { type: 'placeholder', label: 'Special Music', suggestedTab: undefined },
    ])
    expect(assignments).toEqual([{ role: 'Scripture Reader', tentative: false }])
  })

  it('preserves the template item order in the seeded items', () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'bulletin-note', label: 'Welcome and Announcements' },
        { id: 't2', kind: 'song', label: 'Opening Song' },
        { id: 't3', kind: 'bulletin-note', label: 'Silent Reflection' },
      ],
    }
    const { items } = applyServiceTemplate(template)
    expect(items.map((item) => item.bulletinLabel ?? ('label' in item ? item.label : undefined))).toEqual([
      'Welcome and Announcements',
      'Opening Song',
      'Silent Reflection',
    ])
  })

  it('gives every seeded item a unique id', () => {
    const template: ServiceTemplate = {
      serviceType: 'Sunday Morning Worship',
      items: [
        { id: 't1', kind: 'song', label: 'Opening Song' },
        { id: 't2', kind: 'bulletin-note', label: 'Closing Prayer' },
      ],
    }
    const { items } = applyServiceTemplate(template)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })
})
