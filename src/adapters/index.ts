import type { StudioAdapter } from './types'
import { createMockAdapter } from './mock'
import { createTauriAdapter } from './tauri'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

let instance: StudioAdapter | undefined

export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

/** Set once, by BootGate.vue, after it resolves which adapter to use — see that file for why
 *  this can't just happen inside getAdapter() itself: the real web adapter needs an async user
 *  gesture (showDirectoryPicker()) before it can even be constructed, which getAdapter()'s
 *  synchronous, called-everywhere contract can't accommodate. */
export function setAdapterInstance(adapter: StudioAdapter): void {
  instance = adapter
}

/** Resolves once per app run. Tauri and the public demo build never need BootGate's async
 *  chooser step, so this stays a safe fallback for either — the only path that actually needs
 *  setAdapterInstance() called first is the real (non-demo) web build. */
export function getAdapter(): StudioAdapter {
  if (!instance) {
    instance = isTauri() ? createTauriAdapter() : createMockAdapter()
  }
  return instance
}

export type { StudioAdapter } from './types'
