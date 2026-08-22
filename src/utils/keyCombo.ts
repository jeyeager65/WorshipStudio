/**
 * Canonical key-combo string format shared by three places that all need to agree on it:
 * KeyComboField.vue's capture UI, useExternalAppHandoff.ts's live keydown interceptor, and
 * src-tauri/src/domain/win32.rs's parser (which only ever sees the string, built here). Always
 * `Ctrl+Shift+Alt+MainKey`, modifiers in that fixed order regardless of press order, so combo
 * strings compare equal by plain string equality.
 */

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

/** Maps a layout-independent `KeyboardEvent.code` to this app's display/wire format for the
 *  main (non-modifier) key. `code` is used rather than `key` specifically so a captured combo
 *  means the same physical key regardless of OS keyboard layout (AZERTY, etc.) — `key` varies
 *  with layout/shift-state, `code` doesn't. */
function mainKeyFromCode(code: string): string | undefined {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F(1[0-2]|[1-9])$/.test(code)) return code
  switch (code) {
    case 'ArrowRight':
      return 'Right'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'Space':
    case 'Enter':
    case 'Escape':
    case 'Tab':
    case 'Backspace':
    case 'Delete':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
      return code
    default:
      return undefined
  }
}

/** `undefined` for a pure-modifier-only keydown (Ctrl/Shift/Alt/Meta alone) — recording should
 *  keep waiting for the real key that follows rather than treat the modifier itself as a combo. */
export function comboFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  if (MODIFIER_CODES.has(event.code)) return undefined
  const mainKey = mainKeyFromCode(event.code)
  if (!mainKey) return undefined
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  parts.push(mainKey)
  return parts.join('+')
}

/** Display form only — `"Ctrl+Shift+F5"` → `"Ctrl + Shift + F5"`. */
export function formatKeyCombo(combo: string): string {
  return combo.split('+').join(' + ')
}

/** Worship Studio's own existing keyboard shortcuts, kept in one place so the profile editor's
 *  "this overrides an existing shortcut" warning (ExternalAppsSection.vue) can't silently drift
 *  out of sync with the two files that actually implement them. */
export const RESERVED_SHORTCUTS: { combo: string; label: string }[] = [
  { combo: 'Up', label: 'Move selection up (Service Workspace)' },
  { combo: 'Down', label: 'Move selection down (Service Workspace)' },
  { combo: 'Left', label: 'Previous slide' },
  { combo: 'Right', label: 'Next slide' },
  { combo: 'B', label: 'Toggle blank screen' },
  { combo: 'G', label: 'Toggle background-only' },
  { combo: 'Ctrl+S', label: 'Save' },
  { combo: 'Ctrl+Z', label: 'Undo' },
  { combo: 'Ctrl+Y', label: 'Redo' },
  { combo: 'Ctrl+Shift+Z', label: 'Redo' },
  { combo: 'F1', label: 'Help' },
]
