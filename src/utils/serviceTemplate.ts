import type {
  RoleAssignment,
  Service,
  ServiceItem,
  ServiceTemplate,
  ServiceTemplateItem,
} from '@/models/service'

// Pre-selects the right Add-to-Service tab when a placeholder is replaced — 'other' has no
// single best tab, so it's left unmapped (falls back to whatever the dialog defaults to).
const SUGGESTED_TAB_BY_KIND: Partial<Record<ServiceTemplateItem['kind'], string>> = {
  song: 'songs',
  scripture: 'scripture',
  slide: 'slides',
  media: 'media',
  sermon: 'sermon',
}

/** Resolves the configured default while keeping pre-association libraries compatible. An
 * explicit association wins; only templates without the new field use the historical
 * same-name behavior. */
export function defaultServiceTemplate(
  templates: ServiceTemplate[] | undefined,
  serviceType: string,
): ServiceTemplate | undefined {
  return (
    templates?.find((template) => template.defaultForServiceTypes?.includes(serviceType)) ??
    templates?.find(
      (template) =>
        template.defaultForServiceTypes === undefined && template.serviceType === serviceType,
    )
  )
}

/**
 * Expands a ServiceTemplate into the items/assignments a new service should start with:
 * - 'role-only' seeds only RoleAssignment rows (no line in the order of service, e.g. "2 Greeters").
 * - 'bulletin-note' is fully specifiable from label/note alone, so it inserts a real, complete
 *   bulletin-note item.
 * - every other kind needs something specific picked/typed later, so it inserts a placeholder
 *   item instead, carrying its bulletin label/note forward when replaced in place.
 * Order follows the template's own item order.
 */
export function applyServiceTemplate(template: ServiceTemplate): {
  items: ServiceItem[]
  assignments: RoleAssignment[]
} {
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
        bulletinNote: templateItem.note,
      })
    }
  }

  return { items, assignments }
}

export interface AssignmentResetPlan {
  toAdd: RoleAssignment[]
  toRemove: RoleAssignment[]
}

/**
 * Diffs a service's existing assignments against a template's 'role-only' items (e.g. "2
 * Greeters"), so an operator who edits a template after already creating services in advance
 * can bring those older services' staffing back in sync without re-creating them.
 *
 * Deliberately scoped to 'role-only' items — roles tied to an actual service item (e.g. the
 * sermon's Preacher) are already governed by that item's own presence/content, not the
 * template, so they and their assignments are left untouched no matter what the template says.
 */
export function planAssignmentResetFromTemplate(
  service: Pick<Service, 'items' | 'assignments'>,
  template: ServiceTemplate,
): AssignmentResetPlan {
  const itemRoles = new Set(
    service.items.map((item) => item.role).filter((role): role is string => !!role),
  )

  const desiredCounts = new Map<string, number>()
  for (const templateItem of template.items) {
    if (templateItem.kind !== 'role-only' || !templateItem.role) continue
    desiredCounts.set(
      templateItem.role,
      (desiredCounts.get(templateItem.role) ?? 0) + (templateItem.count ?? 1),
    )
  }

  const existingByRole = new Map<string, RoleAssignment[]>()
  for (const assignment of service.assignments ?? []) {
    if (itemRoles.has(assignment.role)) continue
    const list = existingByRole.get(assignment.role) ?? []
    list.push(assignment)
    existingByRole.set(assignment.role, list)
  }

  const toAdd: RoleAssignment[] = []
  const toRemove: RoleAssignment[] = []
  for (const role of new Set([...desiredCounts.keys(), ...existingByRole.keys()])) {
    const existing = existingByRole.get(role) ?? []
    const desired = desiredCounts.get(role) ?? 0
    if (existing.length < desired) {
      for (let i = existing.length; i < desired; i++) toAdd.push({ role, tentative: false })
    } else if (existing.length > desired) {
      // Unassigned rows are trimmed before assigned ones, so a person already picked for a
      // role is the last thing dropped when a template's count shrinks.
      const byAssignedLast = [...existing].sort(
        (a, b) => Number(!!a.personId) - Number(!!b.personId),
      )
      toRemove.push(...byAssignedLast.slice(0, existing.length - desired))
    }
  }
  return { toAdd, toRemove }
}
