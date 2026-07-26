import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'
import type { ScripturePassage, ExternalAppProfile } from '@/adapters/types'
import { getWayfindingBooks, parseReference, type WayfindingBook } from '@/utils/scriptureReference'

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
  /** Reference-only scripture slides only — the surrounding-books wayfinding visual (spec section 1). */
  wayfindingBooks?: WayfindingBook[]
  /** Media/Video items only — resolved to an actual displayable URL by the caller (see ServiceWorkspaceView), since that needs an async Rust round trip flattenService can't make. */
  mediaId?: string
  mediaKind?: 'image' | 'video'
  mediaFit?: 'cover' | 'contain'
  /** External App Hand-off items only (spec section 12) — what to launch/focus when this slide goes live. */
  externalApp?: { profileId: string; file?: string }
}

function labelForOtherType(item: ServiceItem): string {
  switch (item.type) {
    case 'media':
      return 'Media'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
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
 * passage that resolved fits on a single slide regardless of length; slide-ref items expand
 * to one flat entry per slide in the referenced library item (see slidesById below), same
 * shape as text-slide; media/video items carry a `mediaId` for the caller to resolve to a
 * real displayable URL (this function stays synchronous, so it can't do that Rust round trip
 * itself); external-app items carry their profileId/file for the caller to launch/focus when
 * live (see ServiceWorkspaceView); every other item type (audio, countdown, qr) is still a
 * work-in-progress content type, so each becomes a single placeholder slide for now rather
 * than being left out of the sequence entirely.
 */
export function flattenService(
  service: Service,
  songsById: Map<string, Song>,
  scriptureById: Map<string, ScripturePassage> = new Map(),
  slidesById: Map<string, SlideLibraryItem> = new Map(),
  externalAppProfilesById: Map<string, ExternalAppProfile> = new Map(),
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
        const book = parseReference(item.reference)?.book
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel: item.reference,
          subLabel: 'Reference Only',
          text: '',
          wayfindingBooks: book ? getWayfindingBooks(book) : undefined,
        })
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
    } else if (item.type === 'slide-ref') {
      const slideItem = slidesById.get(item.slideId)
      if (!slideItem || slideItem.slides.length === 0) {
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel: slideItem?.label ?? 'Unknown Slide',
          subLabel: slideItem ? '(empty)' : '',
          text: '',
        })
      } else {
        slideItem.slides.forEach((slide, subIndex) => {
          flat.push({
            key: `${item.id}:${subIndex}`,
            itemIndex,
            itemId: item.id,
            itemLabel: slideItem.label,
            subLabel: slide.label,
            text: slide.text,
          })
        })
      }
    } else if (item.type === 'media') {
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: 'Media',
        subLabel: '',
        text: '',
        mediaId: item.mediaId,
        mediaKind: 'image',
        mediaFit: item.fit,
      })
    } else if (item.type === 'video') {
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: 'Video',
        subLabel: '',
        text: '',
        mediaId: item.mediaId,
        mediaKind: 'video',
        // No per-item fit choice for video (unlike `media`) — a dedicated video slide is
        // meant to be watched in full, not cropped like a background loop.
        mediaFit: 'contain',
      })
    } else if (item.type === 'external-app') {
      const profile = externalAppProfilesById.get(item.profileId)
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: profile?.name ?? 'External App',
        subLabel: '',
        text: '',
        externalApp: { profileId: item.profileId, file: item.file },
      })
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
