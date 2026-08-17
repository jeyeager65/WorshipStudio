import type { Person } from '@/models/library'
import { personDisplayName } from '@/models/library'

export interface PersonOption {
  /** Present only for a non-selectable section header (Vuetify's v-select/v-autocomplete
   *  subheader convention — see ItemRoleOption elsewhere for the same shape). */
  type?: 'subheader'
  title: string
  value?: string
}

/** People who prefer `roleId` surface first (alphabetically among themselves), then everyone
 *  else (also alphabetically), under "Preferred"/"Everyone Else" section headers — used by both
 *  the Assignments page and a service item's own inline "Assigned" picker so the likely picks
 *  are easy to find, and *why* the list is ordered that way is obvious rather than looking
 *  random. */
export function personOptionsForRole(
  people: Person[],
  roleId: string | undefined,
): PersonOption[] {
  const preferred: PersonOption[] = []
  const rest: PersonOption[] = []
  for (const person of people) {
    const option: PersonOption = { title: personDisplayName(person), value: person.id }
    ;(roleId && person.preferredRoleIds.includes(roleId) ? preferred : rest).push(option)
  }
  const byTitle = (a: PersonOption, b: PersonOption) => a.title.localeCompare(b.title)
  preferred.sort(byTitle)
  rest.sort(byTitle)

  // Headers only earn their keep when there's an actual split to explain — no role, nobody
  // preferring it, or everybody preferring it all collapse back to one flat list rather than a
  // single redundant header.
  if (!roleId || preferred.length === 0 || rest.length === 0) {
    return [...preferred, ...rest]
  }
  return [
    { type: 'subheader', title: 'Preferred' },
    ...preferred,
    { type: 'subheader', title: 'Everyone Else' },
    ...rest,
  ]
}
