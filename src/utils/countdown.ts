/**
 * Formats the time remaining until `targetTime` as a live-ticking clock string — "mm:ss"
 * normally, "hh:mm:ss" once an hour or more remains, and a flat "00:00" once the target has
 * passed rather than going negative. Used by the Countdown slide element's 'service'/'custom'
 * modes (see models/library.ts).
 */
export function formatCountdown(targetTime: string, now: Date): string {
  const target = new Date(targetTime)
  const totalSeconds = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Formats the whole calendar days remaining until `targetDate` (a "YYYY-MM-DD" day, no
 * time-of-day) — used by the Countdown slide element's 'days' mode, e.g. "12 Days Until
 * Vacation Bible School". Counts by calendar day (midnight to midnight in the local timezone),
 * not elapsed 24-hour periods, so it only ticks over at midnight rather than at whatever time of
 * day the slide first went live. Never goes negative once the target day has arrived or passed.
 */
export function formatDaysUntil(targetDate: string, now: Date): string {
  const target = new Date(`${targetDate}T00:00:00`)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000))
  if (days === 0) return 'Today!'
  if (days === 1) return '1 Day'
  return `${days} Days`
}
