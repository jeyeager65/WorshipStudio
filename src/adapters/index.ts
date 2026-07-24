import type { StudioAdapter } from './types'
import { createMockAdapter } from './mock'
import { createTauriAdapter } from './tauri'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

let instance: StudioAdapter | undefined

/** Resolves once per app run: real Tauri backend when running in the desktop shell, mock otherwise. */
export function getAdapter(): StudioAdapter {
  if (!instance) {
    instance = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ ? createTauriAdapter() : createMockAdapter()
  }
  return instance
}

export type { StudioAdapter } from './types'
