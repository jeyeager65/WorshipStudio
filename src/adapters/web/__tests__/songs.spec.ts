import { beforeEach, describe, expect, it } from 'vitest'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import { readJsonFile, writeJsonFile } from '../fsaStorage'
import { createWebSettingsPort } from '../settings'
import { createWebSongsPort } from '../songs'
import { createFakeRoot } from './fakeFsa'

beforeEach(() => {
  localStorage.clear()
})

function makeSongsPort(root: FileSystemDirectoryHandle) {
  const settings = createWebSettingsPort(root)
  return createWebSongsPort(root, settings)
}

const OPENSONG_XML = `<?xml version="1.0"?>
<song>
  <title>Amazing Grace</title>
  <author>John Newton</author>
  <lyrics>[V1]
Amazing grace how sweet the sound</lyrics>
</song>`

describe('createWebSongsPort', () => {
  it('lists nothing in a fresh library', async () => {
    const port = makeSongsPort(createFakeRoot())
    expect(await port.list()).toEqual([])
  })

  it('saves and stamps updatedAt/updatedByDevice, then round-trips through list/get', async () => {
    const root = createFakeRoot()
    const settings = createWebSettingsPort(root)
    await settings.saveMachineSettings({
      ...(await settings.getMachineSettings()),
      thisComputerName: 'Volunteer Laptop',
    })
    const port = createWebSongsPort(root, settings)

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
    await port.save(song)

    const fetched = await port.get('song-1')
    expect(fetched?.title).toBe('Great Are You Lord')
    expect(fetched?.updatedByDevice).toBe('Volunteer Laptop')
    expect(fetched?.updatedAt).not.toBe('')

    const listed = await port.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe('song-1')
  })

  it('returns undefined for a missing song rather than throwing', async () => {
    const port = makeSongsPort(createFakeRoot())
    expect(await port.get('does-not-exist')).toBeUndefined()
  })

  it('deletes a song', async () => {
    const root = createFakeRoot()
    const port = makeSongsPort(root)
    await port.save({
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
    await port.delete('song-1')
    expect(await port.get('song-1')).toBeUndefined()
    expect(await port.list()).toEqual([])
  })

  it('imports a song from OpenSong XML, parsing real lyric blocks', async () => {
    const port = makeSongsPort(createFakeRoot())
    const song = await port.importFromOpenSongXml(OPENSONG_XML)

    expect(song.title).toBe('Amazing Grace')
    expect(song.author).toBe('John Newton')
    expect(song.blocks.length).toBeGreaterThan(0)

    const listed = await port.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(song.id)
  })

  // Mirrors src-tauri/src/domain/songs.rs's migrate_usage_dates_if_needed tests — a library
  // saved before Song.usageDates existed (a raw song file on disk with no usageDates key, same
  // as this fixture's empty array default) must have it backfilled from real service history
  // the first time list() runs, not silently reset to "never used".
  describe('usageDates migration', () => {
    function songFixture(id: string): Song {
      return {
        id,
        title: 'Amazing Grace',
        collections: [],
        tags: [],
        blocks: [],
        defaultArrangement: { sequence: [] },
        usageDates: [],
        updatedAt: '',
        updatedByDevice: '',
      }
    }

    function serviceFixture(id: string, date: string, songId: string): Service {
      return {
        id,
        date,
        serviceTypeId: 'type-sunday',
        items: [{ id: 'item-1', type: 'song', songId, arrangement: { sequence: [] } }],
        updatedAt: '',
        updatedByDevice: '',
      }
    }

    it('backfills usageDates from existing services on first list(), then never again', async () => {
      const root = createFakeRoot()
      const settings = createWebSettingsPort(root)
      const port = createWebSongsPort(root, settings)
      await port.save(songFixture('song-1'))
      await writeJsonFile(
        root,
        'services/2026/service-1.json',
        serviceFixture('service-1', '2026-03-01', 'song-1'),
      )

      const listed = await port.list()
      expect(listed[0]?.usageDates).toEqual([{ serviceId: 'service-1', date: '2026-03-01' }])

      // Idempotent: clearing the marker's effect by re-saving the song with usageDates wiped
      // (simulating drift) must NOT get silently re-backfilled by a second list() — the marker
      // means this only ever runs once.
      const cleared = { ...listed[0]!, usageDates: [] }
      await port.save(cleared)
      const listedAgain = await port.list()
      expect(listedAgain[0]?.usageDates).toEqual([])
    })

    it('is a no-op on a genuinely fresh library, and still writes the marker', async () => {
      const root = createFakeRoot()
      const port = makeSongsPort(root)
      await expect(port.list()).resolves.toEqual([])
      const marker = await readJsonFile(root, 'songs.usage-dates-migrated.json')
      expect(marker).not.toBeNull()
    })
  })
})
