export interface EmailDraft {
  to: string[]
  subject: string
  body: string
}

export interface AssignmentEmailGroup {
  name: string
  roles: string[]
}

export interface AssignmentEmailEntry {
  role: string
  personName?: string
  tentative?: boolean
}

/** Builds an honest mail-client handoff. Worship Studio composes the draft; the configured
 * desktop mail application remains responsible for the account, review, and delivery. */
export function mailtoUrl(draft: EmailDraft): string {
  const query = new URLSearchParams()
  if (draft.subject) query.set('subject', draft.subject)
  if (draft.body) query.set('body', draft.body)
  const recipients = draft.to.map((address) => encodeURIComponent(address)).join(',')
  const encoded = query.toString().replaceAll('+', '%20')
  return `mailto:${recipients}${encoded ? `?${encoded}` : ''}`
}

/** Plain-text fallback containing everything needed to recreate the draft manually. */
export function emailDraftText(draft: EmailDraft): string {
  const lines = []
  if (draft.to.length) lines.push(`To: ${draft.to.join(', ')}`)
  if (draft.subject) lines.push(`Subject: ${draft.subject}`)
  if (lines.length && draft.body) lines.push('')
  if (draft.body) lines.push(draft.body)
  return lines.join('\n')
}

export function uniqueEmailAddresses(addresses: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const address of addresses) {
    const trimmed = address?.trim()
    if (!trimmed) continue
    const key = trimmed.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** Formats a plain-text roster with category and role headings so category names are not
 * repeated for every assignment. */
export function assignmentEmailRosterLines(
  groups: AssignmentEmailGroup[],
  assignments: AssignmentEmailEntry[],
): string[] {
  return groups.flatMap((group, groupIndex) => [
    group.name,
    ...group.roles.map((role) => {
      const people = assignments
        .filter((assignment) => assignment.role === role)
        .map(
          (assignment) =>
            `${assignment.personName || '(unassigned)'}${assignment.tentative ? ' (tentative)' : ''}`,
        )
      return `• ${role}: ${people.join(', ') || '(unassigned)'}`
    }),
    ...(groupIndex < groups.length - 1 ? [''] : []),
  ])
}
