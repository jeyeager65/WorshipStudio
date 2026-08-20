import { beforeEach, describe, expect, it } from 'vitest'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import { getLastUsedDate, getUsesInPastYear } from '@/utils/songUsage'
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
    serviceTypeId: 'type-sunday-morning',
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

    expect((await port.get('service-1'))?.serviceTypeId).toBe('type-sunday-morning')
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

  it('incrementally updates song usage when a service referencing a song is saved', async () => {
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
      usageDates: [],
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
    expect(updated?.usageDates).toEqual([{ serviceId: 'service-1', date: '2026-01-15' }])
    const today = '2026-01-16'
    expect(getLastUsedDate(updated?.usageDates ?? [], today)).toBe('2026-01-15')
    expect(getUsesInPastYear(updated?.usageDates ?? [], today)).toBe(1)
  })

  it('stores a future-dated service entry without filtering it — the write side is date-agnostic', async () => {
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
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })

    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 5)
    const futureDateStr = farFuture.toISOString().slice(0, 10)
    await port.save(
      sampleService({
        date: futureDateStr,
        items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
      }),
    )

    const updated = await songs.get('song-1')
    expect(updated?.usageDates).toEqual([{ serviceId: 'service-1', date: futureDateStr }])
    const today = new Date().toISOString().slice(0, 10)
    expect(getLastUsedDate(updated?.usageDates ?? [], today)).toBeUndefined()
    expect(getUsesInPastYear(updated?.usageDates ?? [], today)).toBe(0)
  })

  it('editing a service to remove a song removes that song’s usage entry for it', async () => {
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
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    await port.save(
      sampleService({
        date: '2026-01-15',
        items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
      }),
    )
    expect((await songs.get('song-1'))?.usageDates).toHaveLength(1)

    // The edited service no longer references song-1 at all.
    await port.save(sampleService({ date: '2026-01-15', items: [] }))

    expect((await songs.get('song-1'))?.usageDates).toEqual([])
  })

  it("editing a service's date updates the existing entry instead of duplicating it", async () => {
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
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    const items = [{ id: 'item-1', type: 'song' as const, songId: 'song-1', arrangement: { sequence: [] } }]
    await port.save(sampleService({ date: '2026-01-15', items }))
    await port.save(sampleService({ date: '2026-01-22', items }))

    expect((await songs.get('song-1'))?.usageDates).toEqual([
      { serviceId: 'service-1', date: '2026-01-22' },
    ])
  })

  it('deleting a service removes its entries from every song that had one', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)

    for (const id of ['song-1', 'song-2']) {
      await songs.save({
        id,
        title: id,
        collections: [],
        tags: [],
        blocks: [],
        defaultArrangement: { sequence: [] },
        usageDates: [],
        updatedAt: '',
        updatedByDevice: '',
      })
    }
    await port.save(
      sampleService({
        date: '2026-01-15',
        items: [
          { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
          { id: 'item-2', type: 'song', songId: 'song-2', arrangement: { sequence: [] } },
        ],
      }),
    )

    await port.delete('service-1')

    expect((await songs.get('song-1'))?.usageDates).toEqual([])
    expect((await songs.get('song-2'))?.usageDates).toEqual([])
  })

  it('a song referenced twice in one service only gets one usage entry for it', async () => {
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
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    await port.save(
      sampleService({
        date: '2026-01-15',
        items: [
          { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
          { id: 'item-2', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
        ],
      }),
    )

    expect((await songs.get('song-1'))?.usageDates).toHaveLength(1)
  })

  it('importOpenSongSets has no browser equivalent — matches the documented always-undefined contract', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    const songs = createWebSongsPort(root, settings)
    const port = createWebServicesPort(root, settings, songs)
    expect(await port.importOpenSongSets(2026, 'Sunday Morning')).toBeUndefined()
  })
})
