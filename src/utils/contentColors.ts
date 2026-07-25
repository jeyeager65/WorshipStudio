/**
 * Maps song block labels and service item types to theme color names (see
 * src/plugins/vuetify.ts) so content is color-coded by category — Verse vs Chorus vs
 * Bridge, Song vs Scripture vs Video — rather than everything sharing one flat accent.
 * Returns Vuetify theme color names (usable directly via `:color` props, or as
 * `rgb(var(--v-theme-<name>))` / `rgba(var(--v-theme-<name>), alpha)` for custom tints),
 * not raw hex values, so this stays in sync automatically if the theme is ever swapped
 * (e.g. a future light theme).
 */

// Order matters: more specific patterns must come first, since e.g. "Pre-Chorus" contains
// "chorus" as a substring and would otherwise match the generic chorus pattern instead.
const BLOCK_LABEL_COLORS: [pattern: RegExp, color: string][] = [
  [/pre-?chorus/i, 'violet'],
  [/chorus/i, 'secondary'],
  [/bridge/i, 'teal'],
  [/verse/i, 'primary'],
  [/intro/i, 'slate'],
  [/(outro|ending|other)/i, 'terracotta'],
  [/tag/i, 'amber'],
]

export function colorForBlockLabel(label: string): string {
  for (const [pattern, color] of BLOCK_LABEL_COLORS) {
    if (pattern.test(label)) return color
  }
  return 'primary'
}

const ITEM_TYPE_COLORS: Record<string, string> = {
  song: 'primary',
  scripture: 'teal',
  'text-slide': 'amber',
  'slide-ref': 'amber',
  media: 'violet',
  video: 'rose',
  audio: 'slate',
  'external-app': 'terracotta',
  countdown: 'secondary',
  qr: 'teal',
}

export function colorForItemType(type: string): string {
  return ITEM_TYPE_COLORS[type] ?? 'slate'
}
