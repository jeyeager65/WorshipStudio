/**
 * Line-icon badges for the "Modern" bulletin style — real path data from Material Design Icons
 * (`@mdi/js`, the same icon set already used everywhere else in this app via `mdi-*` names),
 * not hand-drawn. Each badge wraps one icon's 24x24 path in a soft rounded-square background.
 * Monochrome only (this prints on a black-and-white laser printer).
 */
import {
  mdiHandWaveOutline,
  mdiHeartOutline,
  mdiBookOpenPageVariantOutline,
  mdiMusicNoteOutline,
  mdiHandsPray,
  mdiCrossOutline,
  mdiGiftOutline,
  mdiCandle,
  mdiThoughtBubbleOutline,
  mdiBullhornVariantOutline,
  mdiAsteriskCircleOutline,
  mdiCalendarBlank,
  mdiHumanGreetingVariant,
  mdiVolumeHigh,
  mdiCradleOutline,
  mdiAccount,
  mdiPresentation,
  mdiMovieOpenOutline,
  mdiApplicationOutline,
} from '@mdi/js'

const SIZE = 40
const ICON_SIZE = 22 // rendered icon footprint within the 40x40 badge
const ICON_OFFSET = (SIZE - ICON_SIZE) / 2
const ICON_SCALE = ICON_SIZE / 24 // every MDI path is drawn on a 24x24 grid
const INK = '#000000'
const BADGE_FILL = '#F2F2F2'
const BADGE_STROKE = '#CCCCCC'

const BADGE_CORNER_RADIUS = 9

function badge(path: string): string {
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" rx="${BADGE_CORNER_RADIUS}" ry="${BADGE_CORNER_RADIUS}" fill="${BADGE_FILL}" stroke="${BADGE_STROKE}" stroke-width="1"/>
    <g transform="translate(${ICON_OFFSET}, ${ICON_OFFSET}) scale(${ICON_SCALE})">
      <path d="${path}" fill="${INK}"/>
    </g>
  </svg>`
}

/** Welcome/Announcements. */
export const iconPeople = badge(mdiHandWaveOutline)
/** Silent Preparation / footer quote. */
export const iconHeart = badge(mdiHeartOutline)
/** Scriptural Call to Worship / Scripture Reading. */
export const iconBook = badge(mdiBookOpenPageVariantOutline)
/** Songs. */
export const iconMusic = badge(mdiMusicNoteOutline)
/** Prayer. */
export const iconPrayer = badge(mdiHandsPray)
/** Worship Through the Word (sermon). */
export const iconCross = badge(mdiCrossOutline)
/** Tithes and Offerings. */
export const iconGift = badge(mdiGiftOutline)
/** Silent Reflection. */
export const iconCandle = badge(mdiCandle)
/** Footer sections whose title is a "Thought to Ponder"-style reflection. */
export const iconThought = badge(mdiThoughtBubbleOutline)
/** Announcement items. */
export const iconAnnounce = badge(mdiBullhornVariantOutline)
/** A generic fallback for any content type without a more specific icon above. */
export const iconGeneric = badge(mdiAsteriskCircleOutline)
/** Video items, and External App Hand-off items whose profile kind is "video" — matches this
 *  app's own convention for video content elsewhere (MediaLibraryView.vue, ServiceOrderList.vue). */
export const iconVideo = badge(mdiMovieOpenOutline)
/** External App Hand-off items whose profile kind is "presentation" (e.g. PowerPoint). */
export const iconPresentation = badge(mdiPresentation)
/** External App Hand-off items whose profile kind is "custom" (or whose profile no longer
 *  exists) — matches this app's own default icon for external apps elsewhere (Settings' list,
 *  ServiceOrderList.vue), rather than the fully generic asterisk fallback. */
export const iconApplication = badge(mdiApplicationOutline)

// Bare (un-badged) icons for page 2's right-side design — section subtitles and per-role
// markers in the serving schedule table sit beside small text, not a 40x40 line-item row, so a
// plain path at the target size reads better than shrinking a whole circular badge down.
function plainIcon(path: string): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="${INK}"/></svg>`
}

/** UPCOMING subtitle. */
export const plainIconCalendar = plainIcon(mdiCalendarBlank)
/** ANNOUNCEMENTS subtitle. */
export const plainIconAnnounce = plainIcon(mdiBullhornVariantOutline)
/** Serving-schedule role containing "greet". */
export const plainIconGreeting = plainIcon(mdiHumanGreetingVariant)
/** Serving-schedule role containing "sound". */
export const plainIconVolume = plainIcon(mdiVolumeHigh)
/** Serving-schedule role containing "nursery" or "baby". */
export const plainIconCradle = plainIcon(mdiCradleOutline)
/** Serving-schedule role fallback. */
export const plainIconAccount = plainIcon(mdiAccount)
