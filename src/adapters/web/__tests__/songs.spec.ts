import { beforeEach, describe, expect, it } from 'vitest'
import type { Song } from '@/models/song'
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
      usage: { usesPastYear: 0 },
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
      usage: { usesPastYear: 0 },
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
})
