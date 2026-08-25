import type { Service, ServiceItem, ServiceTemplate } from '@/models/service'
import { defaultServiceTemplate } from '@/utils/serviceTemplate'

export type SermonItem = Extract<ServiceItem, { type: 'sermon' }>

/** The sermon `ServiceItem` is the sole source of truth for a service's sermon — there is no
 *  separate service-level title/passage/preacher any more. */
export function findSermonItem(service: Service): SermonItem | undefined {
  return service.items.find((item): item is SermonItem => item.type === 'sermon')
}

/** Same main-passage resolution used everywhere a sermon's passage is shown (Service Order,
 *  Order of Worship, service cards, and the service plan). */
export function sermonMainReference(item: SermonItem): string {
  const mainPassage = item.passages.find((p) => p.id === item.mainPassageId)
  return mainPassage?.reference ?? ''
}

/** The sermon's preacher is resolved the same way as every other item's "who" — a RoleDefinition
 *  id pointing into `service.assignments` — rather than a direct Person id of its own. */
export function sermonPreacherId(
  service: Service,
  sermonItem = findSermonItem(service),
): string | undefined {
  if (!sermonItem?.roleId) return undefined
  return service.assignments?.find((a) => a.roleId === sermonItem.roleId)?.personId
}

/** Whatever role a church's ServiceTemplate assigns to this service type's sermon row, if any —
 *  existing item/placeholder role wins first; this is only the fallback. */
export function defaultSermonRole(
  serviceTemplates: ServiceTemplate[] | undefined,
  serviceType: string,
): string | undefined {
  return defaultServiceTemplate(serviceTemplates, serviceType)?.items.find(
    (i) => i.kind === 'sermon',
  )?.roleId
}

/** The role to group a Preacher picker by — a near neighbour of defaultSermonRole above, but
 *  answering a different question. That one asks "which role should this sermon's *assignment*
 *  use", keyed on the service type's default template. This one asks "which role are the likely
 *  preachers preferred for", keyed on the template actually selected — so overriding the default
 *  template on the Create Service screen regroups the list, which the service-type lookup would
 *  ignore.
 *
 *  A preacher has no direct tie to a role: the sermon ServiceItem carries a title and passages,
 *  not a roleId. A template's own `kind: 'sermon'` item is the closest configured answer, and is
 *  already what applySermonEdit records the assignment against.
 *
 *  Falls back to the sermon role used across all templates when the selected one can't answer
 *  (nothing selected yet, or its sermon item never had a role set) — but only when the templates
 *  agree on a single role. Disagreement means there's no one right answer, and guessing would put
 *  the wrong people under "Preferred", which is worse than leaving the list flat.
 *
 *  Returns undefined when nothing can be determined; personOptionsForRole then renders one plain
 *  alphabetical list. Deliberately not a hardcoded role name — the previous implementation looked
 *  up the literal id 'Preacher', which stopped matching anything once roles moved to generated
 *  ids (and named a role this library no longer configures), silently leaving the picker in raw
 *  file order with neither sorting nor grouping. */
export function sermonRoleId(
  serviceTemplates: ServiceTemplate[],
  selectedTemplateId?: string,
): string | undefined {
  if (selectedTemplateId) {
    const selected = serviceTemplates.find((template) => template.id === selectedTemplateId)
    const roleId = selected?.items.find((item) => item.kind === 'sermon' && item.roleId)?.roleId
    if (roleId) return roleId
  }

  const distinct = new Set<string>()
  for (const template of serviceTemplates) {
    for (const item of template.items) {
      if (item.kind === 'sermon' && item.roleId) distinct.add(item.roleId)
    }
  }
  return distinct.size === 1 ? [...distinct][0] : undefined
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
  defaultRoleId: string | undefined,
  defaultTranslationCode: string,
): void {
  const existingIndex = service.items.findIndex((i) => i.type === 'sermon')
  const placeholderIndex =
    existingIndex === -1
      ? service.items.findIndex((i) => i.type === 'placeholder' && i.suggestedTab === 'sermon')
      : -1

  let index = existingIndex
  if (index === -1 && placeholderIndex !== -1) {
    const placeholder = service.items[placeholderIndex]
    service.items.splice(placeholderIndex, 1, {
      id: placeholder.id,
      type: 'sermon',
      passages: [],
      mainPassageId: '',
      outline: [],
      roleId: placeholder.roleId,
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
      item.passages.push({
        id: passageId,
        reference: input.passageReference,
        translation: defaultTranslationCode,
        displayMode: 'full',
      })
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

  const roleId = item.roleId ?? defaultRoleId
  if (roleId) {
    item.roleId = roleId
    const assignments = service.assignments ?? (service.assignments = [])
    const existingAssignment = assignments.find((a) => a.roleId === roleId)
    if (existingAssignment) {
      existingAssignment.personId = input.preacherId
    } else {
      assignments.push({ roleId, personId: input.preacherId, tentative: false })
    }
  }
}
