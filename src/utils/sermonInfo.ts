import type { Service, ServiceItem, ServiceTemplate } from '@/models/service'
import { defaultServiceTemplate } from '@/utils/serviceTemplate'

export type SermonItem = Extract<ServiceItem, { type: 'sermon' }>

/** The sermon `ServiceItem` is the sole source of truth for a service's sermon — there is no
 *  separate service-level title/passage/preacher any more. */
export function findSermonItem(service: Service): SermonItem | undefined {
  return service.items.find((item): item is SermonItem => item.type === 'sermon')
}

/** Same "main passage wins" resolution used everywhere a sermon's passage is shown (Service
 *  Order list, Order of Worship, cards, Planning Ahead). */
export function sermonMainReference(item: SermonItem): string {
  const mainPassage = item.passages.find((p) => p.id === item.mainPassageId)
  return mainPassage?.reference ?? ''
}

/** The sermon's preacher is resolved the same way as every other item's "who" — a role name
 *  pointing into `service.assignments` — rather than a direct Person id of its own. */
export function sermonPreacherId(service: Service, sermonItem = findSermonItem(service)): string | undefined {
  if (!sermonItem?.role) return undefined
  return service.assignments?.find((a) => a.role === sermonItem.role)?.personId
}

/** Whatever role a church's ServiceTemplate assigns to this service type's sermon row, if any —
 *  the same role-resolution priority used by the Rust migration for pre-existing services
 *  (existing item/placeholder role wins first; this is only the fallback). */
export function defaultSermonRole(serviceTemplates: ServiceTemplate[] | undefined, serviceType: string): string | undefined {
  return defaultServiceTemplate(serviceTemplates, serviceType)?.items.find((i) => i.kind === 'sermon')?.role
}

export interface SermonEditInput {
  title: string
  /** Sets/updates (or, if blank, removes) only the *main* passage — never touches any other
   *  passage already entered on this item (e.g. via the fuller Add Sermon form), since this is a
   *  single quick-glance field, not the full passage list editor. */
  passageReference: string
  preacherId: string | undefined
}

/** Finds (or creates) the service's sermon item and folds in a quick edit from the Service
 *  Details / Create Service screens' single title/passage/preacher fields — the same 3 fields
 *  that used to live on Service itself, just backed by the item now. Mutates `service` in place,
 *  matching every other in-place edit in ServiceWorkspaceView.vue. */
export function applySermonEdit(
  service: Service,
  input: SermonEditInput,
  defaultRole: string | undefined,
  defaultTranslationCode: string,
): void {
  const existingIndex = service.items.findIndex((i) => i.type === 'sermon')
  const placeholderIndex =
    existingIndex === -1 ? service.items.findIndex((i) => i.type === 'placeholder' && i.suggestedTab === 'sermon') : -1

  let index = existingIndex
  if (index === -1 && placeholderIndex !== -1) {
    const placeholder = service.items[placeholderIndex]
    service.items.splice(placeholderIndex, 1, {
      id: placeholder.id,
      type: 'sermon',
      passages: [],
      mainPassageId: '',
      outline: [],
      role: placeholder.role,
      bulletinLabel: placeholder.bulletinLabel,
      bulletinNote: placeholder.bulletinNote,
    })
    index = placeholderIndex
  } else if (index === -1) {
    service.items.push({
      id: `item-${crypto.randomUUID()}`,
      type: 'sermon',
      passages: [],
      mainPassageId: '',
      outline: [],
    })
    index = service.items.length - 1
  }

  const item = service.items[index]
  if (item.type !== 'sermon') return

  item.title = input.title || undefined

  if (input.passageReference) {
    const mainPassage = item.passages.find((p) => p.id === item.mainPassageId)
    if (mainPassage) {
      mainPassage.reference = input.passageReference
    } else {
      const passageId = `passage-${crypto.randomUUID()}`
      item.passages.push({ id: passageId, reference: input.passageReference, translation: defaultTranslationCode, displayMode: 'full' })
      item.mainPassageId = passageId
    }
    item.presentMainPassage = true
  } else {
    // Clearing the field removes just the main passage (symmetric with title clearing to
    // undefined above) — any other passages already entered via the fuller Add Sermon form or
    // detail panel are untouched and remain supporting passages in the sermon flow.
    const mainPassageIndex = item.passages.findIndex((p) => p.id === item.mainPassageId)
    if (mainPassageIndex !== -1) {
      item.passages.splice(mainPassageIndex, 1)
    }
    item.mainPassageId = ''
    item.presentMainPassage = false
  }

  const role = item.role ?? defaultRole
  if (role) {
    item.role = role
    const assignments = service.assignments ?? (service.assignments = [])
    const existingAssignment = assignments.find((a) => a.role === role)
    if (existingAssignment) {
      existingAssignment.personId = input.preacherId
    } else {
      assignments.push({ role, personId: input.preacherId, tentative: false })
    }
  }
}
