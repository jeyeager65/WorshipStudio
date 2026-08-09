/**
 * Shared client-side QR code generation for the Slide editor's QR element — used identically by
 * the Tauri, mock, and web adapters (see each adapter's `slides.generateQrCode`). This used to be
 * Tauri-only, round-tripping through the `generate_qr_code` command to
 * src-tauri/src/remote_server.rs's `qr_data_url` (still there, still used, but now only for its
 * original purpose: the Remote Control pairing QR, a native-only feature with no browser
 * equivalent). Slide QR generation has no such constraint — it's pure and client-side — so it's
 * consolidated here instead of duplicated per adapter.
 *
 * Uses the `qrcode` npm package's SVG output rather than its canvas-based PNG path: canvas isn't
 * available in the vitest/jsdom test environment without an extra native `canvas` dependency, and
 * an `<img>` consumer (SlideSceneRenderer.vue) can't tell PNG from SVG either way — SVG also
 * scales more cleanly than a fixed-resolution PNG for a UI element.
 */

import { toString as qrToString } from 'qrcode'

export async function generateQrCodeDataUrl(content: string): Promise<string> {
  const svg = await qrToString(content, { type: 'svg' })
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
