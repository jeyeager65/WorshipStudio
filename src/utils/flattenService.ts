import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import type { ScripturePassage } from '@/adapters/types'

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
 * scripture becomes one slide per resolved passage (see scriptureById below) — real
 * per-verse auto-fit splitting (spec section 1) is still a later slice, so for now a
 * passage that resolved fits on a single slide regardless of length; every other item type
 * (slide-ref, media, video, audio, external-app, countdown, qr) is still a
 * work-in-progress content type (M6/v1.1), so each becomes a single placeholder slide for
 * now rather than being left out of the sequence entirely.
 */
export function flattenService(
  service: Service,
  songsById: Map<string, Song>,
  scriptureById: Map<string, ScripturePassage> = new Map(),
): FlatSlide[] {
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
    } else if (item.type === 'scripture') {
      if (item.displayMode === 'reference-only') {
        // No verse text needed at all in this mode (spec section 1) — no API/local-file
        // lookup, just the reference itself as a single wayfinding slide.
        flat.push({ key: `${item.id}:0`, itemIndex, itemId: item.id, itemLabel: item.reference, subLabel: 'Reference Only', text: '' })
      } else {
        const passage = scriptureById.get(item.id)
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel: passage?.reference ?? item.reference,
          subLabel: passage?.translation ?? item.translation,
          text: passage ? passage.verses.map((v) => `${v.number} ${v.text}`).join('\n') : '',
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
