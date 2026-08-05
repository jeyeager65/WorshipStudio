/**
 * Line-icon badges for the "Modern" bulletin style — real path data from Material Design Icons
 * (`@mdi/js`, the same icon set already used everywhere else in this app via `mdi-*` names),
 * not hand-drawn. Each badge wraps one icon's 24x24 path in a soft circular background.
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
  mdiCircleOutline,
} from '@mdi/js'

const SIZE = 40
const ICON_SIZE = 22 // rendered icon footprint within the 40x40 badge
const ICON_OFFSET = (SIZE - ICON_SIZE) / 2
const ICON_SCALE = ICON_SIZE / 24 // every MDI path is drawn on a 24x24 grid
const INK = '#000000'
const BADGE_FILL = '#F2F2F2'
const BADGE_STROKE = '#CCCCCC'

function badge(path: string): string {
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="19" fill="${BADGE_FILL}" stroke="${BADGE_STROKE}" stroke-width="1"/>
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
/** A generic fallback for any content type without a more specific icon above. */
export const iconGeneric = badge(mdiCircleOutline)
