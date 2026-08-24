/**
 * Starter External App profiles shared by every adapter that can't shell out to Rust for this
 * (web/mock/tablet) — mirrors src-tauri/src/domain/external_apps.rs's `default_profiles`, minus
 * the executable-path probing: that's a per-machine concern requiring real filesystem access,
 * which only the Tauri adapter's own `importDefaultProfiles` (backed by the Rust command) can do.
 * On these adapters, importing defaults seeds the shared profile only; the operator still points
 * it at an actual executable later, on whichever computer presents (see ExternalAppProfileEditorView).
 */

import type { ExternalAppProfile } from '@/adapters/types'

interface DefaultExternalAppProfileSeed {
  id: string
  name: string
  kind: ExternalAppProfile['kind']
  launchMode: ExternalAppProfile['launchMode']
  parameterFormat: string
  remoteControlsEnabled: boolean
  keyCommands: { label: string; keyCombo: string; triggerKey?: string }[]
  allowedExtensions: string[]
}

const DEFAULT_EXTERNAL_APP_PROFILES: DefaultExternalAppProfileSeed[] = [
  {
    id: 'external-app-default-powerpoint',
    name: 'PowerPoint',
    kind: 'powerpoint',
    launchMode: 'launch-automatically',
    // /S launches straight into slideshow mode for the given file, no editor chrome.
    parameterFormat: '/S "{file}"',
    remoteControlsEnabled: true,
    keyCommands: [
      { label: 'Next', keyCombo: 'Right', triggerKey: 'Right' },
      { label: 'Previous', keyCombo: 'Left', triggerKey: 'Left' },
    ],
    allowedExtensions: ['pptx', 'ppt', 'ppsx'],
  },
  {
    id: 'external-app-default-vlc',
    name: 'VLC',
    kind: 'video',
    launchMode: 'launch-automatically',
    // --play-and-exit closes VLC when the clip ends rather than sitting on the last frame/
    // playlist view, so restoreSelf's minimize is the only cleanup needed.
    parameterFormat: '--fullscreen --play-and-exit "{file}"',
    remoteControlsEnabled: false,
    keyCommands: [],
    allowedExtensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'],
  },
]

/** Every default profile not already present (matched by id) — safe to call repeatedly, never
 *  duplicates or overwrites an existing/edited profile, since the caller filters by existing
 *  ids first. Returns only the new profiles to add, ready to append and save. */
export function buildDefaultExternalAppProfiles(
  existing: ExternalAppProfile[],
  now: string,
  device: string,
): ExternalAppProfile[] {
  return DEFAULT_EXTERNAL_APP_PROFILES.filter(
    (defaultProfile) => !existing.some((p) => p.id === defaultProfile.id),
  ).map((defaultProfile) => ({
    id: defaultProfile.id,
    name: defaultProfile.name,
    kind: defaultProfile.kind,
    launchMode: defaultProfile.launchMode,
    parameterFormat: defaultProfile.parameterFormat,
    remoteControlsEnabled: defaultProfile.remoteControlsEnabled,
    keyCommands: defaultProfile.keyCommands.map((command) => ({
      id: crypto.randomUUID(),
      label: command.label,
      keyCombo: command.keyCombo,
      triggerKey: command.triggerKey,
    })),
    allowedExtensions: defaultProfile.allowedExtensions,
    updatedAt: now,
    updatedByDevice: device,
  }))
}
