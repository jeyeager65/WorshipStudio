/**
 * Formats a Date as a local YYYY-MM-DD calendar date.
 *
 * Service dates have no timezone semantics. Using `toISOString()` here would first convert the
 * instant to UTC and can therefore return tomorrow or yesterday near local midnight.
 */
export function localCalendarDate(date: Date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
