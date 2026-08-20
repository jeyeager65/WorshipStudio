/**
 * Shared, testable helpers over `Song.usageDates` — mirrors src-tauri/src/domain/songs.rs. The
 * write side (`usageDates`) is deliberately date-agnostic: every service that references a song
 * gets an entry regardless of whether its date is past, present, or future. It's up to whoever
 * *reads* the array to decide how to filter it for their own purpose — "last used"/"uses in the
 * past year" (used by the Song Library and Song Editor, below) exclude future-dated entries,
 * since a planned-but-not-yet-happened service isn't a use yet.
 */

import type { Song, SongUsageEntry } from '@/models/song'
import type { Service } from '@/models/service'

function toDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00`)
}

/** Today's date as a local calendar date ("YYYY-MM-DD"), not `toISOString().slice(0, 10)` — that
 *  converts to UTC first, which lands on the wrong calendar day for part of the evening/night in
 *  any timezone behind UTC (same reasoning as utils/songUsageReport.ts's own isoDate/formatLocalDate,
 *  which this mirrors). Service dates are plain local calendar dates with no timezone semantics,
 *  so "today" needs to match that, not shift by the reader's UTC offset. */
export function todayLocal(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The most recent date this song was used, excluding any service dated after `today` — a
 *  service planned for the future is a plan, not a use, so it must not show up as "last used"
 *  until its date actually arrives. Accepts `dates` as possibly undefined — not just a defensive
 *  nicety: a song saved before this field existed (or reintroduced by a "keep theirs" conflict
 *  resolution pulling in a not-yet-migrated copy, `web/sync.ts`'s resolveConflict) can genuinely
 *  reach display code with it missing, on the web/tablet ports specifically (a plain JSON.parse,
 *  unlike Rust's #[serde(default)] on the desktop app) — this is the single point every reader
 *  goes through, so it's the one place that needs to tolerate that instead of every call site
 *  remembering to. */
export function getLastUsedDate(
  dates: SongUsageEntry[] | undefined,
  today: string,
): string | undefined {
  let lastUsedDate: string | undefined
  for (const entry of dates ?? []) {
    if (entry.date > today) continue
    if (!lastUsedDate || entry.date > lastUsedDate) lastUsedDate = entry.date
  }
  return lastUsedDate
}

/** How many distinct services referenced this song within the rolling 365-day window ending
 *  `today`, excluding future-dated entries — same reasoning as getLastUsedDate. Each service
 *  contributes at most one usageDates entry per song (see applyServiceUsageChange), so this is
 *  already a "used N distinct weeks" count, not inflated by a song appearing twice in one
 *  service. Tolerates `dates` being undefined for the same reason getLastUsedDate does. */
export function getUsesInPastYear(dates: SongUsageEntry[] | undefined, today: string): number {
  const oneYearAgo = toDate(today)
  oneYearAgo.setDate(oneYearAgo.getDate() - 365)
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10)
  return (dates ?? []).filter((entry) => entry.date <= today && entry.date >= oneYearAgoStr).length
}

// A nudge, not a rule — surfaced only in the active Song Library view, since a song that's
// already archived doesn't need to be told it's a candidate for the thing it already is.
// Deliberately NOT based on getUsesInPastYear (a rolling 365-day window) — that would flag every
// once-a-year seasonal song (Christmas, New Year's, etc.) the moment its normal annual gap ticks
// past 365 days, dumping a cluster of false-alarm suggestions right as each one's anniversary
// rolls over. 18 months gives a genuine annual song several months of slack past a normal cycle
// before it's suggested, while still catching songs that have truly fallen out of rotation.
const ARCHIVE_CANDIDATE_DAYS = 548

/** Whether a song hasn't been used in long enough to suggest archiving it — see
 *  ARCHIVE_CANDIDATE_DAYS's own comment for why this is a much longer window than
 *  getUsesInPastYear's rolling year. */
export function isArchiveCandidate(
  dates: SongUsageEntry[] | undefined,
  today: string,
): boolean {
  const lastUsedDate = getLastUsedDate(dates, today)
  if (!lastUsedDate) return false
  const daysSinceLastUse = (toDate(today).getTime() - toDate(lastUsedDate).getTime()) / 86_400_000
  return daysSinceLastUse > ARCHIVE_CANDIDATE_DAYS
}

/** The distinct song ids a service references, deduplicated so a song reprised twice in one
 *  service (e.g. opening and closing) still only counts as one reference for that service. */
export function songIdsInService(service: Service): Set<string> {
  return new Set(
    service.items.filter((item) => item.type === 'song').map((item) => item.songId),
  )
}

/** The union of song ids either version of a service references — every song whose usageDates
 *  entry for this service might need to change. `oldService`/`newService` are `undefined` for
 *  "didn't exist before"/"no longer exists" respectively (a brand-new service, or a deletion). */
export function affectedSongIds(
  oldService: Service | undefined,
  newService: Service | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (oldService) for (const id of songIdsInService(oldService)) ids.add(id)
  if (newService) for (const id of songIdsInService(newService)) ids.add(id)
  return ids
}

/** Applies one service's usage change to one song's usageDates, mirroring
 *  songs::update_usage_dates_for_service (Rust) entry-by-entry. `desiredDate` is the service's
 *  own date if `song` should have an entry pointing at `serviceId` after this change, or
 *  `undefined` if it should not (the service no longer references this song, or was deleted).
 *  Returns `undefined` — rather than a same-valued copy — when nothing actually changed, so
 *  callers can skip an unnecessary save (avoids needless churn/conflicts, same as the Rust
 *  side). */
export function applyServiceUsageChange(
  song: Song,
  serviceId: string,
  desiredDate: string | undefined,
): Song | undefined {
  // Same defaulting Rust's #[serde(default)] gives usage_dates on read (models.rs) -- a song
  // saved before this field existed has it genuinely absent from the JSON on the web/tablet
  // ports, which parse plain JSON with no such defaulting.
  const existingUsageDates = song.usageDates ?? []
  const existingIndex = existingUsageDates.findIndex((entry) => entry.serviceId === serviceId)
  const existing = existingIndex === -1 ? undefined : existingUsageDates[existingIndex]

  if (desiredDate === undefined) {
    if (!existing) return undefined
    const usageDates = existingUsageDates.slice()
    usageDates.splice(existingIndex, 1)
    return { ...song, usageDates }
  }

  if (existing && existing.date === desiredDate) return undefined
  const usageDates = existingUsageDates.slice()
  const entry: SongUsageEntry = { serviceId, date: desiredDate }
  if (existingIndex === -1) usageDates.push(entry)
  else usageDates[existingIndex] = entry
  return { ...song, usageDates }
}
