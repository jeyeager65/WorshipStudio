import type { Announcement } from '@/models/announcement'

/** The date this announcement stops displaying, or undefined if none can be determined —
 *  `showUntil` always wins when set, otherwise falls back to the event date(s) for pattern 1.
 *  Pattern 2 (no event date) has no fallback, which is exactly why `requiresExplicitStopDate`
 *  below treats a missing `showUntil` there as a validation error rather than "shows forever". */
export function effectiveStopDate(announcement: Announcement): string | undefined {
  return announcement.showUntil ?? announcement.eventEndDate ?? announcement.eventDate
}

/** Every announcement needs a real stop-showing date one way or another — an event date
 *  supplies one automatically, so only the ongoing/standing pattern (no event date) requires the
 *  operator to type an explicit `showUntil`. Used by the management UI to reject a save that
 *  would otherwise never expire. */
export function requiresExplicitStopDate(announcement: Pick<Announcement, 'eventDate' | 'showUntil'>): boolean {
  return !announcement.eventDate && !announcement.showUntil
}

/** Visible on a bulletin generated for `serviceDate` — compared against that date, never
 *  wall-clock "today", since a bulletin can reasonably be generated ahead of or after the fact. */
export function isVisibleOn(announcement: Announcement, serviceDate: string): boolean {
  if (announcement.showFrom && serviceDate < announcement.showFrom) return false
  const stopDate = effectiveStopDate(announcement)
  if (stopDate && serviceDate > stopDate) return false
  return true
}

/** "Upcoming" (event-dated) vs general "Announcements" (ongoing/standing) — see Announcement's
 *  own doc comment for the two patterns. */
export function isEventDated(announcement: Announcement): boolean {
  return !!announcement.eventDate
}

/** Announcements visible on `serviceDate`, split into the two bulletin sections — Upcoming
 *  sorted soonest-first, Announcements in no particular imposed order (list order is the
 *  operator's own, matching how service items already work). */
export function splitForBulletin(
  announcements: Announcement[],
  serviceDate: string,
): { upcoming: Announcement[]; general: Announcement[] } {
  const visible = announcements.filter((a) => isVisibleOn(a, serviceDate))
  const upcoming = visible
    .filter(isEventDated)
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
  const general = visible.filter((a) => !isEventDated(a))
  return { upcoming, general }
}
