/**
 * A rough "time left" for a sync in flight, from how long the items so far have taken.
 *
 * Deliberately coarse. Library files vary enormously — a 2KB song record and a 200MB video are both
 * one item — so an average-per-item estimate is only ever approximate, and quoting it to the second
 * would claim a precision that does not exist. Rounding to "less than a minute" / "about N minutes"
 * keeps the promise the number can actually keep.
 */

/** Below this many items the rate is dominated by whatever the first few files happened to be. */
const MIN_ITEMS_SAMPLED = 5
/** And below this long, by connection warm-up. */
const MIN_ELAPSED_MS = 3_000

/**
 * Seconds still to go, or undefined when there is not yet enough to say anything honest — too few
 * items, too little time, or already finished. Callers should show nothing rather than a guess.
 */
export function estimateSecondsRemaining(
  completed: number,
  total: number,
  elapsedMs: number,
): number | undefined {
  if (completed < MIN_ITEMS_SAMPLED || elapsedMs < MIN_ELAPSED_MS) return undefined
  if (total <= 0 || completed >= total) return undefined
  const msPerItem = elapsedMs / completed
  return Math.round(((total - completed) * msPerItem) / 1000)
}

/** Wording for the estimate above. Never quotes seconds: the underlying number is not that good. */
export function formatSecondsRemaining(seconds: number): string {
  if (seconds < 60) return 'less than a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes <= 1) return 'about a minute left'
  return `about ${minutes} minutes left`
}

/** Percentage complete for a determinate progress bar, clamped so a provider reporting more items
 *  than it first counted cannot push the bar past full. */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (completed / total) * 100))
}
