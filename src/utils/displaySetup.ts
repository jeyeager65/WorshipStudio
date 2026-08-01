import type { DisplayInfo } from '@/adapters/types'

/**
 * True when there's no way to show the operator view and audience output on separate screens.
 * Planning remains available with a 16:9 preview, but live presentation requires a second
 * display rather than splitting one monitor into two unusable panes.
 */
export function needsSingleMonitorFallback(displays: DisplayInfo[]): boolean {
  return displays.length <= 1
}
