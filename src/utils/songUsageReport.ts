import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

export interface SongUsageRow {
  songId: string
  title: string
  ccli?: string
  author?: string
  timesUsed: number
  /** Every date (within the report's range) a service used this song, ascending. Distinct from
   *  `Song.usageDates` — that array isn't scoped to any particular range, while this is scoped
   *  to whatever range this report was run against. */
  dates: string[]
}

export interface SongUsageSummary {
  totalUses: number
  uniqueSongs: number
  servicesIncluded: number
  rows: SongUsageRow[]
}

export interface SongUsageFilter {
  fromDate: string
  toDate: string
  /** Omitted or 'all' means every service type. */
  serviceType?: string
}

/**
 * Tallies song usage across services in a date range — computed fresh from actual service
 * history rather than each song's own `usageDates` (which isn't scoped to any particular
 * reporting range) — for the Song Usage report (CCLI license reporting, church records, and
 * general planning).
 */
export function computeSongUsage(
  services: Service[],
  songs: Song[],
  filter: SongUsageFilter,
): SongUsageSummary {
  const songsById = new Map(songs.map((song) => [song.id, song]))
  const usesBySongId = new Map<string, number>()
  const datesBySongId = new Map<string, string[]>()
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
      const dates = datesBySongId.get(item.songId) ?? []
      dates.push(service.date)
      datesBySongId.set(item.songId, dates)
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
        dates: (datesBySongId.get(songId) ?? []).slice().sort(),
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
