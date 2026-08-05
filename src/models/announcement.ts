/**
 * A printed-bulletin announcement — deliberately separate from Slide Library announcement
 * slides (see library.ts's SlideLibraryItem): the two say different things by design (slides are
 * punchy/visual for on-screen display, print entries are more detailed and often forward-
 * looking), so this is its own list rather than reusing slide content.
 *
 * Two visibility patterns, both evaluated against a *service's own date* (never wall-clock
 * "today" — see announcementVisibility.ts):
 *   1. Event-dated ("Upcoming"): `eventDate` set — tied to one specific day (or, with
 *      `eventEndDate`, a range). Visible up through that date, gone the day after; the date
 *      itself is the natural stop-showing point, so `showUntil` is optional here.
 *   2. Ongoing/standing (general "Announcements"): no `eventDate` — starts showing on
 *      `showFrom` (if set) and *keeps* showing, unlike pattern 1. Since there's no event date to
 *      infer a stop point from, `showUntil` is required for this pattern (enforced at save time,
 *      not by the type itself, so a single optional field can serve both patterns).
 */
export interface Announcement {
  id: string
  /** Full body text, operator-typed — same "type the whole thing yourself" convention as
   *  ServiceItem.bulletinNote. */
  text: string
  eventDate?: string
  eventEndDate?: string
  /** Free-text time portion (e.g. "4:30pm", "1-6pm") — real bulletins format times too
   *  inconsistently to model structurally, so this is appended as typed. */
  eventTime?: string
  /** Pattern 2 only: don't display before this date. */
  showFrom?: string
  /** When to stop displaying. Defaults to (eventEndDate ?? eventDate) when unset — see
   *  announcementVisibility.ts's effectiveStopDate. */
  showUntil?: string
  updatedAt: string
  updatedByDevice: string
}
