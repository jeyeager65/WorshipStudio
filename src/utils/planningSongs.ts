import type { ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'

export type PlanningSongSlot =
  Extract<ServiceItem, { type: 'song' }> | Extract<ServiceItem, { type: 'placeholder' }>

export function isPlanningSongSlot(item: ServiceItem): item is PlanningSongSlot {
  return item.type === 'song' || (item.type === 'placeholder' && item.suggestedTab === 'songs')
}

function slotBulletinLabel(item: ServiceItem): string | undefined {
  if (item.bulletinLabel) return item.bulletinLabel
  if (item.type === 'placeholder') return item.label.trim() || undefined
  return undefined
}

/** Restores a filled song to an empty slot without changing its service-order identity,
 * assignment role, bulletin label/note, theme, or position. */
export function emptyPlanningSongSlot(item: ServiceItem): ServiceItem {
  return {
    id: item.id,
    type: 'placeholder',
    label: slotBulletinLabel(item) ?? '',
    suggestedTab: 'songs',
    roleId: item.roleId,
    bulletinLabel: slotBulletinLabel(item),
    bulletinNote: item.bulletinNote,
    themeId: item.themeId,
  }
}

/** Fills one existing song slot while preserving the slot's service-order metadata. */
export function fillPlanningSongSlot(item: ServiceItem, song: Song): ServiceItem {
  return {
    id: item.id,
    type: 'song',
    songId: song.id,
    arrangement: { sequence: [...song.defaultArrangement.sequence] },
    roleId: item.roleId,
    bulletinLabel: slotBulletinLabel(item),
    bulletinNote: item.bulletinNote,
    themeId: item.themeId,
  }
}

/** Moves an already configured service song into another slot without resetting its custom
 * arrangement; only the destination slot's position and metadata are retained. */
export function placePlanningSongInSlot(
  slot: ServiceItem,
  songItem: Extract<ServiceItem, { type: 'song' }>,
): ServiceItem {
  return {
    ...songItem,
    id: slot.id,
    roleId: slot.roleId,
    bulletinLabel: slotBulletinLabel(slot),
    bulletinNote: slot.bulletinNote,
    themeId: slot.themeId,
  }
}

/** Packs all filled songs into the available song slots from first to last. Non-song service
 * items never move; each destination slot keeps its own label/role/note, and any gaps collect
 * as empty placeholders at the end. */
export function compactPlanningSongSlots(items: ServiceItem[]): ServiceItem[] {
  const songs = items.filter(
    (item): item is Extract<ServiceItem, { type: 'song' }> => item.type === 'song',
  )
  let songIndex = 0
  return items.map((item) => {
    if (!isPlanningSongSlot(item)) return item
    const song = songs[songIndex++]
    return song ? placePlanningSongInSlot(item, song) : emptyPlanningSongSlot(item)
  })
}
