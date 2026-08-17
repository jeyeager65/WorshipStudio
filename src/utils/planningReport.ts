import type { Service } from '@/models/service'
import type { Song } from '@/models/song'
import type { RoleGroupDefinition, RoleDefinition } from '@/models/settings'
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
  rosterGroups: PlanningRosterGroup[]
}

export interface PlanningRosterAssignment {
  /** Resolved display name, not the underlying RoleDefinition id — printed directly. */
  role: string
  person: string
  tentative: boolean
}

export interface PlanningRosterGroup {
  /** Undefined for roles that do not belong to a configured category. */
  category?: string
  assignments: PlanningRosterAssignment[]
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
  roles: RoleDefinition[],
  roleGroups: RoleGroupDefinition[],
  filter: PlanningReportFilter,
  formalPersonNames: Map<string, string> = personNames,
  serviceTypeNames: Map<string, string> = new Map(),
): PlanningReportRow[] {
  const songsById = new Map(songs.map((song) => [song.id, song]))

  const inRange = services
    .filter(
      (service) =>
        service.date >= filter.fromDate &&
        service.date <= filter.toDate &&
        (!filter.serviceType ||
          filter.serviceType === 'all' ||
          service.serviceTypeId === filter.serviceType),
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  return inRange.map((service) => {
    const songTitles = service.items
      .filter((item) => item.type === 'song')
      .map((item) => songsById.get(item.songId)?.title ?? 'Unknown song')

    const rosterGroups: PlanningRosterGroup[] = []
    for (const assignment of service.assignments ?? []) {
      if (!assignment.personId) continue
      const role = roles.find((r) => r.id === assignment.roleId)
      const category = roleGroups.find((group) => group.id === role?.groupId)?.name
      let group = rosterGroups.find((candidate) => candidate.category === category)
      if (!group) {
        group = { category, assignments: [] }
        rosterGroups.push(group)
      }
      group.assignments.push({
        role: role?.name ?? assignment.roleId,
        person: personNames.get(assignment.personId) ?? 'Unassigned',
        tentative: assignment.tentative,
      })
    }

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
      type: serviceTypeNames.get(service.serviceTypeId) ?? 'Unknown',
      preacher: formalPersonNames.get(sermonPreacherId(service, sermonItem) ?? ''),
      sermonTitle: sermonItem?.title,
      songTitles,
      rosterGroups,
    }
  })
}
