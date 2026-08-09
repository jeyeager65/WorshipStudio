/**
 * Complete King James Version text (public domain — no API key or attribution required),
 * same dataset as src-tauri/src/data/kjv.json, so the browser demo/mock adapter resolves
 * any real reference exactly like the native Tauri backend does. Real API-backed
 * translations (ESV, api.bible) are Tauri-only — see src/adapters/tauri/index.ts — since
 * this mock adapter also powers the publicly-hosted static demo, which must never embed a
 * real API key in client-side code.
 *
 * Loaded via dynamic import rather than a static one — at ~4.3MB, a top-level import would
 * otherwise pull the whole Bible into the app's main JS chunk, downloaded on every page view
 * whether or not scripture is ever used. This way it's its own chunk, fetched once on first
 * actual resolve() call.
 */
export interface AvailableTranslation {
  code: string
  name: string
}

export const availableTranslations: AvailableTranslation[] = [
  { code: 'KJV', name: 'King James Version' },
]

type VersesByChapter = Record<string, Record<string, string>>
type KjvData = Record<string, VersesByChapter>

let cached: KjvData | undefined
export async function loadKjv(): Promise<KjvData> {
  if (!cached) {
    cached = ((await import('./kjvFull.json')) as { default: KjvData }).default
  }
  return cached
}
