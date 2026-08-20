import { describe, expect, it } from 'vitest'
import {
  emptyPlanningSongSlot,
  fillPlanningSongSlot,
  compactPlanningSongSlots,
  placePlanningSongInSlot,
} from '@/utils/planningSongs'
import type { ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'

const song: Song = {
  id: 'song-1',
  title: 'Amazing Grace',
  collections: [],
  tags: [],
  blocks: [],
  defaultArrangement: { sequence: ['v1'] },
  usageDates: [],
  updatedAt: '',
  updatedByDevice: '',
}

describe('planning song slots', () => {
  it('fills a template placeholder without moving or losing its label and role', () => {
    const slot: ServiceItem = {
      id: 'slot-1',
      type: 'placeholder',
      label: 'Closing Song',
      suggestedTab: 'songs',
      roleId: 'Song Leader',
    }
    expect(fillPlanningSongSlot(slot, song)).toMatchObject({
      id: 'slot-1',
      type: 'song',
      songId: 'song-1',
      bulletinLabel: 'Closing Song',
      roleId: 'Song Leader',
      arrangement: { sequence: ['v1'] },
    })
  })

  it('restores a removed song to an empty placeholder with its slot metadata', () => {
    const filled: ServiceItem = {
      id: 'slot-1',
      type: 'song',
      songId: 'song-1',
      arrangement: { sequence: ['v1'] },
      bulletinLabel: "The Lord's Supper",
      roleId: 'Song Leader',
    }
    expect(emptyPlanningSongSlot(filled)).toMatchObject({
      id: 'slot-1',
      type: 'placeholder',
      suggestedTab: 'songs',
      label: "The Lord's Supper",
      bulletinLabel: "The Lord's Supper",
      roleId: 'Song Leader',
    })
  })

  it('reorders a configured song without moving a slot label or resetting its arrangement', () => {
    const destination: ServiceItem = {
      id: 'closing-slot',
      type: 'placeholder',
      label: 'Closing Song',
      suggestedTab: 'songs',
    }
    const configured: Extract<ServiceItem, { type: 'song' }> = {
      id: 'opening-slot',
      type: 'song',
      songId: 'song-1',
      arrangement: { sequence: ['v1', 'c', 'v2'] },
      bulletinLabel: 'Opening Song',
    }
    expect(placePlanningSongInSlot(destination, configured)).toMatchObject({
      id: 'closing-slot',
      songId: 'song-1',
      arrangement: { sequence: ['v1', 'c', 'v2'] },
      bulletinLabel: 'Closing Song',
    })
  })

  it('compacts remaining songs forward and leaves the final slot empty', () => {
    const items: ServiceItem[] = [
      {
        id: 'slot-1',
        type: 'song',
        songId: 'song-1',
        arrangement: { sequence: [] },
        bulletinLabel: 'Opening Song',
      },
      { id: 'slot-2', type: 'placeholder', label: 'Middle Song', suggestedTab: 'songs' },
      { id: 'prayer', type: 'bulletin-note', bulletinLabel: 'Prayer' },
      {
        id: 'slot-3',
        type: 'song',
        songId: 'song-3',
        arrangement: { sequence: ['v1'] },
        bulletinLabel: 'Closing Song',
      },
    ]
    const compacted = compactPlanningSongSlots(items)
    expect(compacted[0]).toMatchObject({
      id: 'slot-1',
      type: 'song',
      songId: 'song-1',
      bulletinLabel: 'Opening Song',
    })
    expect(compacted[1]).toMatchObject({
      id: 'slot-2',
      type: 'song',
      songId: 'song-3',
      bulletinLabel: 'Middle Song',
    })
    expect(compacted[2]).toEqual(items[2])
    expect(compacted[3]).toMatchObject({ id: 'slot-3', type: 'placeholder', label: 'Closing Song' })
  })
})
