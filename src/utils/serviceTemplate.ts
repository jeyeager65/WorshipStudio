import type { RoleAssignment, ServiceItem, ServiceTemplate, ServiceTemplateItem } from '@/models/service'

// Pre-selects the right Add-to-Service tab when a placeholder is replaced — 'other' has no
// single best tab, so it's left unmapped (falls back to whatever the dialog defaults to).
const SUGGESTED_TAB_BY_KIND: Partial<Record<ServiceTemplateItem['kind'], string>> = {
  song: 'songs',
  scripture: 'scripture',
  slide: 'slides',
  media: 'media',
  sermon: 'sermon',
}

/**
 * Expands a ServiceTemplate into the items/assignments a new service should start with:
 * - 'role-only' seeds only RoleAssignment rows (no line in the order of service, e.g. "2 Greeters").
 * - 'bulletin-note' is fully specifiable from label/note alone, so it inserts a real, complete
 *   bulletin-note item.
 * - every other kind needs something specific picked/typed later, so it inserts a placeholder
 *   item instead, replaced in place once filled in.
 * Order follows the template's own item order.
 */
export function applyServiceTemplate(template: ServiceTemplate): { items: ServiceItem[]; assignments: RoleAssignment[] } {
  const items: ServiceItem[] = []
  const assignments: RoleAssignment[] = []

  for (const templateItem of template.items) {
    if (templateItem.kind === 'role-only') {
      if (!templateItem.role) continue
      const count = templateItem.count ?? 1
      for (let i = 0; i < count; i++) {
        assignments.push({ role: templateItem.role, tentative: false })
      }
      continue
    }

    if (templateItem.role) {
      assignments.push({ role: templateItem.role, tentative: false })
    }

    if (templateItem.kind === 'bulletin-note') {
      items.push({
        id: `item-${crypto.randomUUID()}`,
        type: 'bulletin-note',
        role: templateItem.role,
        bulletinLabel: templateItem.label,
        bulletinNote: templateItem.note,
      })
    } else {
      items.push({
        id: `item-${crypto.randomUUID()}`,
        type: 'placeholder',
        label: templateItem.label,
        suggestedTab: SUGGESTED_TAB_BY_KIND[templateItem.kind],
        role: templateItem.role,
      })
    }
  }

  return { items, assignments }
}
