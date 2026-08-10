import type { SyncProgress } from '@/adapters/types'

// Coarse content kind from a sync progress path's top-level folder — matches the on-disk layout
// every adapters/web/*.ts port already uses (see fsaStorage.ts), just for display here rather
// than routing a store refresh (compare SyncConflictsView.vue's own recoveryKind()).
const SYNC_KIND_LABELS: Record<string, string> = {
  songs: 'songs',
  slides: 'slides',
  'media-items': 'media',
  themes: 'themes',
  people: 'people',
  services: 'services',
}

/** Human-readable label for a tablet sync's live progress (adapters/tablet/cloudSync.ts), e.g.
 *  "Downloading 3 of 745 — songs" — shared by every surface that shows it (App.vue's app-bar,
 *  LibrarySyncSection.vue's Sync health panel, BootGate.vue's first-connect screen). Empty string
 *  when there's nothing meaningful to show (no sync in flight, or an empty batch).
 *
 *  The total is for the whole batch (every content type in one pull/push pass, not just whatever
 *  kind is currently in flight) — deliberately put before the kind, not after, since an earlier
 *  "Downloading songs — 3 of 745" phrasing read as "745 songs" and confused a real user on a real
 *  device into thinking their library had grown that large. The kind is only ever a label for
 *  *this instant's* item, never a count of items of that kind. */
export function formatSyncProgressLabel(progress: SyncProgress | undefined): string {
  if (!progress || progress.total === 0) return ''
  const verb = progress.phase === 'pull' ? 'Downloading' : 'Uploading'
  const top = progress.currentPath?.split('/')[0]
  const kind = (top !== undefined && SYNC_KIND_LABELS[top]) || 'files'
  const position = Math.min(progress.completed + 1, progress.total)
  return `${verb} ${position} of ${progress.total} — ${kind}`
}
