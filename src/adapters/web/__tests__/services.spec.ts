import { beforeEach, describe, expect, it } from 'vitest'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import { readJsonFile } from '../fsaStorage'
import { createWebServicesPort } from '../services'
import { createWebSettingsPort } from '../settings'
import { createWebSongsPort } from '../songs'
import { createFakeRoot } from './fakeFsa'

beforeEach(() => {
  localStorage.clear()
})

function sampleService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-08-09',
    type: 'Sunday Morning',
    items: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('createWebServicesPort', () => {
  it('saves under services/<year>/<id>.json', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)

    await port.save(sampleService())
    const direct = await readJsonFile<Service>(root, 'services/2026/service-1.json')
    expect(direct?.id).toBe('service-1')
  })

  it('get() finds a service without knowing its year in advance', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    await port.save(sampleService())

    expect((await port.get('service-1'))?.type).toBe('Sunday Morning')
    expect(await port.get('does-not-exist')).toBeUndefined()
  })

  it('moves the file to the new year folder when a service is saved with a different-year date, leaving no stale copy', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)

    await port.save(sampleService({ date: '2025-12-31' }))
    expect(await readJsonFile(root, 'services/2025/service-1.json')).not.toBeNull()

    await port.save(sampleService({ date: '2026-01-04' }))
    expect(await readJsonFile(root, 'services/2026/service-1.json')).not.toBeNull()
    expect(await readJsonFile(root, 'services/2025/service-1.json')).toBeNull()

    const listed = await port.list()
    expect(listed).toHaveLength(1)
  })

  it('delete() removes the service regardless of which year folder holds it', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    await port.save(sampleService({ date: '2026-08-09' }))

    await port.delete('service-1')
    expect(await port.get('service-1')).toBeUndefined()
    expect(await port.list()).toEqual([])
  })

  it('listUpcoming filters by an inclusive date range', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    await port.save(sampleService({ id: 'service-early', date: '2026-01-01' }))
    await port.save(sampleService({ id: 'service-mid', date: '2026-06-15' }))
    await port.save(sampleService({ id: 'service-late', date: '2026-12-31' }))

    const upcoming = await port.listUpcoming('2026-03-01', '2026-09-01')
    expect(upcoming.map((s) => s.id)).toEqual(['service-mid'])
  })

  it('recomputes song usage stats when a service referencing a song is saved', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)

    const song: Song = {
      id: 'song-1',
      title: 'Great Are You Lord',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
    }
    await songs.save(song)

    await port.save(
      sampleService({
        date: '2026-01-15',
        items: [
          {
            id: 'item-1',
            type: 'song',
            songId: 'song-1',
            arrangement: { sequence: [] },
          },
        ],
      }),
    )

    const updated = await songs.get('song-1')
    expect(updated?.usage.lastUsedAt).toBe('2026-01-15')
    expect(updated?.usage.usesPastYear).toBe(1)
  })

  it('a future-dated service does not count as a use yet', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)

    await songs.save({
      id: 'song-1',
      title: 'Great Are You Lord',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usage: { usesPastYear: 0 },
      updatedAt: '',
      updatedByDevice: '',
    })

    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 5)
    await port.save(
      sampleService({
        date: farFuture.toISOString().slice(0, 10),
        items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
      }),
    )

    const updated = await songs.get('song-1')
    expect(updated?.usage.usesPastYear).toBe(0)
    expect(updated?.usage.lastUsedAt).toBeUndefined()
  })

  it('importOpenSongSets has no browser equivalent — matches the documented always-undefined contract', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    expect(await port.importOpenSongSets(2026, 'Sunday Morning')).toBeUndefined()
  })

  it('migrateLegacySermonFields resolves without throwing', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    await expect(port.migrateLegacySermonFields()).resolves.toBeUndefined()
  })
})
