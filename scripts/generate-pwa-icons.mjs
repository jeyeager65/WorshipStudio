// Generates the icon set the tablet (PWA) build's manifest.webmanifest and index.html reference,
// from the same master icon `tauri icon` already generated for the desktop build
// (src-tauri/icons/icon.png) — one source, not a separate asset to keep in sync by hand.
//
// Every output gets the same treatment: the (light-colored) artwork composited onto a solid,
// opaque canvas in the app's brand blue — never left transparent. A transparent "any" icon looked
// fine on the desktop build (Windows supplies its own tile background behind it), but a PWA
// manifest icon has no such guarantee: depending on the OS/launcher it can render directly over
// the home screen wallpaper, so a light-colored glyph on transparency effectively disappears
// against a light wallpaper (and looks washed out on a dark one) — the bug that prompted this.
// Corners are deliberately left square, not hand-rounded: iOS, Android, and every launcher already
// apply their own mask shape (circle/squircle/rounded-square, which varies by device) — baking in
// rounding here would just double up or look wrong under a different mask.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = path.resolve('src-tauri/icons/icon.png')
const OUTPUT_DIR = path.resolve('public/pwa-icons')
// The app's primary brand blue (src/plugins/themeTokens.ts) — not index.html's dark navy, which
// is UI chrome (splash screen/background), not a brand mark.
const BACKGROUND = '#4C7FE8'

const ANY_SIZES = [192, 512]
const MASKABLE_SIZES = [192, 512]
// "any" gets more breathing room (no OS is guaranteed to crop it); "maskable" is guaranteed to be
// cropped toward a circle/squircle by some launchers, so its artwork stays inside a tighter safe
// zone.
const ANY_SAFE_ZONE_RATIO = 0.82
const MASKABLE_SAFE_ZONE_RATIO = 0.7

async function iconOnBackground(source, canvasSize, artworkSize) {
  const artwork = await sharp(source).resize(artworkSize, artworkSize).toBuffer()
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: artwork, gravity: 'center' }])
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer()
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const source = await readFile(SOURCE)

  for (const size of ANY_SIZES) {
    const output = await iconOnBackground(source, size, Math.round(size * ANY_SAFE_ZONE_RATIO))
    await writeFile(path.join(OUTPUT_DIR, `icon-${size}.png`), output)
    console.log(`icon-${size}.png (any)`)
  }

  for (const size of MASKABLE_SIZES) {
    const output = await iconOnBackground(source, size, Math.round(size * MASKABLE_SAFE_ZONE_RATIO))
    await writeFile(path.join(OUTPUT_DIR, `icon-maskable-${size}.png`), output)
    console.log(`icon-maskable-${size}.png (maskable)`)
  }

  const appleTouchIcon = await iconOnBackground(source, 180, Math.round(180 * ANY_SAFE_ZONE_RATIO))
  await writeFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'), appleTouchIcon)
  console.log('apple-touch-icon.png')
}

main()
