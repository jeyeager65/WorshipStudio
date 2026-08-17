import type { Arrangement, SongBlock } from './song'
import type { AutoAdvanceConfig } from './library'

/** One passage a sermon references — a sermon may cite several beyond its main one; only the
 *  main passage (Sermon.mainPassageId) is printed in the Order of Worship, but every passage
 *  here is presented on screen, in list order, ahead of the outline. */
export interface SermonPassage {
  id: string
  reference: string
  translation: string
  displayMode: 'full' | 'reference-only'
}

/** One presentable step after a sermon's main passage. Keeping references to the existing
 * passage/outline records avoids duplicating their editing and scripture-display settings. */
export type SermonFlowItem =
  { type: 'passage'; passageId: string } | { type: 'outline'; outlineId: string }

export type ServiceItemContent =
  | { type: 'song'; songId: string; arrangement: Arrangement }
  | {
      type: 'scripture'
      reference: string
      translation: string
      displayMode: 'full' | 'reference-only'
    }
  | { type: 'slide-ref'; slideId: string }
  /** Ad hoc, service-only slides — never saved to the Slide Library. */
  | { type: 'text-slide'; slides: SongBlock[] }
  | { type: 'media'; mediaId: string; fit: 'cover' | 'contain' }
  | { type: 'video'; mediaId: string }
  | { type: 'audio'; mediaId: string }
  | { type: 'external-app'; profileId: string; file?: string }
  /** "Worship Through the Word" — presentable passage(s) plus an outline, positioned wherever
   *  it actually falls in the service rather than pinned to a fixed header. This item is the
   *  sole source of truth for the service's sermon (title/passage/preacher, the last via the
   *  shared role field below) — there is no separate service-level sermon summary. */
  | {
      type: 'sermon'
      title?: string
      passages: SermonPassage[]
      mainPassageId: string
      outline: SongBlock[]
      /** Whether the main passage is presented before the remaining sermon flow. Defaults to
       * true for compatibility with existing sermons and the common public-reading pattern. */
      presentMainPassage?: boolean
      /** Supporting scripture and outline points in their intended presentation order. Legacy
       * sermons without a flow retain their historical passages-then-outline order. */
      flow?: SermonFlowItem[]
    }
  /** A bulletin-only line (e.g. "Silent Preparation", a named prayer) — never presented on
   *  screen (see flattenService.ts); its heading/body are the shared bulletinLabel/bulletinNote
   *  fields below, not fields of its own. */
  | { type: 'bulletin-note' }
  /** A "this slot needs real content" stand-in inserted by a ServiceTemplate for any kind
   *  requiring something specific picked/typed (song, scripture, slide, media, sermon, etc) —
   *  replaced in place once filled in (see ServiceWorkspaceView's insertItem/replaceItemIndex).
   *  suggestedTab pre-selects the right Add-to-Service tab when replaced. */
  | { type: 'placeholder'; label: string; suggestedTab?: string }

export type ServiceItem = ServiceItemContent & {
  id: string
  /** Optional per-service override for generated presentation slides. When absent, the default
   * theme for this item's real content type is used. Ignored by self-styled library/media items. */
  themeId?: string
  /** Who's doing this part (Elder leading prayer, scripture reader, etc.) — a RoleDefinition id
   *  from the same catalog Assignments uses, not a Person id directly: the actual person is
   *  whoever that service's Assignments has for this role, so assigning it there is what fills
   *  this in (and keeps conflict-detection/templates consistent). Optional and often absent — a
   *  "Silent Preparation" bulletin note, for example, needs no one assigned at all. For the
   *  sermon item this is how its preacher is resolved too — the same role/assignments mechanism
   *  as every other item type, no special-cased field. */
  roleId?: string
  /** Overrides this item's default Order of Worship heading (e.g. Scripture's hardcoded
   *  "Scripture Reading:" becomes "Scriptural Call to Worship:"; a song, which has no default
   *  label at all, can be given one like "Tithes and Offerings:"). */
  bulletinLabel?: string
  /** An optional second line under this item's Order of Worship entry (e.g. "(after this song
   *  children up to grade 4 can be dismissed to a children's lesson)") — the operator types the
   *  full text themselves; nothing here is auto-punctuated. */
  bulletinNote?: string
  /** Optional auto-advance/looping timer override for this item's own generated slides (see
   *  notes/slide-auto-advance-plan.md) — only meaningful for `text-slide`/`slide-ref` items
   *  (the UI only exposes it there); ignored by every other type, including song/scripture/
   *  sermon, which are normally paced live by whoever's leading them rather than a timer. For a
   *  `slide-ref` item specifically, an absent value here falls back to the referenced
   *  SlideLibraryItem's own `autoAdvance` default (useLiveTransport.ts); a `text-slide` has no
   *  library item to fall back to, so it's override-only. Live transport advances through *this
   *  item's own* flattened slides on this interval instead of waiting for the operator, gated on
   *  the live position staying within this item; `loop` restarts from the item's first slide
   *  instead of stopping once the timer reaches the item's last slide. */
  autoAdvance?: AutoAdvanceConfig
}

export interface RoleAssignment {
  roleId: string
  personId?: string
  tentative: boolean
}

/** What a single ServiceTemplate entry seeds when a new service is created from its template:
 *  either a real order-of-service item (with a placeholder standing in for content that must be
 *  picked/typed) or, for 'role-only', just a RoleAssignment row with no line in the order of
 *  service at all (e.g. "2 Greeters"). */
export interface ServiceTemplateItem {
  id: string
  kind:
    'bulletin-note' | 'sermon' | 'song' | 'scripture' | 'slide' | 'media' | 'other' | 'role-only'
  /** Bulletin heading / placeholder description (e.g. "Opening Song") / role-only's own display
   *  label. */
  label: string
  /** Optional printed note carried into the generated service item. For bulletin-note entries,
   *  this is the item body; for content entries, it appears beneath the item in the bulletin. */
  note?: string
  /** RoleDefinition id. Optional for content kinds, required for role-only. */
  roleId?: string
  /** role-only kind only, default 1 (e.g. 2 Greeters). */
  count?: number
}

/** An ordered shell for a service type — songs, scripture, sermon, bulletin notes, role-only
 *  assignments — filled in once per church and applied at service creation (see
 *  applyServiceTemplate, called from CreateServiceView); never re-applied to already-created
 *  services afterward. Order matters: items seed Service.items in this same order. */
export interface ServiceTemplate {
  /** The template's own stable name — deliberately still name-based, not id-based (see
   *  models/settings.ts's ServiceTypeDefinition doc comment for the concepts that already
   *  got real ids). Historically this also implied which service type used it;
   *  defaultForServiceTypeIds now makes that association explicit (and id-based) while this
   *  field keeps doing double duty as the template's own display identity. A future phase
   *  gives templates a real independent name/id instead of overloading this field for both. */
  serviceType: string
  /** Optional planning note explaining when this template should be used. */
  description?: string
  /** ServiceTypeDefinition ids that select this template by default (was a list of service
   *  type *names* before the one-time migration in src-tauri/src/commands/service_types.rs).
   *  Undefined means a legacy template, which still defaults to the service type with the same
   *  *name* as `serviceType` above (still name-based); an empty array explicitly means none. */
  defaultForServiceTypeIds?: string[]
  items: ServiceTemplateItem[]
}

export interface Service {
  id: string
  date: string
  /** Local service start time in 24-hour HH:mm form. Optional for services created before
   *  start times were introduced. */
  time?: string
  /** A ServiceTypeDefinition id (models/settings.ts) — was named `type` and held the service
   *  type's plain *name* before the one-time migration in
   *  src-tauri/src/commands/service_types.rs; existing libraries get rewritten in place the
   *  first time that migration runs. */
  serviceTypeId: string
  /** Private, service-level planning context that does not appear in the order of worship. */
  planningNotes?: string
  /** Songs being considered or ordered during planning; separate from the actual service items. */
  planningSongIds?: string[]
  /** The template most recently applied to this service, for planning context. */
  serviceTemplateName?: string
  items: ServiceItem[]
  /** Operator-only notes, keyed by service item id. */
  presenterNotes?: Record<string, string>
  assignments?: RoleAssignment[]
  /** This week's front-page (Order of Worship) bulletin footer quote — entered fresh each week;
   *  the footer's title is a church-wide choice (LibrarySettings.bulletin.page1FooterTitle). */
  bulletinPage1Footer?: string
  /** This week's back-page (Announcements) bulletin footer quote. */
  bulletinPage2Footer?: string
  updatedAt: string
  updatedByDevice: string
}
