import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem, SlideScene } from '@/models/library'
import type { ScripturePassage, ExternalAppProfile } from '@/adapters/types'
import { getBibleProgress, getWayfindingBooks, parseReference, type WayfindingBook } from '@/utils/scriptureReference'
import { paginateTextUnits, type FontSizeRange } from '@/utils/textAutoFit'
import { scenePlainText } from '@/utils/slideScene'

// Matches LibrarySettings' scriptureMin/MaxFontSizePx defaults (see models/settings.ts) — used
// whenever a caller doesn't pass its own configured range (e.g. existing tests).
const DEFAULT_SCRIPTURE_FONT_RANGE: FontSizeRange = { minPx: 28, maxPx: 72 }

// Matches LibrarySettings' songMin/MaxFontSizePx defaults (see models/settings.ts) — song
// blocks are already the atomic unit a worship leader chose (Verse 1, Chorus, etc.), so unlike
// scripture there's no auto-split across slides, just shrink-to-fit within this range.
const DEFAULT_SONG_FONT_RANGE: FontSizeRange = { minPx: 16, maxPx: 72 }

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
  /** Advanced slide-library pages only. */
  scene?: SlideScene
  /** Reference-only scripture slides only — the surrounding-books wayfinding visual (spec section 1). */
  wayfindingBooks?: WayfindingBook[]
  /** Reference-only scripture slides only — 0-1 fraction of the way through the whole Bible
   *  (by KJV verse count) this reference falls at, for the wayfinding progress bar. */
  bibleProgress?: number
  /** Media/Video items only — resolved to an actual displayable URL by the caller (see ServiceWorkspaceView), since that needs an async Rust round trip flattenService can't make. */
  mediaId?: string
  mediaKind?: 'image' | 'video'
  mediaFit?: 'cover' | 'contain'
  /** External App Hand-off items only (spec section 12) — what to launch/focus when this slide goes live. */
  externalApp?: { profileId: string; file?: string }
  /** Countdown items only (spec section 1) — the live-ticking clock's target and optional custom text. */
  countdown?: { targetTime: string; text?: string }
  /** Full-text scripture and song slides only — the configured auto-fit range (spec section 1) PresentationView fits this slide's text within (see DEFAULT_SCRIPTURE_FONT_RANGE/DEFAULT_SONG_FONT_RANGE). */
  fontRange?: FontSizeRange
  /**
   * Song blocks only — tells PresentationView to treat each `\n`-separated line in `text` as
   * its own authored unit that shouldn't wrap unless it truly doesn't fit, preferring a break
   * at a comma/semicolon over an arbitrary word boundary when it does. Scripture's `text` is
   * one flowing paragraph instead (see the scripture branch below), which wraps normally.
   */
  lineWrap?: boolean
}

function labelForOtherType(item: ServiceItem): string {
  switch (item.type) {
    case 'media':
      return 'Media'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'qr':
      return 'QR Code'
    default:
      return 'Item'
  }
}

/**
 * Shared by the `scripture` branch (one passage per item) and the `sermon` branch (one call
 * per passage in its list) — same reference-only/unresolved/paginated-full-text shape either
 * way. `keyPrefix` is the owning item's id; `startSubIndex` lets a sermon's later passages (and
 * then its outline) continue the same item's slide-key sequence rather than each restarting at
 * 0, which would collide (see flattenService's own slideFlatIndex lookup-by-exact-key in
 * ServiceWorkspaceView.vue). Returns how many slides were pushed, so the caller can advance its
 * own counter by that amount.
 */
function pushScriptureSlides(
  flat: FlatSlide[],
  itemIndex: number,
  itemId: string,
  keyPrefix: string,
  startSubIndex: number,
  reference: string,
  translation: string,
  displayMode: 'full' | 'reference-only',
  passage: ScripturePassage | undefined,
  scriptureFontRange: FontSizeRange,
): number {
  if (displayMode === 'reference-only') {
    const parsed = parseReference(reference)
    flat.push({
      key: `${keyPrefix}:${startSubIndex}`,
      itemIndex,
      itemId,
      itemLabel: reference,
      subLabel: 'Reference Only',
      text: '',
      wayfindingBooks: parsed?.book ? getWayfindingBooks(parsed.book) : undefined,
      bibleProgress: parsed ? getBibleProgress(parsed) : undefined,
    })
    return 1
  }
  if (!passage) {
    flat.push({
      key: `${keyPrefix}:${startSubIndex}`,
      itemIndex,
      itemId,
      itemLabel: reference,
      subLabel: translation,
      text: '',
    })
    return 1
  }
  // Verses flow as one paragraph (space-joined), not one per line — pagination splits whole
  // verses onto separate slides instead when they don't all fit.
  const verseUnits = passage.verses.map((v) => `${v.number} ${v.text}`)
  const pages = paginateTextUnits(verseUnits, scriptureFontRange, ' ')
  pages.forEach((pageUnits, i) => {
    flat.push({
      key: `${keyPrefix}:${startSubIndex + i}`,
      itemIndex,
      itemId,
      itemLabel: passage.reference,
      subLabel: pages.length > 1 ? `${passage.translation} (${i + 1}/${pages.length})` : passage.translation,
      text: pageUnits.join(' '),
      fontRange: scriptureFontRange,
    })
  })
  return pages.length
}

/**
 * Walks a service's items into one continuous run of slides — the flattened Next/Prev
 * sequence (spec section 3). Songs expand to one flat entry per block (a block is already the
 * atomic unit a worship leader chose — Verse 1, Chorus, etc. — so unlike scripture it never
 * auto-splits; each block's text just shrinks to fit within `songFontRange`, however small
 * that takes); text-slides expand to one flat entry per slide the same way. Scripture becomes
 * one or more slides per resolved passage (see scriptureById below), pre-split at verse
 * boundaries via paginateTextUnits so a passage too long for `scriptureFontRange` at its
 * minimum size becomes a run of consecutive flat slides rather than one slide with overflowing
 * text. Either way, actual font size within the given range is decided live, per render, by
 * PresentationView (which alone knows the real container's pixel size); this function only
 * decides *how many slides* and *which content goes on each*, since that split has to be
 * stable for Next/Prev regardless of which display ends up presenting it. Slide-ref
 * items expand to one flat entry per slide in the referenced library item (see slidesById
 * below), same shape as text-slide; media/video items carry a `mediaId` for the caller to
 * resolve to a real displayable URL (this function stays synchronous, so it can't do that
 * Rust round trip itself); external-app items carry their profileId/file for the caller to
 * launch/focus when live (see ServiceWorkspaceView); countdown items carry their target
 * time/text for the caller to render a live-ticking clock from (computed client-side, not
 * baked in here, since "now" obviously isn't a pure function of the service data); every
 * other item type (audio, qr) is still a work-in-progress content type, so each becomes a
 * single placeholder slide for now rather than being left out of the sequence entirely.
 * Sermon items present each of their passages (same shape as scripture, just resolved under a
 * composite id since one sermon can hold several) followed by their outline, one per block
 * like text-slide. Bulletin-note items are the one deliberate exception to "every item gets at
 * least one slide" — they exist only for the printed Order of Worship (see orderOfWorship.ts)
 * and produce nothing here.
 */
export function flattenService(
  service: Service,
  songsById: Map<string, Song>,
  scriptureById: Map<string, ScripturePassage> = new Map(),
  slidesById: Map<string, SlideLibraryItem> = new Map(),
  externalAppProfilesById: Map<string, ExternalAppProfile> = new Map(),
  scriptureFontRange: FontSizeRange = DEFAULT_SCRIPTURE_FONT_RANGE,
  songFontRange: FontSizeRange = DEFAULT_SONG_FONT_RANGE,
): FlatSlide[] {
  const flat: FlatSlide[] = []

  service.items.forEach((item, itemIndex) => {
    if (item.type === 'song') {
      const song = songsById.get(item.songId)
      const itemLabel = song?.title ?? 'Unknown Song'
      const sequence = item.arrangement.sequence
      if (sequence.length === 0) {
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel,
          subLabel: '(empty arrangement)',
          text: '',
          fontRange: songFontRange,
          lineWrap: true,
        })
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
            fontRange: songFontRange,
            lineWrap: true,
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
      const passage = item.displayMode === 'reference-only' ? undefined : scriptureById.get(item.id)
      pushScriptureSlides(
        flat,
        itemIndex,
        item.id,
        item.id,
        0,
        item.reference,
        item.translation,
        item.displayMode,
        passage,
        scriptureFontRange,
      )
    } else if (item.type === 'sermon') {
      // Every passage presents in list order (reusing the exact same reference-only/
      // unresolved/paginated shape as a plain scripture item, resolved from the same
      // scriptureById map but under a composite `itemId:passageId` key since one sermon can
      // hold several passages), then the outline — one continuous key sequence across both
      // halves so an outline block's key never collides with an earlier passage's page (see
      // pushScriptureSlides's own doc comment for why that matters).
      let subIndex = 0
      for (const passage of item.passages) {
        const resolved = passage.displayMode === 'reference-only' ? undefined : scriptureById.get(`${item.id}:${passage.id}`)
        subIndex += pushScriptureSlides(
          flat,
          itemIndex,
          item.id,
          item.id,
          subIndex,
          passage.reference,
          passage.translation,
          passage.displayMode,
          resolved,
          scriptureFontRange,
        )
      }
      item.outline.forEach((block, i) => {
        flat.push({
          key: `${item.id}:${subIndex + i}`,
          itemIndex,
          itemId: item.id,
          itemLabel: 'Sermon Outline',
          subLabel: block.label,
          text: block.text,
        })
      })
      subIndex += item.outline.length
      if (subIndex === 0) {
        flat.push({ key: `${item.id}:0`, itemIndex, itemId: item.id, itemLabel: 'Sermon', subLabel: '(empty)', text: '' })
      }
    } else if (item.type === 'bulletin-note') {
      // Deliberately produces no slides — unlike every other branch here, this item exists
      // only for the printed Order of Worship (see orderOfWorship.ts), never the live
      // Next/Prev sequence.
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
            text: scenePlainText(slide.scene),
            scene: slide.scene,
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
    } else if (item.type === 'countdown') {
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: 'Countdown',
        subLabel: '',
        text: item.text ?? '',
        countdown: { targetTime: item.targetTime, text: item.text },
      })
    } else if (item.type === 'placeholder') {
      // Deliberately not blank — an unreplaced placeholder accidentally presented live should
      // be obviously wrong, not a silent empty slide.
      flat.push({
        key: `${item.id}:0`,
        itemIndex,
        itemId: item.id,
        itemLabel: item.label,
        subLabel: '(placeholder — not yet filled in)',
        text: '',
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
