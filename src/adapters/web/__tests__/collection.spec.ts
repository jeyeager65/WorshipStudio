import { beforeEach, describe, expect, it } from 'vitest'
import { createFsaCollection } from '../collection'
import { createWebSettingsPort } from '../settings'
import { createFakeRoot } from './fakeFsa'

interface Widget {
  id: string
  name: string
  updatedAt: string
  updatedByDevice: string
}

beforeEach(() => {
  localStorage.clear()
})

describe('createFsaCollection', () => {
  it('lists nothing in a fresh directory', async () => {
    const root = createFakeRoot()
    const collection = createFsaCollection<Widget>(root, 'widgets', createWebSettingsPort(root))
    expect(await collection.list()).toEqual([])
  })

  it('save() stamps updatedAt/updatedByDevice and returns the stamped record', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    await settings.saveMachineSettings({
      ...(await settings.getMachineSettings()),
      thisComputerName: 'Booth Laptop',
    })
    const collection = createFsaCollection<Widget>(root, 'widgets', settings)

    const saved = await collection.save({
      id: 'w1',
      name: 'Gadget',
      updatedAt: '',
      updatedByDevice: '',
    })
    expect(saved.updatedByDevice).toBe('Booth Laptop')
    expect(saved.updatedAt).not.toBe('')

    const fetched = await collection.get('w1')
    expect(fetched?.name).toBe('Gadget')
  })

  it('get() returns undefined for a missing record', async () => {
    const root = createFakeRoot()
    const collection = createFsaCollection<Widget>(root, 'widgets', createWebSettingsPort(root))
    expect(await collection.get('missing')).toBeUndefined()
  })

  it('delete() removes the record', async () => {
    const root = createFakeRoot()
    const collection = createFsaCollection<Widget>(root, 'widgets', createWebSettingsPort(root))
    await collection.save({ id: 'w1', name: 'Gadget', updatedAt: '', updatedByDevice: '' })
    await collection.delete('w1')
    expect(await collection.get('w1')).toBeUndefined()
    expect(await collection.list()).toEqual([])
  })

  it('list() ignores .backup files', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const collection = createFsaCollection<Widget>(root, 'widgets', settings)
    await collection.save({ id: 'w1', name: 'Gadget', updatedAt: '', updatedByDevice: '' })
    // Simulate a stray .backup file some other write path left behind.
    const dir = await root.getDirectoryHandle('widgets')
    const backupHandle = await dir.getFileHandle('w1.json.backup', { create: true })
    const writable = await backupHandle.createWritable()
    await writable.write('{"id":"w1","name":"Old"}')
    await writable.close()

    const list = await collection.list()
    expect(list).toHaveLength(1)
  })
})
