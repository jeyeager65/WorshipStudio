import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'

export interface FlatSlide {
  /** Unique across the whole flattened sequence. */
  key: string
  itemIndex: number
  itemId: string
  /** e.g. song title, "Scripture: John 3:16" */
  itemLabel: string
  /** e.g. block label "Chorus"; empty for single-slide item types */
  subLabel: string
  text: string
}

function labelForOtherType(item: ServiceItem): string {
  switch (item.type) {
    case 'scripture':
      return `Scripture: ${item.reference}`
    case 'slide-ref':
      return 'Slide'
    case 'media':
      return 'Media'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'external-app':
      return 'External App'
    case 'countdown':
      return 'Countdown'
    case 'qr':
      return 'QR Code'
    default:
      return 'Item'
  }
}

/**
 * Walks a service's items into one continuous run of slides — the flattened Next/Prev
 * sequence (spec section 3). Songs and text-slides expand to one flat entry per block;
 * every other item type (scripture, slide-ref, media, video, audio, external-app,
 * countdown, qr) is still a work-in-progress content type (M5/M6/v1.1), so each becomes a
 * single placeholder slide for now rather than being left out of the sequence entirely.
 */
export function flattenService(service: Service, songsById: Map<string, Song>): FlatSlide[] {
  const flat: FlatSlide[] = []

  service.items.forEach((item, itemIndex) => {
    if (item.type === 'song') {
      const song = songsById.get(item.songId)
      const itemLabel = song?.title ?? 'Unknown Song'
      const sequence = item.arrangement.sequence
      if (sequence.length === 0) {
        flat.push({ key: `${item.id}:0`, itemIndex, itemId: item.id, itemLabel, subLabel: '(empty arrangement)', text: '' })
      } else {
        sequence.forEach((blockId, subIndex) => {
          const block = song?.blocks.find((b) => b.id === blockId)
          flat.push({
            key: `${item.id}:${subIndex}`,
            itemIndex,
            itemId: item.id,
            itemLabel,
            subLabel: block?.label ?? blockId,
            text: block?.text ?? '',
          })
        })
      }
    } else if (item.type === 'text-slide') {
      if (item.slides.length === 0) {
        flat.push({ key: `${item.id}:0`, itemIndex, itemId: item.id, itemLabel: 'Text Slide', subLabel: '(empty)', text: '' })
      } else {
        item.slides.forEach((slide, subIndex) => {
          flat.push({
            key: `${item.id}:${subIndex}`,
            itemIndex,
            itemId: item.id,
            itemLabel: 'Text Slide',
            subLabel: slide.label,
            text: slide.text,
          })
        })
      }
    } else {
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: labelForOtherType(item),
        subLabel: '',
        text: '',
      })
    }
  })

  return flat
}
