import type { Service } from '@/models/service'
import type { Announcement } from '@/models/announcement'
import type { BulletinSettings } from '@/models/settings'
import { splitForBulletin } from '@/utils/announcementVisibility'
import { localCalendarDate } from '@/utils/calendarDate'

export interface BulletinPage2Line {
  /** Date lead-in for an Upcoming entry (e.g. "June 7", "June 14–18", or "Starting August 24"
   *  for a long-running window — see announcementDateLabel), absent for a general/standing
   *  announcement. */
  dateLabel?: string
  text: string
}

export interface ServingScheduleRow {
  /** Resolved display name, not the underlying RoleDefinition id — printed directly. */
  role: string
  /** One entry per person assigned to this role — kept as a list (not pre-joined into one
   *  comma-separated string) so the bulletin can print one name per line. `['TBD']` when no one
   *  is assigned yet. */
  thisWeek: string[]
  nextWeek: string[]
}

export interface ServingScheduleTable {
  /** ['Role', 'This Week', 'Next Week'] */
  headers: string[]
  /** One row per configured role — scales cleanly to however many roles a church picks, unlike
   *  a week-per-row layout that would need a new column for every additional role. */
  rows: ServingScheduleRow[]
}

export interface BulletinPage2Doc {
  title: string
  upcoming: BulletinPage2Line[]
  general: BulletinPage2Line[]
  servingSchedule?: ServingScheduleTable
  footer?: { title: string; text: string }
}

// The year is only worth printing when it isn't obvious from context — an event dated in some
// other year than the service the bulletin is being printed for (never wall-clock "today": a
// bulletin can be generated well ahead of or after the service itself, same reasoning as
// isVisibleOn in announcementVisibility.ts).
function formatDate(date: string, referenceYear: number): string {
  const parsed = new Date(`${date}T00:00:00`)
  const includeYear = parsed.getFullYear() !== referenceYear
  return parsed.toLocaleDateString(
    undefined,
    includeYear
      ? { month: 'long', day: 'numeric', year: 'numeric' }
      : { month: 'long', day: 'numeric' },
  )
}

function daysBetween(start: string, end: string): number {
  const startMs = new Date(`${start}T00:00:00`).getTime()
  const endMs = new Date(`${end}T00:00:00`).getTime()
  return Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))
}

function announcementDateLabel(
  date: string,
  endDate: string | undefined,
  time: string | undefined,
  referenceYear: number,
): string {
  // A window longer than a week (e.g. a month of open registration) reads awkwardly as a full
  // range ("August 24–September 30") — a real bulletin just names when it starts.
  if (endDate && daysBetween(date, endDate) > 7) {
    return `Starting ${formatDate(date, referenceYear)}`
  }
  const range = endDate
    ? `${formatDate(date, referenceYear)}–${formatDate(endDate, referenceYear)}`
    : formatDate(date, referenceYear)
  return time ? `${range} ${time}` : range
}

/** The service, of the same recurring type, dated exactly 7 days after `current` — the
 *  bulletin's "Next Week" for the serving schedule. Not just "whichever service comes next
 *  chronologically," since a church's other recurring service types (evening, midweek) can fall
 *  in between. Undefined (not an error) when that occurrence hasn't been created yet. */
export function findNextWeekService(services: Service[], current: Service): Service | undefined {
  const nextDate = addDays(current.date, 7)
  return services.find((s) => s.serviceTypeId === current.serviceTypeId && s.date === nextDate)
}

// Service dates have no timezone semantics — toISOString() would first convert to UTC and can
// return the wrong calendar day near local midnight in timezones ahead of UTC (see
// calendarDate.ts's own doc comment). localCalendarDate reads the local getFullYear/Month/Date
// fields instead, so the round-trip through this Date object stays on the intended calendar day.
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localCalendarDate(d)
}

function namesForRole(
  roleId: string,
  service: Service | undefined,
  personNames: Map<string, string>,
): string[] {
  const names = (service?.assignments ?? [])
    .filter((a) => a.roleId === roleId && a.personId)
    .map((a) => personNames.get(a.personId!))
    .filter((name): name is string => !!name)
  // No one assigned yet — most often "Next Week" simply hasn't been staffed at bulletin-print
  // time, but the same applies to This Week if a role was somehow left unfilled.
  return names.length ? names : ['TBD']
}

function buildServingSchedule(
  roleIds: string[],
  thisWeek: Service,
  nextWeek: Service | undefined,
  personNames: Map<string, string>,
  roleNames: Map<string, string>,
): ServingScheduleTable | undefined {
  if (roleIds.length === 0) return undefined
  return {
    headers: ['Role', 'This Week', 'Next Week'],
    rows: roleIds.map((roleId) => ({
      role: roleNames.get(roleId) ?? roleId,
      thisWeek: namesForRole(roleId, thisWeek, personNames),
      nextWeek: namesForRole(roleId, nextWeek, personNames),
    })),
  }
}

/**
 * Builds the bulletin's second-page content — announcements/upcoming events, the This Week/Next
 * Week serving schedule, and its own footer quote. Analogous to orderOfWorship.ts's
 * buildOrderOfWorship, kept UI-agnostic so it's testable without the report-rendering layer. The
 * page's own title is a church-chosen label (BulletinSettings.page2Title) — nothing in here
 * assumes any particular name for it.
 */
export function buildBulletinPage2(
  service: Service,
  nextWeekService: Service | undefined,
  announcements: Announcement[],
  bulletin: BulletinSettings,
  personNames: Map<string, string>,
  roleNames: Map<string, string> = new Map(),
): BulletinPage2Doc {
  const { upcoming, general } = bulletin.showAnnouncements
    ? splitForBulletin(announcements, service.date)
    : { upcoming: [], general: [] }
  const referenceYear = new Date(`${service.date}T00:00:00`).getFullYear()

  return {
    title: bulletin.page2Title,
    upcoming: upcoming.map((a) => ({
      dateLabel: announcementDateLabel(a.eventDate!, a.eventEndDate, a.eventTime, referenceYear),
      text: a.text,
    })),
    general: general.map((a) => ({ text: a.text })),
    servingSchedule: bulletin.showServingSchedule
      ? buildServingSchedule(
          bulletin.servingScheduleRoleIds,
          service,
          nextWeekService,
          personNames,
          roleNames,
        )
      : undefined,
    footer:
      bulletin.page2FooterEnabled && service.bulletinPage2Footer
        ? { title: bulletin.page2FooterTitle, text: service.bulletinPage2Footer }
        : undefined,
  }
}
