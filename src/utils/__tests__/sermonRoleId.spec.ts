import { describe, expect, it } from 'vitest'
import { sermonRoleId } from '@/utils/sermonInfo'
import type { ServiceTemplate, ServiceTemplateItem } from '@/models/service'

function template(id: string, items: Partial<ServiceTemplateItem>[]): ServiceTemplate {
  return {
    id,
    name: id,
    items: items.map((item, index) => ({
      id: `${id}-item-${index}`,
      kind: 'other',
      label: 'Item',
      ...item,
    })) as ServiceTemplateItem[],
    updatedAt: '',
    updatedByDevice: '',
  } as ServiceTemplate
}

describe('sermonRoleId', () => {
  it('uses the selected template’s sermon role', () => {
    const templates = [
      template('a', [{ kind: 'sermon', roleId: 'role-preaching' }]),
      template('b', [{ kind: 'sermon', roleId: 'role-other' }]),
    ]
    expect(sermonRoleId(templates, 'a')).toBe('role-preaching')
    expect(sermonRoleId(templates, 'b')).toBe('role-other')
  })

  it('falls back to the shared sermon role when no template is selected', () => {
    const templates = [
      template('a', [{ kind: 'sermon', roleId: 'role-preaching' }]),
      template('b', [{ kind: 'sermon', roleId: 'role-preaching' }]),
    ]
    expect(sermonRoleId(templates, undefined)).toBe('role-preaching')
  })

  it('falls back when the selected template has a sermon item with no role', () => {
    const templates = [
      template('a', [{ kind: 'sermon' }]),
      template('b', [{ kind: 'sermon', roleId: 'role-preaching' }]),
    ]
    expect(sermonRoleId(templates, 'a')).toBe('role-preaching')
  })

  it('gives up rather than guessing when templates disagree', () => {
    const templates = [
      template('a', [{ kind: 'sermon', roleId: 'role-preaching' }]),
      template('b', [{ kind: 'sermon', roleId: 'role-teaching' }]),
    ]
    expect(sermonRoleId(templates, undefined)).toBeUndefined()
  })

  it('returns undefined when no template defines a sermon role at all', () => {
    expect(sermonRoleId([template('a', [{ kind: 'song' }])], 'a')).toBeUndefined()
    expect(sermonRoleId([], undefined)).toBeUndefined()
  })

  it('ignores a role on a non-sermon item', () => {
    const templates = [
      template('a', [
        { kind: 'role-only', roleId: 'role-greeter' },
        { kind: 'song', roleId: 'role-vocals' },
      ]),
    ]
    expect(sermonRoleId(templates, 'a')).toBeUndefined()
  })

  it('survives a selected id that matches no template', () => {
    const templates = [template('a', [{ kind: 'sermon', roleId: 'role-preaching' }])]
    expect(sermonRoleId(templates, 'gone')).toBe('role-preaching')
  })
})
