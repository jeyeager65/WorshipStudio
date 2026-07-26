/**
 * Formats the time remaining until `targetTime` as a live-ticking clock string (spec section 1's
 * Countdown slide type) — "mm:ss" normally, "hh:mm:ss" once an hour or more remains, and a flat
 * "00:00" once the target has passed rather than going negative.
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
