import { describe, expect, it } from 'vitest'
import { diffFields } from '@/utils/conflictDiff'

describe('diffFields', () => {
  it('flags fields whose values differ', () => {
    const fields = diffFields({ key: 'A', arrangement: ['v1'] }, { key: 'G', arrangement: ['v1'] })
    const key = fields.find((f) => f.key === 'key')
    const arrangement = fields.find((f) => f.key === 'arrangement')
    expect(key?.changed).toBe(true)
    expect(arrangement?.changed).toBe(false)
  })

  it('includes a field present on only one side', () => {
    const fields = diffFields({ sermonTitle: 'Our Lord’s Prayer' }, {})
    const field = fields.find((f) => f.key === 'sermonTitle')
    expect(field?.changed).toBe(true)
    expect(field?.otherValue).toBeUndefined()
  })

  it('omits id/updatedAt/updatedByDevice — already shown as the version header', () => {
    const fields = diffFields(
      { id: 'song-1', updatedAt: 'a', updatedByDevice: 'This Computer', title: 'Same' },
      { id: 'song-1', updatedAt: 'b', updatedByDevice: 'Pastors Mac', title: 'Same' },
    )
    expect(fields.map((f) => f.key)).toEqual(['title'])
  })

  it('returns fields sorted by key', () => {
    const fields = diffFields({ zeta: 1, alpha: 2 }, {})
    expect(fields.map((f) => f.key)).toEqual(['alpha', 'zeta'])
  })
})
