import type { DisplayInfo } from '@/adapters/types'

/**
 * True when there's no way to show the operator view and audience output on separate
 * screens (spec section 17) — Display Setup should explain this rather than offering a
 * per-display role picker that can't actually produce two different outputs.
 */
export function needsSingleMonitorFallback(displays: DisplayInfo[]): boolean {
  return displays.length <= 1
}
