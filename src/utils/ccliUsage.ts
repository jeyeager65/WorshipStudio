import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

export interface SongUsageRow {
  songId: string
  title: string
  ccli?: string
  author?: string
  timesUsed: number
}

export interface CcliUsageSummary {
  totalUses: number
  uniqueSongs: number
  servicesIncluded: number
  rows: SongUsageRow[]
}

export interface CcliUsageFilter {
  fromDate: string
  toDate: string
  /** Omitted or 'all' means every service type. */
  serviceType?: string
}

/**
 * Tallies song usage across services in a date range — computed fresh from actual service
 * history rather than each song's own `usage.usesPastYear` (a rolling "past year" figure,
 * not scoped to an arbitrary reporting range) — for CCLI license reporting.
 */
export function computeCcliUsage(
  services: Service[],
  songs: Song[],
  filter: CcliUsageFilter,
): CcliUsageSummary {
  const songsById = new Map(songs.map((song) => [song.id, song]))
  const usesBySongId = new Map<string, number>()
  let servicesIncluded = 0

  const inRange = services.filter(
    (service) =>
      service.date >= filter.fromDate &&
      service.date <= filter.toDate &&
      (!filter.serviceType ||
        filter.serviceType === 'all' ||
        service.serviceTypeId === filter.serviceType),
  )

  for (const service of inRange) {
    let matchedInThisService = false
    for (const item of service.items) {
      if (item.type !== 'song') continue
      usesBySongId.set(item.songId, (usesBySongId.get(item.songId) ?? 0) + 1)
      matchedInThisService = true
    }
    if (matchedInThisService) servicesIncluded += 1
  }

  const rows: SongUsageRow[] = [...usesBySongId.entries()]
    .map(([songId, timesUsed]) => {
      const song = songsById.get(songId)
      return {
        songId,
        title: song?.title ?? 'Unknown song',
        ccli: song?.ccli,
        author: song?.author,
        timesUsed,
      }
    })
    .sort((a, b) => b.timesUsed - a.timesUsed || a.title.localeCompare(b.title))

  return {
    totalUses: [...usesBySongId.values()].reduce((sum, n) => sum + n, 0),
    uniqueSongs: usesBySongId.size,
    servicesIncluded,
    rows,
  }
}

export type QuickRange = 'quarter' | 'ytd' | 'last-year'

// Formats using local calendar-date components (not toISOString, which converts to UTC and
// can land on a different day near midnight) — service dates are plain YYYY-MM-DD calendar
// dates with no timezone semantics, so this needs to match that, not shift by the reader's
// UTC offset.
function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function isoDate(date: Date): string {
  return formatLocalDate(date.getFullYear(), date.getMonth(), date.getDate())
}

/** `today` is a parameter (rather than read internally) purely so this stays testable. */
export function quickRangeDates(
  range: QuickRange,
  today: Date,
): { fromDate: string; toDate: string } {
  const year = today.getFullYear()
  if (range === 'ytd') {
    return { fromDate: formatLocalDate(year, 0, 1), toDate: isoDate(today) }
  }
  if (range === 'last-year') {
    return { fromDate: formatLocalDate(year - 1, 0, 1), toDate: formatLocalDate(year - 1, 11, 31) }
  }
  // 'quarter': the current calendar quarter, start through today.
  const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3
  return { fromDate: formatLocalDate(year, quarterStartMonth, 1), toDate: isoDate(today) }
}
