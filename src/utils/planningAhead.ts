import type { Service } from '@/models/service'

export interface PlanningAheadMonth {
  /** "2026-03" — sorts and dedupes naturally as a plain string key. */
  monthKey: string
  monthLabel: string
  services: Service[]
}

/**
 * Feature-spec.md's Planning Ahead screen: a longer-range view of upcoming services than the
 * landing screen's short 5-item Upcoming list, grouped by month for navigation. Scoped to
 * services that already exist (created via Create Service) — there's no recurring-schedule
 * concept in the data model to synthesize placeholder rows for weeks nothing has been
 * created for yet, so unlike the full spec's drag-and-drop reshuffle between dates, this
 * stays a read/fill-in view of real service records.
 */
export function groupUpcomingByMonth(services: Service[], todayIso: string): PlanningAheadMonth[] {
  const upcoming = services.filter((service) => service.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date))

  const months = new Map<string, PlanningAheadMonth>()
  for (const service of upcoming) {
    const monthKey = service.date.slice(0, 7)
    let month = months.get(monthKey)
    if (!month) {
      const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      month = { monthKey, monthLabel, services: [] }
      months.set(monthKey, month)
    }
    month.services.push(service)
  }
  return [...months.values()]
}

export function needsPreacher(service: Service): boolean {
  return !service.preacherId
}

export function hasStarted(service: Service): boolean {
  return service.items.length > 0
}
