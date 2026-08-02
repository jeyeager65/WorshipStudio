export interface SlideScene {
  width: number
  height: number
  /** Full-height center-crop guides for narrower projector aspect ratios. */
  safeAreas: Array<{ label: string; aspectRatio: number; color: string }>
  background: {
    color: string
    mediaId?: string
    fit: 'cover' | 'contain'
    focalPoint?: { x: number; y: number }
  }
  /** Array order is the canonical back-to-front layer order. */
  elements: SlideElement[]
}

interface SlideElementBase {
  id: string
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  lockAspectRatio?: boolean
  locked?: boolean
  hidden?: boolean
}

export interface SlideTextElement extends SlideElementBase {
  type: 'text'
  text: string
  style: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    italic: boolean
    underline: boolean
    color: string
    textAlign: 'left' | 'center' | 'right'
    verticalAlign: 'top' | 'middle' | 'bottom'
    lineHeight: number
    letterSpacing: number
    effect?: {
      type: 'none' | 'outline' | 'shadow' | 'glow'
      color: string
      size: number
      offsetX?: number
      offsetY?: number
    }
  }
  autoFit: 'none' | 'shrink'
}

export interface SlideImageElement extends SlideElementBase {
  type: 'image'
  mediaId: string
  fit: 'contain' | 'cover' | 'fill'
  focalPoint?: { x: number; y: number }
  borderRadius?: number
}

export interface SlideShapeElement extends SlideElementBase {
  type: 'shape'
  shape: 'rectangle' | 'ellipse' | 'line' | 'triangle'
  fill: string
  fillMode?: 'solid' | 'outline'
  stroke?: { color: string; width: number }
  cornerRadius?: number
}

export type SlideElement = SlideTextElement | SlideImageElement | SlideShapeElement

export interface LibrarySlide {
  id: string
  label: string
  scene: SlideScene
  source:
    | { type: 'native' }
    | {
        type: 'canva'
        designId: string
        pageNumber: number
        renderedMediaId: string
        lastImportedAt: string
      }
}

export interface SlideLibraryItem {
  id: string
  label: string
  tags: string[]
  documentVersion: 2
  slides: LibrarySlide[]
  backgroundId?: string
  loop?: {
    enabled: boolean
    secondsPerSlide: number
    countdownOverlay?: { targetTime: string }
  }
  usage: {
    lastUsedAt?: string
    usesPastYear: number
  }
  updatedAt: string
  updatedByDevice: string
}

export interface MediaItem {
  id: string
  filename: string
  /** Required — the human-facing label shown everywhere this item appears, instead of the raw filename. */
  title: string
  description?: string
  kind: 'image' | 'video'
  tags: string[]
  location: 'synced' | 'local'
  duplicateOfId?: string
  /** Non-cryptographic content hash used only to notice accidental duplicate imports. */
  contentHash: string
  usage: {
    lastUsedAt?: string
    usesPastYear: number
  }
  updatedAt: string
  updatedByDevice: string
}

export interface Theme {
  id: string
  name: string
  /** Solid color shown directly or behind an image/video background. */
  backgroundColor?: string
  backgroundId?: string
  font: string
  textColor: string
  /** Configurable text treatment. Absent on older themes; `outline` is used to migrate them. */
  textEffect?: TextEffect
  /** Legacy text-outline flag retained for themes saved by older Worship Studio versions. */
  outline: boolean
  /** Content types this theme is intended for. Empty/absent means it is a generic theme that
   * can be used with every generated presentation type. */
  appliesTo?: PresentationThemeTarget[]
  useAsDefaultFor: PresentationThemeTarget[]
  updatedAt: string
  updatedByDevice: string
}

export interface TextEffect {
  type: 'none' | 'outline' | 'shadow' | 'glow'
  color: string
  size: number
  offsetX?: number
  offsetY?: number
}

/** Generated presentation content that can inherit a reusable visual theme. Advanced library
 * slides and full-screen media already own their visuals and intentionally are not targets. */
export type PresentationThemeTarget = 'songs' | 'scripture' | 'sermon' | 'text-slides'

export interface UnavailableDateRange {
  start: string
  end: string
}

export interface Person {
  id: string
  firstName: string
  lastName: string
  /** The first name this person normally uses, such as "Dan" for Daniel. */
  preferredName?: string
  /** A formal title, such as Pastor, Elder, Mr., Mrs., Ms., or Dr. */
  title?: string
  email?: string
  /** Not a restriction — just makes this person show up first when filling roles for these. */
  preferredRoles: string[]
  unavailableDateRanges: UnavailableDateRange[]
  updatedAt: string
  updatedByDevice: string
}

export function personDisplayName(person: Person): string {
  return `${person.preferredName?.trim() || person.firstName} ${person.lastName}`.trim()
}

/** Formal name used where the person's office/title matters, such as bulletin attribution. */
export function personFormalName(person: Person): string {
  return `${person.title?.trim() || ''} ${personDisplayName(person)}`.trim()
}

/** Pastors are elders, so the directory's Elder filter intentionally includes both titles. */
export function isElder(person: Person): boolean {
  const title = person.title?.trim().toLocaleLowerCase()
  return title === 'elder' || title === 'pastor'
}

/** Sorts people with `role` in their preferredRoles first — a hint for filling pickers faster,
 *  never a restriction on who can be picked (anyone remains selectable, just further down). */
export function sortByPreferredRole<T extends Person>(people: T[], role: string): T[] {
  return [...people].sort(
    (a, b) => Number(b.preferredRoles.includes(role)) - Number(a.preferredRoles.includes(role)),
  )
}
