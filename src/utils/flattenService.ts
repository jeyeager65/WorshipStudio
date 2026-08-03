import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import type { PresentationThemeTarget, SlideLibraryItem, SlideScene } from '@/models/library'
import type { ScripturePassage, ExternalAppProfile } from '@/adapters/types'
import {
  getBibleProgress,
  getWayfindingBooks,
  parseReference,
  type WayfindingBook,
} from '@/utils/scriptureReference'
import { paginateTextUnits, type FontSizeRange } from '@/utils/textAutoFit'
import { scenePlainText } from '@/utils/slideScene'
import { serviceDateTimeIso } from '@/utils/serviceTime'

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
  /** Generated content only. Used to resolve a service-item override or library default theme. */
  themeTarget?: PresentationThemeTarget
  /** Advanced slide-library pages only. */
  scene?: SlideScene
  /** Advanced slide-library pages only — this service's own date/time (ISO), for a Countdown
   *  scene element in 'service' mode to count down to (see models/library.ts). Undefined when
   *  the service has no start time set. */
  serviceDateTime?: string
  /** Sermon passages only — which passage (by id) this page belongs to, so the editor can
   *  group a passage's own auto-split pages together. Absent for every other slide type. */
  passageId?: string
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
  /** Full-text scripture and song slides only — the configured auto-fit range (spec section 1) PresentationView fits this slide's text within (see DEFAULT_SCRIPTURE_FONT_RANGE/DEFAULT_SONG_FONT_RANGE). */
  fontRange?: FontSizeRange
  /**
   * Song blocks only — tells PresentationView to treat each `\n`-separated line in `text` as
   * its own authored unit that shouldn't wrap unless it truly doesn't fit, preferring a break
   * at a comma/semicolon over an arbitrary word boundary when it does. Scripture's `text` is
   * one flowing paragraph instead (see the scripture branch below), which wraps normally.
   */
  lineWrap?: boolean
  /** Song blocks only — overrides the footer text PresentationView would otherwise show
   *  (subLabel, the block's own label) with the song's first collection citation instead (e.g.
   *  "Hymns of Grace #123"). Empty string when the song has no collections (hide the footer
   *  rather than fall back to the block label). Undefined for every other slide type, which
   *  keeps showing subLabel as its footer exactly as before. */
  footerText?: string
  /** Song blocks only — set when this block is one of a *back-to-back* run of the same block
   *  (e.g. "2/2" for the second of two consecutive Chorus slides), so a same-block repeat
   *  doesn't look identical to the one before it. Local to that one run, not the block's total
   *  appearances in the song — a Chorus used twice elsewhere, not consecutively, gets no label
   *  either time. Absent for a run of length 1 (this block, right here, isn't repeated in place). */
  repeatLabel?: string
  /** Sermon outline points only — the point's own title, shown large in the main slide area
   *  with `text` (its details, if any) below it in a smaller size, instead of the usual single
   *  auto-fit block. Undefined for every other slide type. */
  outlineTitle?: string
}

// Presentation footer for a song block: the song's own reference material (its first hymnal/
// collection citation) is more useful to a congregation following along in print than the
// operator-facing block label ("Chorus") ever was. Empty string (not undefined) when the song
// has no collections, so the caller can tell "no footer" apart from "not a song".
function formatSongFooter(song: Song): string {
  const entry = song.collections[0]
  if (!entry?.collectionId) return ''
  return entry.number ? `${entry.collectionId} #${entry.number}` : entry.collectionId
}

function labelForOtherType(item: ServiceItem): string {
  switch (item.type) {
    case 'media':
      return 'Media'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    default:
      return 'Item'
  }
}

/**
 * Shared by the `scripture` branch (one passage per item) and the `sermon` branch (one call
 * per passage in its list) — same reference-only/unresolved/paginated-full-text shape either
 * way. `keyPrefix`/`startSubIndex` key a standalone scripture item's own (single, stable)
 * passage; a sermon passage instead keys off its own `passageId` (page number only relative to
 * that one passage, not cumulative across the sermon's other passages) — a *content-addressed*
 * key that can never collide with, or be reassigned to, a sibling passage's or outline block's
 * key. That matters because `liveSlideKey` (see useLiveTransport.ts) is a bare string stored
 * across re-flattens: a cumulative position-based key would shift for every passage/outline
 * that comes after one just added, removed, or re-paginated, and the live slide would silently
 * jump to whatever unrelated content now happened to land on that same stale key string.
 * Returns how many slides were pushed.
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
  themeTarget: PresentationThemeTarget,
  /** Set only when called for one of a sermon's several passages — lets the editor group that
   *  passage's own pages together (see ServiceWorkspaceView's sermon passage editor) without
   *  having to re-derive pagination boundaries itself, and keys this passage's pages stably
   *  (see this function's own doc comment). Absent for a standalone scripture item, which has
   *  only the one (implicit) passage. */
  passageId?: string,
): number {
  const keyFor = (pageIndex: number) =>
    passageId ? `${itemId}:passage:${passageId}:${pageIndex}` : `${keyPrefix}:${startSubIndex + pageIndex}`

  if (displayMode === 'reference-only') {
    const parsed = parseReference(reference)
    flat.push({
      key: keyFor(0),
      itemIndex,
      itemId,
      itemLabel: reference,
      subLabel: 'Reference Only',
      text: '',
      themeTarget,
      passageId,
      wayfindingBooks: parsed?.book ? getWayfindingBooks(parsed.book) : undefined,
      bibleProgress: parsed ? getBibleProgress(parsed) : undefined,
    })
    return 1
  }
  if (!passage) {
    flat.push({
      key: keyFor(0),
      itemIndex,
      itemId,
      itemLabel: reference,
      subLabel: translation,
      text: '',
      themeTarget,
      passageId,
    })
    return 1
  }
  // Verses flow as one paragraph (space-joined), not one per line — pagination splits whole
  // verses onto separate slides instead when they don't all fit.
  const verseUnits = passage.verses.map((v) => `${v.number} ${v.text}`)
  const pages = paginateTextUnits(verseUnits, scriptureFontRange, ' ')
  pages.forEach((pageUnits, i) => {
    flat.push({
      key: keyFor(i),
      itemIndex,
      itemId,
      itemLabel: passage.reference,
      subLabel:
        pages.length > 1
          ? `${passage.translation} (${i + 1}/${pages.length})`
          : passage.translation,
      text: pageUnits.join(' '),
      themeTarget,
      passageId,
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
 * launch/focus when live (see ServiceWorkspaceView); every other item type (audio) is still
 * a work-in-progress content type, so each becomes a single placeholder slide for now rather
 * than being left out of the sequence entirely.
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
  const serviceDateTime = serviceDateTimeIso(service)

  service.items.forEach((item, itemIndex) => {
    if (item.type === 'song') {
      const song = songsById.get(item.songId)
      const itemLabel = song?.title ?? 'Unknown Song'
      const sequence = item.arrangement.sequence
      const footerText = song ? formatSongFooter(song) : ''
      if (sequence.length === 0) {
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel,
          subLabel: '(empty arrangement)',
          text: '',
          themeTarget: 'songs',
          fontRange: songFontRange,
          lineWrap: true,
          footerText,
        })
      } else {
        // A repeat indicator is per back-to-back run, not total appearances in the song — e.g.
        // V1, C, V2, C, C, V3, C, C has 5 Choruses overall, but only the two *consecutive*
        // pairs get numbered ("1/2"/"2/2" each), independently of each other; the two lone
        // Choruses get no label at all, same as any other non-repeated block.
        let subIndex = 0
        let i = 0
        while (i < sequence.length) {
          let j = i
          while (j < sequence.length && sequence[j] === sequence[i]) j++
          const runLength = j - i
          for (let k = i; k < j; k++) {
            const blockId = sequence[k]
            const block = song?.blocks.find((b) => b.id === blockId)
            flat.push({
              key: `${item.id}:${subIndex}`,
              itemIndex,
              itemId: item.id,
              itemLabel,
              subLabel: block?.label ?? blockId,
              text: block?.text ?? '',
              themeTarget: 'songs',
              fontRange: songFontRange,
              lineWrap: true,
              footerText,
              repeatLabel: runLength > 1 ? `${k - i + 1}/${runLength}` : undefined,
            })
            subIndex++
          }
          i = j
        }
      }
    } else if (item.type === 'text-slide') {
      if (item.slides.length === 0) {
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel: 'Text Slide',
          subLabel: '(empty)',
          text: '',
          themeTarget: 'text-slides',
        })
      } else {
        item.slides.forEach((slide, subIndex) => {
          flat.push({
            key: `${item.id}:${subIndex}`,
            itemIndex,
            itemId: item.id,
            itemLabel: 'Text Slide',
            subLabel: slide.label,
            text: slide.text,
            themeTarget: 'text-slides',
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
        'scripture',
      )
    } else if (item.type === 'sermon') {
      // Every passage presents in list order (reusing the exact same reference-only/
      // unresolved/paginated shape as a plain scripture item, resolved from the same
      // scriptureById map but under a composite `itemId:passageId` key since one sermon can
      // hold several passages), then the outline. Passage keys are content-addressed by the
      // passage's own id, and outline keys by the block's own id — neither depends on how many
      // slides came before it, so adding/removing/reordering a sibling can never shift, or
      // collide with, another passage's or outline block's key (see pushScriptureSlides's own
      // doc comment for why that matters).
      for (const passage of item.passages) {
        const resolved =
          passage.displayMode === 'reference-only'
            ? undefined
            : scriptureById.get(`${item.id}:${passage.id}`)
        // Passage slides use the default *scripture* theme (not the sermon theme) unless the
        // item has its own override — resolvePresentationTheme already checks the override
        // against this target first, so an override that isn't valid for 'scripture' still
        // falls back to the scripture default rather than silently applying anyway.
        pushScriptureSlides(
          flat,
          itemIndex,
          item.id,
          item.id,
          0,
          passage.reference,
          passage.translation,
          passage.displayMode,
          resolved,
          scriptureFontRange,
          'scripture',
          passage.id,
        )
      }
      item.outline.forEach((block, outlineIndex) => {
        flat.push({
          key: `${item.id}:outline:${block.id}`,
          itemIndex,
          itemId: item.id,
          itemLabel: 'Sermon Outline',
          subLabel: block.label,
          text: block.text,
          themeTarget: 'sermon',
          // Numbered the same way the editor shows it (see ServiceWorkspaceView's outline
          // list) — the point's position in the outline, not baked into the stored label
          // itself, so reordering or deleting a point always renumbers correctly.
          outlineTitle: `${outlineIndex + 1}. ${block.label}`,
          // The title now lives in the main slide area (see outlineTitle) rather than the
          // footer — an explicit override (not just leaving subLabel alone) so it can never
          // fall back to showing the same title twice.
          footerText: '',
        })
      })
      if (item.passages.length === 0 && item.outline.length === 0) {
        flat.push({
          key: `${item.id}:0`,
          itemIndex,
          itemId: item.id,
          itemLabel: 'Sermon',
          subLabel: '(empty)',
          text: '',
          themeTarget: 'sermon',
        })
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
            serviceDateTime,
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
