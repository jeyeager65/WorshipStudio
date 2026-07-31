import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import type { RoleGroup } from '@/models/settings'
import { roleDisplayLabel } from '@/models/settings'
import { findSermonItem, sermonPreacherId } from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'

export interface PlanningReportRow {
  serviceId: string
  date: string
  dateLine: string
  type: string
  preacher?: string
  sermonTitle?: string
  songTitles: string[]
  /** "Piano — Marlene", tentative assignments marked with a trailing "?" — same convention as orderOfWorship.ts. */
  roster: string[]
}

export interface PlanningReportFilter {
  fromDate: string
  toDate: string
  /** Omitted or 'all' means every service type. */
  serviceType?: string
}

/**
 * Feature-spec.md's Multi-Week Planning Report (Assignments section): a read-only view
 * of praise team assignments and planned songs across a date range, matching the real-world
 * workflow of pre-planning a couple months of song/praise-team assignments at once — same
 * reporting pattern as CCLI usage (date range in, rows out), not a new editable grid.
 */
export function buildPlanningReport(
  services: Service[],
  songs: Song[],
  personNames: Map<string, string>,
  roleGroups: RoleGroup[],
  filter: PlanningReportFilter,
): PlanningReportRow[] {
  const songsById = new Map(songs.map((song) => [song.id, song]))

  const inRange = services
    .filter(
      (service) =>
        service.date >= filter.fromDate &&
        service.date <= filter.toDate &&
        (!filter.serviceType || filter.serviceType === 'all' || service.type === filter.serviceType),
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  return inRange.map((service) => {
    const songTitles = service.items
      .filter((item) => item.type === 'song')
      .map((item) => songsById.get(item.songId)?.title ?? 'Unknown song')

    const roster = (service.assignments ?? [])
      .filter((assignment) => assignment.personId)
      .map((assignment) => {
        const name = personNames.get(assignment.personId!) ?? 'Unassigned'
        return `${roleDisplayLabel(assignment.role, roleGroups)} — ${name}${assignment.tentative ? '?' : ''}`
      })

    const dateLabel = new Date(`${service.date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const timeLabel = formatServiceTime(service.time)
    const dateLine = timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel

    const sermonItem = findSermonItem(service)

    return {
      serviceId: service.id,
      date: service.date,
      dateLine,
      type: service.type,
      preacher: personNames.get(sermonPreacherId(service, sermonItem) ?? ''),
      sermonTitle: sermonItem?.title,
      songTitles,
      roster,
    }
  })
}
