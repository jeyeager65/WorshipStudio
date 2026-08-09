/**
 * Field-level diff between two versions of the same conflicted item — only fields that
 * actually differ are worth calling out (feature-spec.md's Sync section), so this returns
 * every field present on either side, each flagged as changed or not, rather than a diff
 * algorithm that tries to omit unchanged rows (the caller decides how to render "changed").
 */
export interface DiffedField {
  key: string
  changed: boolean
  thisValue: unknown
  otherValue: unknown
}

// Already surfaced separately (as the version's device/timestamp header) — repeating them as
// plain diff rows would be redundant and, for id, is never a meaningful "difference" anyway.
const OMITTED_FIELDS = new Set(['id', 'updatedAt', 'updatedByDevice'])

export function diffFields(
  thisVersion: Record<string, unknown>,
  otherVersion: Record<string, unknown>,
): DiffedField[] {
  const keys = new Set([...Object.keys(thisVersion), ...Object.keys(otherVersion)])
  const fields: DiffedField[] = []
  for (const key of [...keys].sort()) {
    if (OMITTED_FIELDS.has(key)) continue
    const thisValue = thisVersion[key]
    const otherValue = otherVersion[key]
    fields.push({
      key,
      changed: JSON.stringify(thisValue) !== JSON.stringify(otherValue),
      thisValue,
      otherValue,
    })
  }
  return fields
}
